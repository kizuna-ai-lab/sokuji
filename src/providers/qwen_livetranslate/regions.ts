/**
 * The regions Kizuna AI's managed Qwen runs in. Alibaba serves LiveTranslate
 * from two accounts in two places, each with its own key pool, prices and
 * storefront; the user picks one, as they pick a Soniox region, and the
 * backend tells the lease which endpoint that region dials.
 */

export type QwenRegion = 'sg' | 'cn';

export const QWEN_REGIONS: readonly QwenRegion[] = ['sg', 'cn'] as const;

export const DEFAULT_QWEN_REGION: QwenRegion = 'sg';

/**
 * Dropdown labels. Deliberately NOT locale keys, the rule `SONIOX_REGION_LABELS`
 * follows: a place is named in its own language, so adding a region does not
 * mean editing 30 catalogs before it can be offered.
 */
export const QWEN_REGION_LABELS: Record<QwenRegion, string> = {
  sg: 'Singapore',
  cn: '北京 (Beijing)',
};

/** A stored or received value as a region, else the default: a setting must load into a working session, never into a refused start. */
export function asQwenRegion(value: unknown): QwenRegion {
  return typeof value === 'string' && (QWEN_REGIONS as readonly string[]).includes(value)
    ? (value as QwenRegion)
    : DEFAULT_QWEN_REGION;
}
