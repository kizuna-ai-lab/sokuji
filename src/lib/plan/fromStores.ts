// src/lib/plan/fromStores.ts
//
// The run plan as the stores stand: the one place the app reads it, for a
// start, the start gate and every surface. Until the stored line-up decides
// it, the plan is the selected provider's, as one whole-provider unit.
// Nothing the provider registry imports may import this file: it imports the
// registry.
import { useMemo } from 'react';
import type { RunStage } from '../lineup/types';
import type { AnyProvider, LanguagePair } from '../provider/types';
import type { PlanAccount } from '../session/types';
import { presentProviders } from '../../providers/registry';
import { useProviderStore, type ProviderEntry, type ProviderStore } from '../../stores/providerStore';
import { unitFor } from './read';
import type { PlanRefusal, RunPlan, UnitCapabilities, UnitDefinition } from './types';
import { wholePlan } from './wholeUnit';

/** The plan a start would run now, or why there is none yet. */
export type PlanState =
  /** No provider resolves yet, or an entry of the plan has not loaded: the surfaces show what they show while loading. */
  | { state: 'loading' }
  /** The stored line-up cannot run here. Never answered while the selection decides the plan. */
  | { state: 'refused'; refusal: PlanRefusal }
  /** The plan, and each of its providers' settings, credentials and pair (the provider store's entry itself). */
  | { state: 'ready'; plan: RunPlan; accounts: Readonly<Record<string, PlanAccount & { pair: LanguagePair }>> };

/** One object for every loading answer, so a hook that reads it does not re-render. */
const LOADING: PlanState = { state: 'loading' };

/** The last ready answer, kept while its provider and entry stand: one object for every reader of the same stores. */
let last: { id: string; entry: ProviderEntry; found: PlanState } | null = null;

function planIn({ selected, entries }: Pick<ProviderStore, 'selected' | 'entries'>): PlanState {
  const providers = presentProviders();
  const provider: AnyProvider | undefined = providers.find((p) => p.id === selected) ?? providers[0];
  const entry = provider ? entries[provider.id] : undefined;
  if (!provider || !entry) return LOADING;
  if (last?.id !== provider.id || last.entry !== entry) {
    last = { id: provider.id, entry, found: { state: 'ready', plan: wholePlan(provider), accounts: { [provider.id]: entry } } };
  }
  return last.found;
}

/**
 * The plan as the stores stand: the selected provider (the first offered when the selection is not offered here)
 * as one whole-provider unit, once its entry has loaded. The same object until the provider or its entry changes.
 */
export function planFromStores(): PlanState {
  return planIn(useProviderStore.getState());
}

/** `planFromStores` for a component: it re-renders when the selection or the plan's entry changes, and only then. */
export function usePlan(): PlanState {
  return useProviderStore(planIn);
}

/** The unit that serves `stage` in the plan as the stores stand, with its provider, settings and capabilities; null while the plan is not ready. */
export function useStageUnit(stage: RunStage): { provider: AnyProvider; unit: UnitDefinition; settings: unknown; capabilities: UnitCapabilities } | null {
  const found = usePlan();
  return useMemo(() => {
    if (found.state !== 'ready') return null;
    const { provider, unit } = unitFor(found.plan, stage);
    const { settings } = found.accounts[provider.id];
    return { provider, unit, settings, capabilities: unit.capabilities(settings) };
  }, [found, stage]);
}
