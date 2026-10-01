/**
 * OpenAI Translate's `C`, `build` and `describe` (survey §2.7). One builder
 * for both legs: the participant is the same call on the reversed direction,
 * so its target — the pair's source — follows from `context` (D17). The old
 * participant swap and its skip-the-leg guard
 * (`OpenAITranslateProviderConfig.ts:121-157`) are gone: D20 refuses the
 * start instead. The source is never sent — the model detects what is
 * spoken — and a leg that does not speak builds the same config: the API
 * cannot stop speaking, so the adapter drops the audio (ruling 4).
 */
import type { SessionContext } from '../../lib/contract/adapter';
import type { ProviderRefusal, SharedSettings } from '../../lib/provider/types';
import { clampSegmentPauseMs, segmentPauseMs } from '../../lib/segmentation/segmentationMode';
import { TRANSCRIPT_MODEL, TRANSLATE_MODEL, TRANSLATE_TARGETS, translateLanguages, type NoiseReduction, type TranslateSettings } from './settings';

export interface TranslateConfig {
  /** The endpoint's model, in the socket's `?model=` (ruling 7). */
  model: typeof TRANSLATE_MODEL;
  /** `audio.output.language`: this direction's target, one of the thirteen. */
  target: string;
  /** `audio.input.transcription.model` (ruling 8). */
  transcriptModel: typeof TRANSCRIPT_MODEL;
  /** `audio.input.noise_reduction`: a type, or `null`, which turns it off (ruling 9). */
  noiseReduction: 'near_field' | 'far_field' | null;
  /** Each side's silence timer and the mid-sentence deferral, as Gemini's Live Translate (choice 4). */
  silence: { sourceMs: number; translationMs: number; deferMidSentence: boolean };
  /** WebSocket only (ruling 1; choice 15): the owner abandoned WebRTC for this provider (2026-09-29). It reaches `info.transport`, which analytics reports. */
  transport: 'websocket';
}

const NOISE: Readonly<Record<NoiseReduction, TranslateConfig['noiseReduction']>> = {
  None: null,
  'Near field': 'near_field',
  'Far field': 'far_field',
};

export function buildTranslate(context: SessionContext, s: TranslateSettings, shared: SharedSettings): TranslateConfig | ProviderRefusal {
  const { target } = context.direction;
  // A guard: the languages offer the thirteen targets only, so the runner never builds another (survey §2.7).
  if (!TRANSLATE_TARGETS.some((o) => o.value === target)) return { refused: `OpenAI Translate does not translate into ${target}.` };
  return {
    model: TRANSLATE_MODEL,
    target: translateLanguages.wire!.toWire(target),
    transcriptModel: TRANSCRIPT_MODEL,
    noiseReduction: NOISE[s.noiseReduction],
    silence: {
      sourceMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.sourceSeconds)),
      translationMs: clampSegmentPauseMs(segmentPauseMs(shared.pauses.translationSeconds)),
      deferMidSentence: shared.segmentation.mode === 'sentences',
    },
    // Every session runs over WebSocket (ruling 1): a stored `transportType`, `webrtc` included, is not read into `S`.
    transport: 'websocket',
  };
}

/** Two models: the translation's and the source transcript's (choice 10). */
export function describeTranslate(c: TranslateConfig): { translationModel: string; asrModel: string } {
  return { translationModel: c.model, asrModel: c.transcriptModel };
}
