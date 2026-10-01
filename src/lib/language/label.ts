/**
 * Language names (spec §2): any app code named in the UI language from
 * CLDR, via `Intl.DisplayNames`. No hand-written per-provider names.
 */
import { parseCode, type LanguageCode } from './code';

/**
 * A CLDR name that is wrong for us, by tag and then UI locale (or its base
 * language). Ships empty; every entry needs a stated reason in a comment.
 */
const OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = {};

const namers = new Map<string, Intl.DisplayNames | null>();

function namer(locale: string): Intl.DisplayNames | null {
  if (!namers.has(locale)) {
    try {
      namers.set(locale, new Intl.DisplayNames([locale], { type: 'language' }));
    } catch {
      namers.set(locale, null);
    }
  }
  return namers.get(locale) ?? null;
}

/** An i18next language id (`zh_TW`, `pt_BR`, `ja`) as a BCP-47 locale; English when absent or not a locale (`cimode`). */
export function uiLocale(i18nLanguage: string | undefined | null): string {
  const id = (i18nLanguage ?? '').replace(/_/g, '-');
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(id)) return 'en';
  try {
    return Intl.getCanonicalLocales(id)[0] ?? 'en';
  } catch {
    return 'en';
  }
}

/** `code` named in `uiLanguage` (an i18next id). `auto` takes `autoLabel`; `a+b` reads `A ⇄ B`; a code it cannot name stays the code. */
export function languageLabel(code: LanguageCode, uiLanguage: string | undefined | null, autoLabel = 'Auto Detect'): string {
  const ui = uiLocale(uiLanguage);
  const parsed = parseCode(code);
  if (parsed === null) return code;
  if (parsed.kind === 'auto') return autoLabel;
  if (parsed.kind === 'pair') return `${languageLabel(parsed.a, ui)} ⇄ ${languageLabel(parsed.b, ui)}`;
  const override = OVERRIDES[parsed.tag]?.[ui] ?? OVERRIDES[parsed.tag]?.[ui.split('-')[0]];
  if (override) return override;
  let name: string | undefined;
  try {
    name = namer(ui)?.of(parsed.tag);
  } catch {
    name = undefined;
  }
  if (!name || name === parsed.tag) return code;
  // CLDR's names are mid-sentence forms ("español", "norsk"); a menu starts them capitalized.
  return name.charAt(0).toLocaleUpperCase(ui) + name.slice(1);
}

/** The code's English name, for instruction templates and logs. */
export function englishLanguageName(code: LanguageCode): string {
  return languageLabel(code, 'en');
}
