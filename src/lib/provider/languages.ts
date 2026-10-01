/**
 * The language rules every provider shares (spec: "Languages are two
 * functions"). What differs between providers lives inside its `sources`,
 * `targets` and optional `reverse`; nothing here names a provider. Each rule
 * takes an optional language context (Stage 2 Volcengine AST2, choice 1):
 * under one, the offer for it; without, the provider's widest offer.
 */
import { AUTO } from '../language/code';
import type { LanguageContext, LanguageOption, LanguagePair, Provider } from './types';

/** The source value that asks the provider to detect the language. Never a target. Defined with the app code. */
export { AUTO };

/** Only the language functions are read, so a provider of any `K` and `C` fits. */
type Languages<S> = Pick<Provider<S, never, never>, 'languages'>;

function offers(options: readonly LanguageOption[], value: string): boolean {
  return options.some((o) => o.value === value);
}

/**
 * The pair the other way round, by the provider's own `reverse` where it
 * states one (Stage 2 Palabra, ruling 9: Palabra's documented target → source
 * and source → target codes) and otherwise the plain swap. Null: this pair
 * has no reverse. Whether the provider offers it is `reverseSupported`'s.
 */
export function reversedPair<S>(p: Languages<S>, s: S, pair: LanguagePair): LanguagePair | null {
  return p.languages.reverse ? p.languages.reverse(pair, s) : { source: pair.target, target: pair.source };
}

/**
 * Whether the provider supports the reversed pair: its source among the
 * provider's sources, and its target among that source's targets. It decides
 * both the swap button and whether the participant leg may open (D20). An
 * `AUTO` source never reverses (D20), whatever a provider's own `reverse`
 * hook would return for it.
 */
export function reverseSupported<S>(p: Languages<S>, s: S, pair: LanguagePair, context?: LanguageContext): boolean {
  if (pair.source === AUTO) return false;
  const reversed = reversedPair(p, s, pair);
  return reversed !== null && offers(p.languages.sources(s, context), reversed.source) && offers(p.languages.targets(reversed.source, s, context), reversed.target);
}

/** The reversed pair; null when the provider does not support it, or when it is the same pair. */
export function swapped<S>(p: Languages<S>, s: S, pair: LanguagePair, context?: LanguageContext): LanguagePair | null {
  const reversed = reversedPair(p, s, pair);
  if (reversed === null || !reverseSupported(p, s, pair, context)) return null;
  return reversed.source === pair.source && reversed.target === pair.target ? null : reversed;
}

/**
 * A pair the provider offers, keeping what it can of `pair`: its source when
 * listed, else the first source; its target when listed for that source, else
 * that source's first target. Every registered provider offers at least one
 * source, and at least one target for each, in every context (`registry.test.ts`).
 */
export function normalizePair<S>(p: Languages<S>, s: S, pair: Partial<LanguagePair>, context?: LanguageContext): LanguagePair {
  const sources = p.languages.sources(s, context);
  const source = pair.source !== undefined && offers(sources, pair.source) ? pair.source : sources[0].value;
  const targets = p.languages.targets(source, s, context);
  const target = pair.target !== undefined && offers(targets, pair.target) ? pair.target : targets[0].value;
  return { source, target };
}
