// src/lib/plan/wholeUnit.ts
//
// The whole unit an end-to-end service declares (`wholeUnitOf`), a provider's units, its plan alone, and what it
// says alone. Pure functions over the provider definition.
import { RUN_STAGES, SP, TR_TL } from '../lineup/types';
import type { RunStage } from '../lineup/types';
import type { Adapter, SessionContext } from '../contract/adapter';
import type { AnyProvider } from '../provider/types';
import type { ProviderRefusal, SharedSettings, UnitCapabilities, UnitDefinition } from '../run/types';
import { sameStages } from './types';
import type { PlannedUnit, RunPlan } from './types';

/**
 * What a provider that is one whole session is made of: the nine members `Provider` had for it, with the same types.
 * `wholeUnitOf` makes its unit.
 */
export interface WholeUnitParts<S = any, K = any, C = any> {
  speech: 'always' | 'optional' | 'never';
  /** Whether the speaker leg takes typed text under these settings: Gemini's Live Translate ignores it where its dialogue models answer it. */
  textInput(s: S): boolean;
  boundaries(s: S): 'provider' | 'silence';
  turns(s: S): ReadonlyArray<'auto' | 'manual'>;
  /**
   * Whether the participant leg may speak. `false`: never, whatever its
   * switch says — Kizuna Soniox ships so until the backend mints a
   * participant speech key (Stage 2 Kizuna Soniox, ruling 2); the switch
   * then shows off and disabled with a "not available yet" tooltip,
   * keeping the stored choice. Absent or `true`: the participant speaks
   * when its switch is on.
   */
  participantSpeech?: boolean;
  /**
   * Whether Both may run face-to-face (spec 2026-10-08, slice 3): two people
   * at one microphone, attributed by speaker label and language on one
   * shared socket. Absent: the Both popover never offers "beside me", and a
   * stored choice is ignored.
   */
  faceToFace?: boolean;
  build(context: SessionContext, s: S, shared: SharedSettings): C | ProviderRefusal;
  describe(c: C): { asrModel?: string; translationModel?: string; ttsModel?: string };
  start: Adapter<C, K>['start'];
}

/**
 * The unit that is a whole session: all three stages, or recognition and translation when it need not speak.
 * A view of its parts, not a copy: every member reads a part when it is used, so the unit runs what the parts
 * hold then, and a read asks a part exactly what generic code asked it before. Made, it reads no part and
 * touches no module state.
 */
export function wholeUnitOf<S, K, C>(parts: WholeUnitParts<S, K, C>): UnitDefinition<S, K, C> {
  return {
    id: 'whole',
    occupies: (_s, want) => {
      if (sameStages(RUN_STAGES, want)) return RUN_STAGES;
      if (parts.speech !== 'always' && sameStages(['transcription', 'translation'], want)) return ['transcription', 'translation'];
      return null;
    },
    // A capability backed by a function is asked when it is read: a reader of one capability calls that function only.
    capabilities: s => ({
      speech: parts.speech,
      get turns() { return parts.turns(s); },
      turnOwner: 'either',
      get boundaries() { return parts.boundaries(s); },
      get textInput() { return parts.textInput(s); },
      faceToFace: parts.faceToFace === true,
      participantSpeech: parts.participantSpeech !== false,
    }),
    build: (context, s, shared) => parts.build(context, s, shared),
    get describe() { return parts.describe; },
    get start() { return parts.start; },
  };
}

const TEXT_STAGES: ReadonlySet<RunStage> = new Set(TR_TL);
const EVERY_STAGE: ReadonlySet<RunStage> = new Set(RUN_STAGES);

/**
 * Whether a provider can run a session by itself: one of its units takes audio and gives a translation, alone or
 * with speech. A provider that only speaks, only transcribes or only translates cannot: a stored selection of one
 * (the retired OpenAI Compatible's id, which a text model now has) is not run alone, nor offered by the wizard.
 */
export function runsAlone(p: AnyProvider): boolean {
  return unitsOf(p).some((unit) => unit.start !== undefined
    && (unit.occupies(p.settings.defaults, EVERY_STAGE) !== null || unit.occupies(p.settings.defaults, TEXT_STAGES) !== null));
}

/** A provider's units: the list it declares. */
export function unitsOf(p: AnyProvider): readonly UnitDefinition[] {
  return p.units;
}

/** A provider's unit that occupies exactly `stages` when asked for them, under no settings: the first that does. */
function unitServing(p: AnyProvider, stages: readonly RunStage[]): PlannedUnit | null {
  const want = new Set(stages);
  for (const unit of unitsOf(p)) {
    const got = unit.occupies(undefined, want);
    if (got !== null && sameStages(got, want)) return { provider: p, unit, stages: got };
  }
  return null;
}

/**
 * The plan of a run on one provider alone: the unit of it that serves all three stages, or, when no single unit
 * does, its unit for transcription and translation beside its unit for speech. A provider with neither (one that
 * only speaks) gets its first unit on all three stages, as a provider with one unit always did.
 */
export function wholePlan(p: AnyProvider): RunPlan {
  const whole = unitServing(p, RUN_STAGES);
  if (!whole) {
    const text = unitServing(p, TR_TL);
    const speech = unitServing(p, SP);
    if (text && speech) return { units: [text, speech], byStage: { transcription: text, translation: text, speech } };
  }
  const u: PlannedUnit = whole ?? { provider: p, unit: unitsOf(p)[0], stages: RUN_STAGES };
  return { units: [u], byStage: { transcription: u, translation: u, speech: u } };
}

/**
 * What a reader asks of a provider as a whole: whether it speaks and whether its participant may, read off
 * `'speech'`, and face-to-face, read off `'transcription'`. These come from the unit that serves the stage in a
 * run on it alone, under its default settings, which no unit reads for these.
 */
export function capabilitiesAlone(p: AnyProvider, stage: RunStage): UnitCapabilities {
  return wholePlan(p).byStage[stage].unit.capabilities(p.settings.defaults);
}
