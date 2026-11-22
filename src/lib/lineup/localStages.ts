// src/lib/lineup/localStages.ts
//
// What the local provider reads from a stored line-up: for translation and
// for speech, whether the stage goes to a model on this machine or to another
// provider (Bing and Edge are providers of their own, so never "local"); and,
// where it serves one of transcription and translation without the other,
// which.
import { RUN_STAGES } from './types';
import type { LineUp, RunStage } from './types';

/**
 * Per stage, what the local provider serves: `translation` and `speech` by a model on this machine, or null where
 * another provider serves the stage. It transcribes whenever it translates, in one session, and not otherwise,
 * unless `transcription` says so: null, another provider transcribes and this one translates what that one heard;
 * 'local', a model on this machine transcribes and another provider translates what it heard. `transcription` is
 * stated only in those two cases, so every value written before reads as it did.
 */
export interface LocalStages { translation: 'local' | null; speech: 'local' | null; transcription?: 'local' | null }

const HOST = 'local_inference';

/**
 * Every stage on this machine: what the local provider resolves under where no line-up gives it a stage. Never a
 * null there: a null reaches model resolution with Bing and Edge among the choices. One object, so a memo holds.
 */
export const ALL_LOCAL_STAGES: Readonly<LocalStages> = Object.freeze({ translation: 'local', speech: 'local' });

/**
 * Null when there is no line-up, or the local provider serves no stage of it: then it resolves as today.
 * Otherwise each member says what the local provider serves of that stage, and is null where another provider
 * serves it.
 */
export function localStagesOf(lineUp: LineUp | Pick<LineUp, RunStage> | null): LocalStages | null {
  if (!lineUp || !RUN_STAGES.some((stage) => lineUp[stage] === HOST)) return null;
  const stages: LocalStages = {
    translation: lineUp.translation === HOST ? 'local' : null,
    speech: lineUp.speech === HOST ? 'local' : null,
  };
  const transcribes = lineUp.transcription === HOST;
  // It translates and another provider transcribes: no recognition model of this machine runs.
  if (stages.translation !== null && !transcribes) stages.transcription = null;
  // It transcribes and another provider translates: a recognition model of this machine runs, and no translation model.
  if (stages.translation === null && transcribes) stages.transcription = 'local';
  return stages;
}

/**
 * The same for the local provider's voice, which may read another provider's text. Never null: a line-up that
 * gives the local provider no stage, or none, reads as its speech models alone.
 */
export function localSpeechStagesOf(lineUp: Pick<LineUp, RunStage> | null): LocalStages {
  return localStagesOf(lineUp) ?? { translation: null, speech: 'local' };
}

/**
 * The same for the local provider's translation as a unit of its own, which translates what another provider
 * heard with a translation model on this machine; never a recognition model. Speech is what the line-up says of
 * it; with no line-up, none.
 */
export function localTranslationStagesOf(lineUp: Pick<LineUp, RunStage> | null): LocalStages {
  const stages = localStagesOf(lineUp);
  return { translation: 'local', speech: stages?.speech ?? null, transcription: null };
}

/**
 * The same for the local provider's recognition as a unit of its own, which transcribes for another provider to
 * translate: a recognition model on this machine, never a translation model. Speech is what the line-up says of it;
 * with no line-up, none.
 */
export function localTranscriptionStagesOf(lineUp: Pick<LineUp, RunStage> | null): LocalStages {
  const stages = localStagesOf(lineUp);
  return { translation: null, speech: stages?.speech ?? null, transcription: 'local' };
}

/**
 * The local engine's stages (`asr`, `translation`, `tts`) another provider serves in a stored line-up: speech
 * where the line-up gives it elsewhere, recognition with translation where it gives translation elsewhere (unless
 * this device transcribes alone), and recognition alone where another provider transcribes what this one
 * translates. None without a stored line-up. No model of this machine runs for such a stage, and none is missing
 * for it.
 */
export function unservedStages(stages: Readonly<LocalStages> | null): Array<'asr' | 'translation' | 'tts'> {
  if (!stages) return [];
  const transcribes = stages.transcription === 'local' || (stages.translation !== null && stages.transcription !== null);
  return [
    ...(transcribes ? [] : (['asr'] as const)),
    ...(stages.translation === null ? (['translation'] as const) : []),
    ...(stages.speech === null ? (['tts'] as const) : []),
  ];
}
