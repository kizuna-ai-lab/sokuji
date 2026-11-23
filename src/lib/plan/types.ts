// src/lib/plan/types.ts
//
// The run plan of this app's providers: which planned unit serves each stage, the configs one leg built for them, and
// why a plan is refused. The unit and the plan's shape are the run contract's (`src/lib/run/types.ts`); this module
// binds them to `AnyProvider`. Types and small checks on them; the composer that builds a plan lives elsewhere.
import type { RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import type { PlannedUnitOf, RunPlanOf, UnitDefinition } from '../run/types';

/** A unit chosen for a run of this app's providers (`PlannedUnitOf`). */
export type PlannedUnit = PlannedUnitOf<AnyProvider>;

/** Which unit of this app's providers serves which stage of one run (`RunPlanOf`). */
export type RunPlan = RunPlanOf<AnyProvider>;

/** One leg's configs: one per unit of the plan, keyed by `PlannedUnit` identity. */
export type PlanConfigs = ReadonlyMap<PlannedUnit, unknown>;

/** Whether a unit is started through the translation contract (`startTranslation`), not the adapter contract. */
export function isTranslationUnit(unit: UnitDefinition): unit is UnitDefinition & { startTranslation: NonNullable<UnitDefinition['startTranslation']> } {
  return unit.startTranslation !== undefined;
}

/** Whether a unit is started through the speech contract (`startSpeech`), not the adapter contract. */
export function isSpeechUnit(unit: UnitDefinition): unit is UnitDefinition & { startSpeech: NonNullable<UnitDefinition['startSpeech']> } {
  return unit.startSpeech !== undefined;
}

export const PLAN_REFUSAL_CODES = [
  'lineup_incomplete',
  'lineup_not_offered',
  'lineup_stage_split',
  'lineup_translation_bound',
  'lineup_no_unit',
  'lineup_voice_not_alone',
  'lineup_voice_not_taken',
  'lineup_two_managed',
  'lineup_language_not_spoken',
  'lineup_source_not_fixed',
  'lineup_pair_not_translated',
  'lineup_face_to_face_apart',
] as const;

export type PlanRefusalCode = (typeof PLAN_REFUSAL_CODES)[number];

/**
 * Why no plan could be made, or why a plan cannot run a session, and for which stage. `provider`: the line-up id
 * the refusal is about, where it names one. `language`: the language no voice speaks (`lineup_language_not_spoken`).
 * `source` and `target`: the pair the translation unit does not translate (`lineup_pair_not_translated`).
 */
export interface PlanRefusal { refused: PlanRefusalCode; stage: RunStage; provider?: string; language?: string; source?: string; target?: string }

export const isRefusal = (p: RunPlan | PlanRefusal): p is PlanRefusal => 'refused' in p;

/** Whether a list of stages holds exactly the stages of a set, each once: a list that repeats a stage does not. */
export function sameStages(a: readonly RunStage[], b: ReadonlySet<RunStage>): boolean {
  return a.length === b.size && new Set(a).size === a.length && a.every((stage) => b.has(stage));
}
