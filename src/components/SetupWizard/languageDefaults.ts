// src/components/SetupWizard/languageDefaults.ts
//
// Sensible starting values for the language-pair step. Providers spell codes
// differently ('zh_CN', 'zh-CN', 'ja', 'ja-JP'), so matching is tolerant, in
// that order of strictness: exact, normalised, primary subtag.
import type { LanguageOption } from '../../services/providers/ProviderConfig';

const norm = (code: string) => code.toLowerCase().replace(/_/g, '-');
const primary = (code: string) => norm(code).split('-')[0];

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
  const target = english && english !== source ? english : fallback;
  return { source, target };
}
