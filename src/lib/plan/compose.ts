// src/lib/plan/compose.ts
//
// The composer: turns a line-up into the plan that runs it, or the first
// reason it cannot run. Pure; nothing here connects or reads a store.
import { goesWith, optionFor } from '../lineup/catalog';
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
  /**
   * The options a line-up may name; the app's own catalog by default. Given by a test that composes under an
   * option the app does not offer yet.
   */
  catalog?: readonly ProviderCaps[];
}

/**
 * Why no units of a host serve the stages it is asked for: an option there that must serve another stage too,
 * which this host was not given (a joint group cut, or a translation without the transcription it is bound to),
 * or else no units for them, named by the first of them.
 */
function noUnit(asked: readonly RunStage[], options: Readonly<Record<RunStage, ProviderCaps>>): PlanRefusal {
  for (const stage of asked) {
    const missing = goesWith(options[stage], stage).find((st) => !asked.includes(st));
    if (missing) return { refused: 'lineup_stage_split', stage: missing };
  }
  return { refused: 'lineup_no_unit', stage: asked[0] };
}

/** Every way to cut stages into parts, each part and the parts themselves in stage order. */
function cuts(stages: readonly RunStage[]): RunStage[][][] {
  if (stages.length === 0) return [[]];
  const [first, ...rest] = stages;
  return cuts(rest).flatMap((parts) => [
    [[first], ...parts],
    ...parts.map((_part, i) => parts.map((part, j) => (j === i ? [first, ...part] : part)).sort((x, y) => stages.indexOf(x[0]) - stages.indexOf(y[0]))),
  ]);
}

/**
 * The ways a host's stages may be shared out among its units, in the order they are tried: an exact cover, each
 * stage in one part and each part one unit's. Fewest units first, so one unit for all of them (the whole unit of
 * a line-up on one device) wins over any split; among equals, parts of neighbouring stages first. Stages an
 * option carries together are never put in different parts: an end-to-end provider's stages, and a translation
 * with the transcription it is bound to. A host that was given only part of such stages is asked for one unit
 * and nothing else: what it then answers for is its own unit's to say (an end-to-end provider's whole unit may
 * serve transcription and translation without speaking), and no cut of them is a plan.
 */
function sharings(asked: readonly RunStage[], options: Readonly<Record<RunStage, ProviderCaps>>): RunStage[][][] {
  if (asked.some((stage) => goesWith(options[stage], stage).some((st) => !asked.includes(st)))) return [[[...asked]]];
  const partOf = (parts: RunStage[][], stage: RunStage) => parts.find((part) => part.includes(stage));
  const kept = (parts: RunStage[][]) => asked.every((stage) => goesWith(options[stage], stage).every((st) => partOf(parts, st) === partOf(parts, stage)));
  const apart = (parts: RunStage[][]) => parts.filter((part) => part.some((stage, i) => i > 0 && asked.indexOf(stage) !== asked.indexOf(part[i - 1]) + 1)).length;
  return cuts(asked).filter(kept).sort((x, y) => x.length - y.length || apart(x) - apart(y));
}

/** The plan that runs this line-up on the providers offered here, or the first reason it cannot run. */
export function compose(lineUp: Pick<LineUp, RunStage>, input: ComposeInput): RunPlan | PlanRefusal {
  const options = {} as Record<RunStage, ProviderCaps>;
  for (const stage of RUN_STAGES) {
    const option = optionFor(lineUp, stage, input.catalog);
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

  // A translation that is bound to its own transcription, beside another option's: said before any unit is looked
  // for, so that the refusal names what the translation needs, not the other host's units. Its own code: the
  // sentence says which stage to change, which the sentence of an end-to-end provider's split stages cannot.
  if (options.translation.translatesOwn && options.transcription.id !== options.translation.id) {
    return { refused: 'lineup_translation_bound', stage: 'transcription', provider: options.translation.id };
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
  // In stage order, whichever host they belong to: a host that transcribes and speaks has another's unit between.
  units.sort((a, b) => RUN_STAGES.indexOf(a.stages[0]) - RUN_STAGES.indexOf(b.stages[0]));
  // Every stage has its unit. What remains is about the plan as a whole: a voice beside another host's text, then
  // two managed providers. What needs the run's pair and legs (a pair the translation unit does not translate, a
  // language the voice does not speak, face-to-face) is `checkPlan`'s, asked by the gate.
  const refusal = voiceRefusal(options) ?? twoManaged(units);
  if (refusal) return refusal;
  return { units, byStage };
}
