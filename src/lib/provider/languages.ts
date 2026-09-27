/**
 * The language rules every provider shares (spec: "Languages are two
 * functions"). What differs between providers lives inside its `sources` and
 * `targets`; nothing here names a provider. Each rule takes an optional
 * language context (Stage 2 Volcengine AST2, choice 1): under one, the offer
 * for it; without, the provider's widest offer.
 */
import type { LanguageContext, LanguageOption, LanguagePair, Provider } from './types';

/** The source value that asks the provider to detect the language. Never a target. */
export const AUTO = 'auto';

/** Only the two language functions are read, so a provider of any `K` and `C` fits. */
type Languages<S> = Pick<Provider<S, never, never>, 'languages'>;

function offers(options: readonly LanguageOption[], value: string): boolean {
  return options.some((o) => o.value === value);
}

/**
 * Whether the provider supports the reversed pair: the target among its
 * sources, and the source among that target's targets. It decides both the
 * swap button and whether the participant leg may open (D20). `AUTO` is never
 * a target, so an `AUTO` source never reverses.
 */
export function reverseSupported<S>(p: Languages<S>, s: S, pair: LanguagePair, context?: LanguageContext): boolean {
  return offers(p.languages.sources(s, context), pair.target) && offers(p.languages.targets(pair.target, s, context), pair.source);
}

/** The reversed pair; null when the provider does not support it, or when it is the same pair. */
export function swapped<S>(p: Languages<S>, s: S, pair: LanguagePair, context?: LanguageContext): LanguagePair | null {
  if (pair.source === pair.target || !reverseSupported(p, s, pair, context)) return null;
  return { source: pair.target, target: pair.source };
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
