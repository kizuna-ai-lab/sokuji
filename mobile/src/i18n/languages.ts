import { LANGUAGE_NAMES } from './languageNames';

/** A language as a picker offers it: the code the session needs, the name the user reads. */
export type LanguageOption = { code: string; name: string };

const rows = (uiLanguage: string) => LANGUAGE_NAMES[uiLanguage] ?? LANGUAGE_NAMES.en;
const english = new Map(LANGUAGE_NAMES.en);

/** `code` named in the interface language (an i18next id such as `zh_CN`); `auto` reads `autoLabel`. */
export function languageName(code: string, uiLanguage: string, autoLabel = 'Auto Detect'): string {
  if (code === 'auto') return autoLabel;
  return rows(uiLanguage).find(([c]) => c === code)?.[1] ?? english.get(code) ?? code;
}

/** What the user may hear: detection first, then every language in the interface language's order. */
export function sourceOptions(uiLanguage: string, autoLabel: string): LanguageOption[] {
  return [{ code: 'auto', name: autoLabel }, ...targetOptions(uiLanguage)];
}

/** What the user may read: a language, never detection. */
export function targetOptions(uiLanguage: string): LanguageOption[] {
  return rows(uiLanguage).map(([code, name]) => ({ code, name }));
}

/**
 * The options whose shown name, English name or code contains the query,
 * ignoring case. Both sides are lowered without the device's locale: a
 * Turkish device would lower "FIL" to "fıl" and miss the code.
 */
export function searchLanguages(options: readonly LanguageOption[], query: string): LanguageOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  return options.filter((o) =>
    [o.name, english.get(o.code) ?? '', o.code].some((s) => s.toLowerCase().includes(q)),
  );
}
