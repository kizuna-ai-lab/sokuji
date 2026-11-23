// src/lib/plan/fromStores.ts
//
// The run plan as the stores stand: the one place the app reads it, for a
// start, the start gate and every surface. The stored line-up decides it: the
// plan is the one the composer makes of it. Until a line-up is stored, the
// plan is that of the line-up the settings show where this device runs meanwhile,
// else that of the provider that runs meanwhile, alone: its one whole-provider
// unit, or the units it declares for a session on it alone.
// Nothing the provider registry imports may import this file: it imports the
// registry (`fromStores.cycle.test.ts` checks it).
import { useMemo, useSyncExternalStore } from 'react';
import { optionFor } from '../lineup/catalog';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import type { LanguagePair, PlanAccount, UnitCapabilities, UnitDefinition } from '../run/types';
import { presentProviders } from '../../providers/registry';
import { useLineUpStore } from '../../stores/lineUpStore';
import { useProviderStore, type ProviderEntry } from '../../stores/providerStore';
import { compose } from './compose';
import { providersIn, unitFor } from './read';
import { isRefusal } from './types';
import type { PlanRefusal, RunPlan } from './types';
import { wholePlan } from './wholeUnit';

/** The plan a start would run now, or why there is none yet. */
export type PlanState =
  /** The line-up store has not loaded (or no provider is offered here), or an entry of the plan has not loaded: the surfaces show what they show while loading. */
  | { state: 'loading' }
  /** The stored line-up cannot run here: the composer's reason. The line-up page shows the stored choices, to be changed. */
  | { state: 'refused'; refusal: PlanRefusal }
  /** The plan, and each of its providers' settings, credentials and pair (the provider store's entry itself). */
  | { state: 'ready'; plan: RunPlan; accounts: Readonly<Record<string, PlanAccount & { pair: LanguagePair }>> };

/** One object for every loading answer, so a hook that reads it does not re-render. */
const LOADING: PlanState = { state: 'loading' };

/**
 * The last answer, kept while what it was made from stands (`from`, compared one by one): one object for every
 * reader of the same stores, so a hook that reads it does not re-render.
 */
let last: { from: readonly unknown[]; found: PlanState } | null = null;

function kept(from: readonly unknown[], find: () => PlanState): PlanState {
  if (!last || last.from.length !== from.length || last.from.some((value, i) => value !== from[i])) last = { from, found: find() };
  return last.found;
}

/** A plan with the entry of each of its providers; loading while one of them has not loaded. */
function ready(plan: RunPlan, entries: Readonly<Record<string, ProviderEntry>>): PlanState {
  const accounts: Record<string, ProviderEntry> = {};
  for (const { id } of providersIn(plan)) {
    const entry: ProviderEntry | undefined = entries[id];
    if (!entry) return LOADING;
    accounts[id] = entry;
  }
  return { state: 'ready', plan, accounts };
}

/** The plan of a stored line-up: the composer's, once every provider it names has loaded. */
function storedPlan(lineUp: LineUp, providers: readonly AnyProvider[], entries: Readonly<Record<string, ProviderEntry>>): PlanState {
  // The providers the line-up names and this build offers here: the composer reads their settings, so the plan
  // waits for their entries. A line-up that leaves a stage out, or names a provider not offered, is refused
  // before any settings are read.
  const hosts: AnyProvider[] = [];
  let complete = true;
  for (const stage of RUN_STAGES) {
    const host = optionFor(lineUp, stage)?.host;
    const provider = host === undefined ? undefined : providers.find((p) => p.id === host);
    if (!provider) complete = false;
    else if (!hosts.includes(provider)) hosts.push(provider);
  }
  return kept(['stored', lineUp, complete, ...hosts.flatMap((p) => [p, entries[p.id]])], () => {
    if (complete && hosts.some((p) => !entries[p.id])) return LOADING;
    const plan = compose(lineUp, { providers, settings: (id) => entries[id]?.settings });
    return isRefusal(plan) ? { state: 'refused', refusal: plan } : ready(plan, entries);
  });
}

/**
 * The plan as the stores stand. A stored line-up: the plan the composer makes of it, or its refusal. No line-up
 * stored yet: where this device runs meanwhile (`unstoredProvider` is `local_inference`), the plan of the line-up
 * the settings show; else the plan of the provider that runs meanwhile (the first offered when that id is not
 * offered here), alone (`wholePlan`). Loading until the
 * line-up store has loaded and every provider of the plan has its entry. The same object until the line-up, a
 * provider of the plan or its entry changes.
 */
export function planFromStores(): PlanState {
  const { lineUp, stored, unstoredProvider } = useLineUpStore.getState();
  const { entries } = useProviderStore.getState();
  const providers = presentProviders();
  if (stored) return lineUp ? storedPlan(lineUp, providers, entries) : LOADING;
  if (unstoredProvider === null) return LOADING;
  // This device meanwhile: the line-up the settings show (the local host's defaults until the migration writes one),
  // composed as a stored one is: Bing and Edge are providers of their own, never cloud models of the local one.
  if (unstoredProvider === 'local_inference' && lineUp) return storedPlan(lineUp, providers, entries);
  const provider: AnyProvider | undefined = providers.find((p) => p.id === unstoredProvider) ?? providers[0];
  const entry = provider ? entries[provider.id] : undefined;
  if (!provider || !entry) return LOADING;
  return kept(['unstored', provider, entry], () => ({ state: 'ready', plan: wholePlan(provider), accounts: { [provider.id]: entry } }));
}

/**
 * Hears every change of the two stores the plan is read from (the line-up store and the provider store), for code
 * outside React that follows `planFromStores()`: the listener reads the plan again and compares. Returns the
 * unsubscribe.
 */
export function subscribePlan(changed: () => void): () => void {
  const offs = [useLineUpStore.subscribe(() => changed()), useProviderStore.subscribe(() => changed())];
  return () => { for (const off of offs) off(); };
}

/**
 * `planFromStores` for a component: it re-renders when the plan's line-up, a provider of it or its entry changes.
 * The list of offered providers is read on each store update.
 */
export function usePlan(): PlanState {
  return useSyncExternalStore(subscribePlan, planFromStores);
}

/** The unit that serves a stage, with its provider, its provider's settings and what it can do under them. */
export interface StageUnit { provider: AnyProvider; unit: UnitDefinition; settings: unknown; capabilities: UnitCapabilities }

/** A stage's unit in a plan state, the same object while the state is. */
function useUnitIn(found: PlanState, stage: RunStage): StageUnit | null {
  return useMemo(() => {
    if (found.state !== 'ready') return null;
    const { provider, unit } = unitFor(found.plan, stage);
    const { settings } = found.accounts[provider.id];
    return { provider, unit, settings, capabilities: unit.capabilities(settings) };
  }, [found, stage]);
}

/** The unit that serves `stage` in the plan as the stores stand, with its provider, settings and capabilities; null while the plan is not ready. */
export function useStageUnit(stage: RunStage): StageUnit | null {
  return useUnitIn(usePlan(), stage);
}
