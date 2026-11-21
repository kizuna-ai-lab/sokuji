// src/lib/lineup/localStages.ts
//
// What the local provider reads from a stored line-up: whether translation
// and speech go to Bing and Edge (providers of their own) or to a model on
// this machine.
import { soleHost } from './catalog';
import type { LineUp, RunStage } from './types';

export interface LocalStages { translation: 'bing' | 'local'; speech: 'edge' | 'local' }

/** Null when no line-up is stored or the line-up does not run on the local provider: then it resolves as today. */
export function localStagesOf(lineUp: LineUp | Pick<LineUp, RunStage> | null): LocalStages | null {
  if (!lineUp || soleHost(lineUp) !== 'local_inference') return null;
  return { translation: lineUp.translation === 'bing' ? 'bing' : 'local', speech: lineUp.speech === 'edge' ? 'edge' : 'local' };
}

/**
 * The same for the local provider's voice alone, which may read another provider's text: Edge when the line-up
 * gives speech to it, else a speech model on this machine. Where the whole line-up runs on the local provider the
 * answer is `localStagesOf`'s; elsewhere only `speech` is meant, and translation is not this provider's.
 */
export function localSpeechStagesOf(lineUp: Pick<LineUp, RunStage>): LocalStages {
  return localStagesOf(lineUp) ?? { translation: 'local', speech: lineUp.speech === 'edge' ? 'edge' : 'local' };
}
