import type { LegName } from '../../lib/conversation/types';
import type { LanguagePair } from '../../lib/provider/types';

/** The hosts always supply `pair`; this matters only standalone (a test, the dev preview). */
export const FALLBACK_PAIR: LanguagePair = { source: 'ja', target: 'en' };

/**
 * `legs` → the audio mode a start would run: more than one leg is `'both'`,
 * one leg is itself, none falls back to `'speaker'`. LocalInference keeps the
 * same three lines in its own folder: a provider imports no other provider's
 * folder. Its own module, so the cheap `EngineSummary` and `check` do not
 * import the `Engine` chain.
 */
export function modeOfLegs(legs: readonly LegName[]): 'speaker' | 'participant' | 'both' {
  return legs.length > 1 ? 'both' : legs[0] ?? 'speaker';
}
