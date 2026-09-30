/**
 * OpenAI Live's `C`, `build` and `describe`. One builder for
 * both legs: the participant is the same call on the reversed direction, so
 * its prompt (Other's, in Advanced mode) follows from `context` — the old
 * participant swap (`OpenAILiveProviderConfig.ts:101-103`) is gone, and D20
 * refuses an `auto` source for it. A leg that does not speak builds the same
 * config: the API always speaks, and the adapter drops the audio (ruling 1).
 */
import type { SessionContext } from '../../lib/contract/adapter';
import { resolveInstructions } from '../../lib/provider/instructions';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { clampSegmentPauseMs, segmentPauseMs } from '../../lib/segmentation/segmentationMode';
import { LIVE_DEFAULT_VOICE, LIVE_LANGUAGES, LIVE_MODEL, LIVE_VOICES, liveLanguageName, type LiveSettings } from './settings';

export interface LiveConfig {
  model: typeof LIVE_MODEL;
  /** This direction's prompt: the whole of what makes the model an interpreter. */
  instructions: string;
  /** One of `LIVE_VOICES`. */
  voice: string;
  /** Each side's silence timer, and the source's mid-sentence deferral in sentence mode (as OpenAI Translate's). */
  silence: { sourceMs: number; translationMs: number; deferMidSentence: boolean };
  /**
   * The source sentences a segment holds before it is cut (ruling 4; choice
   * 7): the display's N in sentence mode, 0 for none there; 1 by pause or
   * off.
   */
  sentencesPerSegment: number;
  /** WebSocket only. It reaches `info.transport`, which analytics reports. */
  transport: 'websocket';
}

export function buildLive(context: SessionContext, s: LiveSettings, shared: SharedSettings): LiveConfig | ProviderRefusal {
  const { source, target } = context.direction;
  // A guard: the languages offer the 55 targets only, so the runner never builds another.
  if (!LIVE_LANGUAGES.some((o) => o.value === target)) return { refused: `OpenAI Live does not translate into ${target}.` };
  const sentences = shared.segmentation.mode === 'sentences';
  return {
    model: LIVE_MODEL,
    // The participant's direction reads Other's prompt, as the other builders do.
    instructions: resolveInstructions(s, { participant: shared.reversed(context.direction), source: liveLanguageName(source), target: liveLanguageName(target) }),
    voice: LIVE_VOICES.some((v) => v.value === s.voice) ? s.voice : LIVE_DEFAULT_VOICE,
    silence: {
      sourceMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.sourceSeconds)),
      translationMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.translationSeconds)),
      deferMidSentence: sentences,
    },
    sentencesPerSegment: sentences ? Math.max(0, Math.round(shared.segmentation.sentencesPerRow)) : 1,
    transport: 'websocket',
  };
}

/** One model: it transcribes both sides itself. */
export function describeLive(c: LiveConfig): { translationModel: string; asrModel: string } {
  return { translationModel: c.model, asrModel: c.model };
}
