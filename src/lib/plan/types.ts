// src/lib/plan/types.ts
//
// The unit and the run plan under every session: a unit is one piece of a
// provider that serves some of the run stages; a plan says which unit serves
// each stage. Types and two small checks on them; the composer that builds a
// plan lives elsewhere.
import type { Adapter, SessionContext } from '../contract/adapter';
import type { SpeechEvents, SpeechSession, SpeechStartRequest } from '../contract/speech';
import type { RunStage } from '../lineup/types';
import type { AnyProvider, ProviderRefusal, SharedSettings } from '../provider/types';

/**
 * What a unit can do under its settings, in the words generic code reads.
 * A member may be computed when read (a whole-provider unit asks its provider each time), so generic code reads
 * the member it needs and never spreads or serialises the object.
 */
export interface UnitCapabilities {
  speech: 'always' | 'optional' | 'never';
  turns: ReadonlyArray<'auto' | 'manual'>;
  /** Who may decide the end of a turn (spec §9). Every unit answers 'either' in step 1. */
  turnOwner: 'unit' | 'external' | 'either';
  boundaries: 'provider' | 'silence';
  textInput: boolean;
  faceToFace: boolean;
  /** False: the participant leg never speaks, whatever its switch says. */
  participantSpeech: boolean;
}

/**
 * One piece of a provider that serves some stages of a run.
 * `any` by default: units of different providers are held together, so their settings, key and config types are erased, as `AnyProvider` does.
 */
export interface UnitDefinition<S = any, K = any, C = any> {
  /** 'whole' in step 1. */
  id: string;
  /** The stages this unit occupies when asked for `want`, or null when it cannot serve exactly that. */
  occupies(s: S, want: ReadonlySet<RunStage>): readonly RunStage[] | null;
  capabilities(s: S): UnitCapabilities;
  build(context: SessionContext, s: S, shared: SharedSettings): C | ProviderRefusal;
  describe(c: C): { asrModel?: string; translationModel?: string; ttsModel?: string };
  /** Absent on a unit that occupies only `speech`: exactly one of `start` and `startSpeech` is present. */
  start?: Adapter<C, K>['start'];
  /** A unit that occupies only `speech`: started through this, and has no `start`. */
  startSpeech?(request: SpeechStartRequest<C, K>, events: SpeechEvents): SpeechSession;
}

/** Whether a unit is started through the speech contract (`startSpeech`), not the adapter contract. */
export function isSpeechUnit(unit: UnitDefinition): unit is UnitDefinition & { startSpeech: NonNullable<UnitDefinition['startSpeech']> } {
  return unit.startSpeech !== undefined;
}

/** A unit chosen for a run, with its provider and the stages it serves there. */
export interface PlannedUnit { provider: AnyProvider; unit: UnitDefinition; stages: readonly RunStage[] }

/** Which unit serves which stage of one run. */
export interface RunPlan {
  /** In the order transcription, translation, speech; a unit that occupies several appears once. */
  units: readonly PlannedUnit[];
  byStage: Readonly<Record<RunStage, PlannedUnit>>;
}

export type PlanRefusalCode = 'lineup_incomplete' | 'lineup_not_offered' | 'lineup_stage_split' | 'lineup_no_unit';

/** Why no plan could be made, and for which stage. */
export interface PlanRefusal { refused: PlanRefusalCode; stage: RunStage; provider?: string }

export const isRefusal = (p: RunPlan | PlanRefusal): p is PlanRefusal => 'refused' in p;

/** Whether a list of stages holds exactly the stages of a set, each once: a list that repeats a stage does not. */
export function sameStages(a: readonly RunStage[], b: ReadonlySet<RunStage>): boolean {
  return a.length === b.size && new Set(a).size === a.length && a.every((stage) => b.has(stage));
}
