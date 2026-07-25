/**
 * Threshold resolution for the vad-web FrameProcessor.
 *
 * vad-web uses two thresholds: speech starts above `positiveSpeechThreshold`,
 * and the redemption (silence) countdown only advances below
 * `negativeSpeechThreshold`. The negative one MUST sit below the positive one —
 * otherwise every frame that resets the countdown also increments it, the
 * counter never reaches the redemption length, and speech only ends when the
 * probability drops below the positive threshold anyway. vad-web's own
 * `validateOptions` logs an error for that case but still runs with it.
 *
 * Since only `threshold` is user-configurable, lowering it (to catch quiet
 * speech) used to push it under the hard-coded 0.25 default and silently
 * disable endpoint detection — utterances then ran until the max-duration cap.
 * Deriving and clamping here keeps the pair consistent whatever the user picks.
 */

import type { VadWebConfig } from '../../types';

/** vad-web's default positive speech threshold. */
export const DEFAULT_POSITIVE_THRESHOLD = 0.3;

/** Silero's convention: the negative threshold sits this far below the positive one. */
export const NEGATIVE_THRESHOLD_OFFSET = 0.15;

/** Floor for the negative threshold — 0 would never confirm silence. */
export const MIN_NEGATIVE_THRESHOLD = 0.01;

export interface ResolvedVadThresholds {
  positive: number;
  negative: number;
}

export function resolveVadThresholds(config?: Pick<VadWebConfig, 'threshold' | 'negativeThreshold'>): ResolvedVadThresholds {
  const positive = config?.threshold ?? DEFAULT_POSITIVE_THRESHOLD;
  const requested = config?.negativeThreshold ?? positive - NEGATIVE_THRESHOLD_OFFSET;
  const clamped = Math.max(Math.min(requested, positive), MIN_NEGATIVE_THRESHOLD);
  // Thresholds are two-decimal knobs; keep the derived value out of float dust
  // (0.2 - 0.15 = 0.05000000000000002) so logs and comparisons stay readable.
  return { positive, negative: Math.round(clamped * 100) / 100 };
}
