/**
 * What Kizuna AI's backend charges a managed Qwen session to start, mirrored
 * so the start gate can be right before the backend says so (spec
 * 2026-10-17-kizuna-managed-qwen). KEEP IN SYNC with sokuji-backend's
 * `computeQwenBudget` (`floorMicroUsd`), its Qwen list prices and its K per
 * region (`QWEN_REGION_CONFIG`), and for the screen-context add-on its
 * `QWEN_WORST_TOKENS_PER_S.imageIn` (240) and `qwenScreenContextUsdPerHour`;
 * `kizunaBudget.test.ts` restates the arithmetic. The backend's 402 stays the
 * authority.
 */
import type { BalanceShape } from '../../lib/session/types';
import { asQwenRegion, type QwenRegion } from './regions';
import type { QwenSettings } from './settings';

/**
 * One leg's rate in µUSD per hour by region: a leg that speaks, and one that
 * only shows text. Integers, so the floor's ceil is exact. Singapore's is the
 * backend's own figure, USD list prices × K 1.4. Beijing's list prices are
 * CNY (14.472 and 3.672 CNY/h after K 1.5), which the backend converts at the
 * day's rate; the client floors them at 8 CNY per USD, above any rate the
 * backend converts at, so the gate never refuses a start the backend would
 * grant — a balance between the two floors reaches the backend, whose 402
 * words it.
 */
export const QWEN_RATE_MICRO_USD_PER_HOUR: Record<QwenRegion, { readonly speaking: number; readonly text: number }> = {
  sg: { speaking: 2_557_800, text: 667_800 },
  cn: { speaking: 1_809_000, text: 459_000 },
};
/**
 * The screen-context add-on per leg, in µUSD per hour by region: 240 image
 * tokens per second of speech at the image-input list price, after K.
 * Singapore: 240 × 0.55 USD per million × 3600 × 1.4. Beijing: 240 × 3.3 CNY
 * per million × 3600 × 1.5, at the same 8 CNY per USD floor as the rates above.
 */
export const QWEN_SCREEN_MICRO_USD_PER_HOUR: Record<QwenRegion, number> = { sg: 665_280, cn: 534_600 };
/** The shortest session the backend starts, in seconds. */
export const QWEN_MANAGED_MIN_SESSION_S = 60;

/**
 * Kizuna Qwen's `minimumBalance`: the backend's floor for this start's legs
 * in the region picked. A leg speaks when it is the speaker and not
 * text-only, or the participant with participant speech (the lease's own
 * rule for `speech`). While the screen-context switch is on every leg also
 * carries the add-on. The gate reads the switch, before the pick, so it is
 * conservative on purpose: a cancelled pick only lowers the real floor, and
 * the backend's 402 stays the authority.
 */
export function kizunaQwenMinimumBalance(shape: BalanceShape, s: Pick<QwenSettings, 'region' | 'screenContext'>): number {
  const region = asQwenRegion(s.region);
  const rate = QWEN_RATE_MICRO_USD_PER_HOUR[region];
  const speaking = (shape.legs.includes('speaker') && !shape.textOnly ? 1 : 0) + (shape.legs.includes('participant') && shape.participantSpeech ? 1 : 0);
  const screen = s.screenContext === true ? shape.legs.length * QWEN_SCREEN_MICRO_USD_PER_HOUR[region] : 0;
  const perHour = speaking * rate.speaking + (shape.legs.length - speaking) * rate.text + screen;
  return Math.ceil((perHour * QWEN_MANAGED_MIN_SESSION_S) / 3600);
}
