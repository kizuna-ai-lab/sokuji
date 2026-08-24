// src/components/SetupWizard/languageDefaults.ts
//
// Sensible starting values for the language-pair step. Providers spell codes
// differently ('zh_CN', 'zh-CN', 'ja', 'ja-JP'), so matching is tolerant, in
// that order of strictness: exact, normalised, primary subtag.
import type { LanguageOption } from '../../services/providers/ProviderConfig';
import { LANGUAGE_PRIORITY } from '../../utils/languages';

const norm = (code: string) => code.toLowerCase().replace(/_/g, '-');
const primary = (code: string) => norm(code).split('-')[0];

/** Same language, whatever the region: 'en' vs 'en-US', 'zh_CN' vs 'zh-cn'. */
const sameLanguage = (a: string, b: string) => primary(a) === primary(b);

/** Rank by LANGUAGE_PRIORITY, matched on primary subtag. Codes the list
 *  doesn't cover keep their relative order after every listed one — Array.sort
 *  is stable, so ranking everything unlisted to the same value preserves it. */
const priorityRank = (code: string): number => {
  const idx = LANGUAGE_PRIORITY.indexOf(primary(code));
  return idx === -1 ? Number.POSITIVE_INFINITY : idx;
};

export function matchLanguage(options: LanguageOption[], code: string): string | null {
  const exact = options.find((o) => o.value === code);
  if (exact) return exact.value;
  const loose = options.find((o) => norm(o.value) === norm(code));
  if (loose) return loose.value;
  const sub = options.find((o) => primary(o.value) === primary(code));
  return sub ? sub.value : null;
}

export function defaultLanguagePair(args: {
  sources: LanguageOption[];
  targetsFor: (source: string) => LanguageOption[];
  uiLanguage: string;
  providerDefault: { source: string; target: string };
}): { source: string; target: string } {
  const source =
    matchLanguage(args.sources, args.uiLanguage) ??
    matchLanguage(args.sources, args.providerDefault.source) ??
    args.sources[0]?.value ?? args.providerDefault.source;

  const targets = args.targetsFor(source);
  const english = matchLanguage(targets, 'en');
  const fallback = matchLanguage(targets, args.providerDefault.target) ?? targets[0]?.value ?? args.providerDefault.target;
  const preferred = english && !sameLanguage(english, source) ? english : fallback;

  // Translating a language into itself is not a translation, and it is exactly
  // what an English UI on an English-defaulting provider used to produce: the
  // English target is rejected for coinciding with the source, and the provider
  // default it falls back to is English too. Rank the non-source candidates by
  // LANGUAGE_PRIORITY rather than by whatever order the provider's list
  // happens to use (often alphabetical, which put e.g. Afrikaans first);
  // keep the coincidence only if the list offers nothing else.
  const target = sameLanguage(preferred, source)
    ? [...targets]
        .filter((o) => !sameLanguage(o.value, source))
        .sort((a, b) => priorityRank(a.value) - priorityRank(b.value))[0]?.value ?? preferred
    : preferred;
  return { source, target };
}
