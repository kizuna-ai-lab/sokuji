// src/lib/lineup/localStages.ts
//
// What the local provider reads from a stored line-up: for translation and
// for speech, whether the stage goes to Bing or Edge (providers of their own
// that it runs), to a model on this machine, or to another provider.
import { optionFor } from './catalog';
import { RUN_STAGES } from './types';
import type { LineUp, RunStage } from './types';

/**
 * Per stage, what the local provider serves: `translation` by Bing or by a model on this machine, `speech` by
 * Edge or by a model on this machine; null where another provider serves the stage. It transcribes whenever it
 * translates: its transcription and translation run in one session.
 */
export interface LocalStages { translation: 'bing' | 'local' | null; speech: 'edge' | 'local' | null }

const HOST = 'local_inference';

/**
 * Null when there is no line-up, or the local provider serves no stage of it: then it resolves as today.
 * Otherwise each member says what the local provider serves of that stage, and is null where another provider
 * serves it.
 */
export function localStagesOf(lineUp: LineUp | Pick<LineUp, RunStage> | null): LocalStages | null {
  if (!lineUp || !RUN_STAGES.some((stage) => optionFor(lineUp, stage)?.host === HOST)) return null;
  const here = (stage: RunStage) => optionFor(lineUp, stage)?.host === HOST;
  return {
    translation: !here('translation') ? null : lineUp.translation === 'bing' ? 'bing' : 'local',
    speech: !here('speech') ? null : lineUp.speech === 'edge' ? 'edge' : 'local',
  };
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
 * The local engine's stages (`asr`, `translation`, `tts`) another provider serves in a stored line-up: speech
 * where the line-up gives it elsewhere, and recognition with translation where it gives translation elsewhere.
 * None without a stored line-up. No model of this machine runs for such a stage, and none is missing for it.
 */
export function unservedStages(stages: LocalStages | null): Array<'asr' | 'translation' | 'tts'> {
  if (!stages) return [];
  return [...(stages.translation === null ? (['asr', 'translation'] as const) : []), ...(stages.speech === null ? (['tts'] as const) : [])];
}
