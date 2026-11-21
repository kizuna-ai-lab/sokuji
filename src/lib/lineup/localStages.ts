// src/lib/lineup/localStages.ts
//
// What the local provider reads from a stored line-up: whether translation
// and speech go to Bing and Edge (providers of their own) or to a model on
// this machine.
import { optionFor } from './catalog';
import { RUN_STAGES } from './types';
import type { LineUp, RunStage } from './types';

export interface LocalStages { translation: 'bing' | 'local'; speech: 'edge' | 'local' }

/**
 * Null when there is no line-up, or the local provider serves no stage of it: then it resolves as today.
 * Otherwise the answer is for the stages the local provider serves; where another provider serves translation or
 * speech, that member is not this provider's and reads 'local'.
 */
export function localStagesOf(lineUp: LineUp | Pick<LineUp, RunStage> | null): LocalStages | null {
  if (!lineUp || !RUN_STAGES.some((stage) => optionFor(lineUp, stage)?.host === 'local_inference')) return null;
  return { translation: lineUp.translation === 'bing' ? 'bing' : 'local', speech: lineUp.speech === 'edge' ? 'edge' : 'local' };
}

/**
 * The same for the local provider's voice, which may read another provider's text: Edge when the line-up gives
 * speech to it, else a speech model on this machine. Never null: a line-up that gives the local provider no stage
 * reads as its models.
 */
export function localSpeechStagesOf(lineUp: Pick<LineUp, RunStage>): LocalStages {
  return localStagesOf(lineUp) ?? { translation: 'local', speech: 'local' };
}
