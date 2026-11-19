// src/lib/lineup/localStages.ts
//
// What the local provider reads from a stored line-up: whether translation
// and speech go to Bing and Edge (providers of their own) or to a model on
// this machine.
import { soleHost } from '../plan/read';
import type { LineUp } from './types';

export interface LocalStages { translation: 'bing' | 'local'; speech: 'edge' | 'local' }

/** Null when no line-up is stored or the line-up does not run on the local provider: then it resolves as today. */
export function localStagesOf(lineUp: LineUp | null): LocalStages | null {
  if (!lineUp || soleHost(lineUp) !== 'local_inference') return null;
  return { translation: lineUp.translation === 'bing' ? 'bing' : 'local', speech: lineUp.speech === 'edge' ? 'edge' : 'local' };
}
