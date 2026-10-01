/**
 * Palabra AI's `C`, `build` and `describe` (survey §2.7). One builder for
 * both legs: the participant is the same call on the reversed direction
 * (D17) — Palabra's own reverse (ruling 9) — and it speaks when its switch
 * is on; a leg that does not speak asks for text alone (ruling 7).
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { effectiveQueue, effectiveThreshold, palabraOffers, type PalabraSettings, type PalabraVoice } from './settings';

export interface PalabraConfig {
  source: string;
  target: string;
  /** Translated speech at all: without it the task's `output_stream` is null, and Palabra sends the text alone (ruling 7; the owner's probe). */
  speech: boolean;
  voiceId: PalabraVoice;
  /** Clamped to the API's range (ruling 10). */
  silenceThreshold: number;
  sentenceSplitter: boolean;
  translatePartials: boolean;
  /** The max always above the target (ruling 10). */
  queue: { desiredMs: number; maxMs: number; autoTempo: boolean };
}

export function buildPalabra(context: SessionContext, s: PalabraSettings, _shared: SharedSettings): PalabraConfig | ProviderRefusal {
  const { source, target } = context.direction;
  // A guard: the provider store keeps the pair within the offer, and the gate refused a participant whose reverse is not offered (D20).
  if (!palabraOffers(context.direction)) return { refused: `Palabra AI does not translate ${source} → ${target}.` };
  return {
    source,
    target,
    speech: context.speech,
    voiceId: s.voiceId,
    silenceThreshold: effectiveThreshold(s),
    sentenceSplitter: s.sentenceSplitterEnabled,
    translatePartials: s.translatePartialTranscriptions,
    queue: { ...effectiveQueue(s), autoTempo: s.autoTempo },
  };
}

/** No model to name: the old start reported none for Palabra (survey §1.8). */
export function describePalabra(_c: PalabraConfig): Record<string, never> {
  return {};
}
