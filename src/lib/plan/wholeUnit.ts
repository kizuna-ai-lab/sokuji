// src/lib/plan/wholeUnit.ts
//
// A provider seen as one unit: it serves every stage together, as it does
// today. Pure functions over the provider definition.
import { RUN_STAGES } from '../lineup/types';
import type { AnyProvider } from '../provider/types';
import { sameStages } from './types';
import type { UnitDefinition } from './types';

/** The unit that is the whole provider: all three stages, or recognition and translation when it need not speak. */
export function wholeUnit(p: AnyProvider): UnitDefinition {
  return {
    id: 'whole',
    occupies: (_s, want) => {
      if (sameStages(RUN_STAGES, want)) return RUN_STAGES;
      if (p.speech !== 'always' && sameStages(['transcription', 'translation'], want)) return ['transcription', 'translation'];
      return null;
    },
    capabilities: s => ({
      speech: p.speech,
      turns: p.turns(s),
      turnOwner: 'either',
      boundaries: p.boundaries(s),
      textInput: p.textInput(s),
      faceToFace: p.faceToFace === true,
      participantSpeech: p.participantSpeech !== false,
    }),
    build: (context, s, shared) => p.build(context, s, shared),
    describe: p.describe,
    start: p.start,
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
