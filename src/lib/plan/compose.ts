// src/lib/plan/compose.ts
//
// The composer: turns a line-up into the plan that runs it, or the first
// reason it cannot run. Pure; nothing here connects or reads a store.
import { optionFor } from '../lineup/catalog';
import { RUN_STAGES } from '../lineup/types';
import type { LineUp, ProviderCaps, RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import { twoManaged, voiceRefusal } from './checks';
import { sameStages } from './types';
import type { PlannedUnit, PlanRefusal, RunPlan } from './types';
import { unitsOf } from './wholeUnit';

/** What the composer needs from the app: the providers offered here and their settings. */
export interface ComposeInput {
  /** The providers this build offers here: `presentProviders()` in the app. */
  providers: readonly AnyProvider[];
  /** A provider's settings; undefined while its entry has not loaded. */
  settings(providerId: string): unknown;
}

/**
 * Why no unit of a host serves the stages it is asked for: an option there whose joint stages
 * this host was given only part of, or else no unit for them, named by the first of them.
 */
function noUnit(asked: readonly RunStage[], options: Readonly<Record<RunStage, ProviderCaps>>): PlanRefusal {
  for (const stage of asked) {
    const joint = options[stage].joint;
    if (!joint || !joint.some((st) => asked.includes(st))) continue;
    const missing = joint.find((st) => !asked.includes(st));
    if (missing) return { refused: 'lineup_stage_split', stage: missing };
  }
  return { refused: 'lineup_no_unit', stage: asked[0] };
}

/**
 * The ways a host's stages may be shared out among its units, in the order they are tried: one unit for all of
 * them; then, where an option there states stages that go together and the host was given more than those, one
 * unit for that joint group beside one for the rest (Soniox on all three: its text unit and its voice).
 */
function sharings(asked: readonly RunStage[], options: Readonly<Record<RunStage, ProviderCaps>>): RunStage[][][] {
  const ways: RunStage[][][] = [[[...asked]]];
  for (const stage of asked) {
    const joint = options[stage].joint;
    if (!joint || joint.length >= asked.length || !joint.every((st) => asked.includes(st))) continue;
    // In stage order, the part that holds the earlier stage first.
    const parts = [asked.filter((st) => joint.includes(st)), asked.filter((st) => !joint.includes(st))];
    ways.push(parts.sort((a, b) => asked.indexOf(a[0]) - asked.indexOf(b[0])));
    break;
  }
  return ways;
}

/** The plan that runs this line-up on the providers offered here, or the first reason it cannot run. */
export function compose(lineUp: Pick<LineUp, RunStage>, input: ComposeInput): RunPlan | PlanRefusal {
  const options = {} as Record<RunStage, ProviderCaps>;
  for (const stage of RUN_STAGES) {
    const option = optionFor(lineUp, stage);
    if (!option) return { refused: 'lineup_incomplete', stage };
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
    const s = input.settings(provider.id);
    /** The host's first unit that occupies exactly these stages. */
    const serving = (stages: readonly RunStage[]): PlannedUnit | undefined => {
      const want = new Set(stages);
      for (const unit of unitsOf(provider)) {
        const got = unit.occupies(s, want);
        if (got !== null && sameStages(got, want)) return { provider, unit, stages: got };
      }
      return undefined;
    };
    let planned: PlannedUnit[] | undefined;
    for (const parts of sharings(asked, options)) {
      const found = parts.map(serving);
      if (found.every((unit): unit is PlannedUnit => unit !== undefined)) {
        planned = found;
        break;
      }
    }
    if (!planned) return noUnit(asked, options);
    for (const unit of planned) {
      units.push(unit);
      for (const stage of unit.stages) byStage[stage] = unit;
    }
  }
  // Every stage has its unit. What remains is about the plan as a whole: a voice beside another host's text, then
  // two managed providers.
  const refusal = voiceRefusal(options) ?? twoManaged(units);
  if (refusal) return refusal;
  return { units, byStage };
}
