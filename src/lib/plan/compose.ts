// src/lib/plan/compose.ts
//
// The composer: turns a line-up into the plan that runs it, or the first
// reason it cannot run. Pure; nothing here connects or reads a store.
import { caps } from '../lineup/catalog';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, ProviderCaps, RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import type { PlannedUnit, PlanRefusal, RunPlan } from './types';
import { unitsOf } from './wholeUnit';

/** What the composer needs from the app: the providers offered here and their settings. */
export interface ComposeInput {
  /** The providers this build offers here: `presentProviders()` in the app. */
  providers: readonly AnyProvider[];
  /** A provider's settings; undefined while its entry has not loaded. */
  settings(providerId: string): unknown;
}

const isExactly = (want: ReadonlySet<RunStage>, got: readonly RunStage[] | null): got is readonly RunStage[] =>
  got !== null && got.length === want.size && got.every((st) => want.has(st));

/**
 * Why no unit of a host serves the stages it is asked for: an option there whose joint stages
 * this host was given only part of, or else no unit for the smallest group of stages.
 */
function noUnit(asked: readonly RunStage[], options: Readonly<Record<RunStage, ProviderCaps>>, groups: ReadonlyMap<string, RunStage[]>): PlanRefusal {
  for (const stage of asked) {
    const joint = options[stage].joint;
    if (!joint || !joint.some((st) => asked.includes(st))) continue;
    const missing = joint.find((st) => !asked.includes(st));
    if (missing) return { refused: 'lineup_stage_split', stage: missing };
  }
  const smallest = [...groups.values()].reduce((a, b) => (b.length < a.length ? b : a));
  return { refused: 'lineup_no_unit', stage: smallest[0] };
}

/** The plan that runs this line-up on the providers offered here, or the first reason it cannot run. */
export function compose(lineUp: Pick<LineUp, RunStage>, input: ComposeInput): RunPlan | PlanRefusal {
  const options = {} as Record<RunStage, ProviderCaps>;
  for (const stage of RUN_STAGES) {
    const id = lineUp[stage];
    const option = id === null ? undefined : caps(id);
    if (!option || !option.stages.includes(stage)) return { refused: 'lineup_incomplete', stage };
    options[stage] = option;
  }

  const hosts = new Map<string, AnyProvider>();
  for (const stage of RUN_STAGES) {
    const { id, host } = options[stage];
    const provider = input.providers.find((p) => p.id === host);
    if (!provider) return { refused: 'lineup_not_offered', stage, provider: id };
    hosts.set(host, provider);
  }

  // Each host's stages, hosts in the order of their first stage.
  const groups = new Map<string, RunStage[]>();
  for (const stage of RUN_STAGES) {
    const { host } = options[stage];
    groups.set(host, [...(groups.get(host) ?? []), stage]);
  }

  const units: PlannedUnit[] = [];
  const byStage = {} as Record<RunStage, PlannedUnit>;
  for (const [host, asked] of groups) {
    const provider = hosts.get(host)!;
    const want = new Set(asked);
    const s = input.settings(provider.id);
    let planned: PlannedUnit | undefined;
    for (const unit of unitsOf(provider)) {
      const got = unit.occupies(s, want);
      if (isExactly(want, got)) {
        planned = { provider, unit, stages: got };
        break;
      }
    }
    if (!planned) return noUnit(asked, options, groups);
    units.push(planned);
    for (const stage of asked) byStage[stage] = planned;
  }
  return { units, byStage };
}
