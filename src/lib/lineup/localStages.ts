// src/lib/lineup/localStages.ts
//
// What the local provider reads from a stored line-up: for translation and
// for speech, whether the stage goes to Bing or Edge (providers of their own
// that it runs), to a model on this machine, or to another provider; and, where
// it serves one of transcription and translation without the other, which.
import { optionFor } from './catalog';
import { RUN_STAGES } from './types';
import type { LineUp, RunStage } from './types';

/**
 * Per stage, what the local provider serves: `translation` by Bing or by a model on this machine, `speech` by
 * Edge or by a model on this machine; null where another provider serves the stage. It transcribes whenever it
 * translates, in one session, and not otherwise, unless `transcription` says so: null, another provider
 * transcribes and this one translates what that one heard; 'local', a model on this machine transcribes and
 * another provider translates what it heard. `transcription` is stated only in those two cases, so every value
 * written before reads as it did.
 */
export interface LocalStages { translation: 'bing' | 'local' | null; speech: 'edge' | 'local' | null; transcription?: 'local' | null }

const HOST = 'local_inference';

/**
 * Null when there is no line-up, or the local provider serves no stage of it: then it resolves as today.
 * Otherwise each member says what the local provider serves of that stage, and is null where another provider
 * serves it.
 */
export function localStagesOf(lineUp: LineUp | Pick<LineUp, RunStage> | null): LocalStages | null {
  if (!lineUp || !RUN_STAGES.some((stage) => optionFor(lineUp, stage)?.host === HOST)) return null;
  // What the local provider serves of `stage`: the online service `online` when the line-up names it, else a model.
  const served = <T extends string>(stage: RunStage, online: T): T | 'local' | null => {
    if (optionFor(lineUp, stage)?.host !== HOST) return null;
    return lineUp[stage] === online ? online : 'local';
  };
  const stages: LocalStages = { translation: served('translation', 'bing'), speech: served('speech', 'edge') };
  const transcribes = optionFor(lineUp, 'transcription')?.host === HOST;
  // It translates and another provider transcribes: no recognition model of this machine runs.
  if (stages.translation !== null && !transcribes) stages.transcription = null;
  // It transcribes and another provider translates: a recognition model of this machine runs, and no translation model.
  if (stages.translation === null && transcribes) stages.transcription = 'local';
  return stages;
}

/**
 * The same for the local provider's voice, which may read another provider's text: Edge when the line-up gives
 * speech to it, else a speech model on this machine. Never null: a line-up that gives the local provider no stage
 * reads as its speech models alone.
 */
export function localSpeechStagesOf(lineUp: Pick<LineUp, RunStage>): LocalStages {
  return localStagesOf(lineUp) ?? { translation: null, speech: 'local' };
}

/**
 * The same for the local provider's translation as a unit of its own, which translates what another provider
 * heard: Bing when the line-up gives translation to it, else a translation model on this machine; never a
 * recognition model. Speech is what the line-up says of it.
 */
export function localTranslationStagesOf(lineUp: Pick<LineUp, RunStage>): LocalStages {
  const stages = localStagesOf(lineUp);
  return { translation: stages?.translation ?? 'local', speech: stages?.speech ?? null, transcription: null };
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
export function unservedStages(stages: LocalStages | null): Array<'asr' | 'translation' | 'tts'> {
  if (!stages) return [];
  const transcribes = stages.transcription === 'local' || (stages.translation !== null && stages.transcription !== null);
  return [
    ...(transcribes ? [] : (['asr'] as const)),
    ...(stages.translation === null ? (['translation'] as const) : []),
    ...(stages.speech === null ? (['tts'] as const) : []),
  ];
}
