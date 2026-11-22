// src/lib/plan/wholeUnit.ts
//
// A provider seen as one unit: it serves every stage together, as it does
// today, and the plan of a run on it alone. Pure functions over the provider
// definition.
import { RUN_STAGES, SP, TR_TL } from '../lineup/types';
import type { RunStage } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import { sameStages } from './types';
import type { PlannedUnit, RunPlan, UnitDefinition } from './types';

/**
 * The unit that is the whole provider: all three stages, or recognition and translation when it need not speak.
 * A view of the definition, not a copy: every member reads the definition when it is used, so the unit runs
 * what the definition holds then, and a read asks the definition exactly what generic code asked it before.
 */
export function wholeUnit(p: AnyProvider): UnitDefinition {
  return {
    id: 'whole',
    occupies: (_s, want) => {
      if (sameStages(RUN_STAGES, want)) return RUN_STAGES;
      if (p.speech !== 'always' && sameStages(['transcription', 'translation'], want)) return ['transcription', 'translation'];
      return null;
    },
    // A capability backed by a function is asked when it is read: a reader of one capability calls that function only.
    capabilities: s => ({
      speech: p.speech,
      get turns() { return p.turns(s); },
      turnOwner: 'either',
      get boundaries() { return p.boundaries(s); },
      get textInput() { return p.textInput(s); },
      faceToFace: p.faceToFace === true,
      participantSpeech: p.participantSpeech !== false,
    }),
    build: (context, s, shared) => p.build(context, s, shared),
    get describe() { return p.describe; },
    get start() { return p.start; },
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

const cache = new WeakMap<AnyProvider, readonly UnitDefinition[]>();

/** A provider's units: its own list when it declares one (step 2 on), else its whole-provider unit. Same array for the same provider. */
export function unitsOf(p: AnyProvider): readonly UnitDefinition[] {
  let units = cache.get(p);
  if (!units) {
    units = p.units ?? [wholeUnit(p)];
    cache.set(p, units);
  }
  return units;
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
