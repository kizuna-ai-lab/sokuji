/**
 * What Kizuna AI's backend charges a managed Qwen session to start, mirrored
 * so the start gate can be right before the backend says so (spec
 * 2026-10-17-kizuna-managed-qwen). KEEP IN SYNC with sokuji-backend's
 * `floorMicroUsd` and its Qwen rates; `kizunaBudget.test.ts` restates the
 * arithmetic. The backend's 402 stays the authority.
 */
import type { BalanceShape } from '../../lib/session/types';

/** One leg's rate in µUSD per hour: a leg that speaks, and one that only shows text. Integers, so the floor's ceil is exact. */
export const QWEN_RATE_MICRO_USD_PER_HOUR = { speaking: 3_654_000, text: 954_000 } as const;
/** The shortest session the backend starts, in seconds. */
export const QWEN_MANAGED_MIN_SESSION_S = 60;

/**
 * Kizuna Qwen's `minimumBalance`: the backend's floor for this start's legs.
 * A leg speaks when it is the speaker and not text-only, or the participant
 * with participant speech (the lease's own rule for `speech`).
 */
export function kizunaQwenMinimumBalance(shape: BalanceShape): number {
  const speaking = (shape.legs.includes('speaker') && !shape.textOnly ? 1 : 0) + (shape.legs.includes('participant') && shape.participantSpeech ? 1 : 0);
  const rate = speaking * QWEN_RATE_MICRO_USD_PER_HOUR.speaking + (shape.legs.length - speaking) * QWEN_RATE_MICRO_USD_PER_HOUR.text;
  return Math.ceil((rate * QWEN_MANAGED_MIN_SESSION_S) / 3600);
}
