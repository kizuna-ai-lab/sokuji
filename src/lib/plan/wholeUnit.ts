// src/lib/plan/wholeUnit.ts
//
// A provider seen as one unit: it serves every stage together, as it does
// today, and the plan of a run on it alone. Pure functions over the provider
// definition.
import { RUN_STAGES } from '../lineup/types';
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

const cache = new WeakMap<AnyProvider, readonly UnitDefinition[]>();

/** A provider's units: its own list when it declares one (step 2 on), else its whole-provider unit. Same array for the same provider. */
export function unitsOf(p: AnyProvider): readonly UnitDefinition[] {
  let units = cache.get(p);
  if (!units) {
    units = (p as { units?: readonly UnitDefinition[] }).units ?? [wholeUnit(p)];
    cache.set(p, units);
  }
  return units;
}

/** The plan in which a provider's first unit serves all three stages: a run of that provider alone. */
export function wholePlan(p: AnyProvider): RunPlan {
  const u: PlannedUnit = { provider: p, unit: unitsOf(p)[0], stages: RUN_STAGES };
  return { units: [u], byStage: { transcription: u, translation: u, speech: u } };
}
