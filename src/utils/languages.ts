import { LanguageOption } from '../services/providers/ProviderConfig';

/** Shared language display name registry — single source of truth for code → display name */
export const LANGUAGE_OPTIONS: Record<string, LanguageOption> = {
  af: { name: 'Afrikaans', value: 'af', englishName: 'Afrikaans' },
  ar: { name: 'العربية', value: 'ar', englishName: 'Arabic' },
  // bat: { name: 'Baltic', value: 'bat', englishName: 'Baltic Languages' },
  bg: { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
  cs: { name: 'Čeština', value: 'cs', englishName: 'Czech' },
  da: { name: 'Dansk', value: 'da', englishName: 'Danish' },
  de: { name: 'Deutsch', value: 'de', englishName: 'German' },
  en: { name: 'English', value: 'en', englishName: 'English' },
  el: { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
  es: { name: 'Español', value: 'es', englishName: 'Spanish' },
  et: { name: 'Eesti', value: 'et', englishName: 'Estonian' },
  fi: { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
  fr: { name: 'Français', value: 'fr', englishName: 'French' },
  // gem: { name: 'Germanic', value: 'gem', englishName: 'Germanic Languages' },
  // gmw: { name: 'West Germanic', value: 'gmw', englishName: 'West Germanic Languages' },
  hi: { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
  hr: { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
  hu: { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
  id: { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
  it: { name: 'Italiano', value: 'it', englishName: 'Italian' },
  ja: { name: '日本語', value: 'ja', englishName: 'Japanese' },
  ko: { name: '한국어', value: 'ko', englishName: 'Korean' },
  lt: { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
  lv: { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
  mt: { name: 'Malti', value: 'mt', englishName: 'Maltese' },
  mul: { name: 'Multiple', value: 'mul', englishName: 'Multiple Languages' },
  nl: { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
  no: { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
  pl: { name: 'Polski', value: 'pl', englishName: 'Polish' },
  pt: { name: 'Português', value: 'pt', englishName: 'Portuguese' },
  // ROMANCE: { name: 'Romance', value: 'ROMANCE', englishName: 'Romance Languages' },
  ro: { name: 'Română', value: 'ro', englishName: 'Romanian' },
  ru: { name: 'Русский', value: 'ru', englishName: 'Russian' },
  sk: { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
  sl: { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
  sv: { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
  th: { name: 'ไทย', value: 'th', englishName: 'Thai' },
  tr: { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
  uk: { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
  vi: { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
  xh: { name: 'isiXhosa', value: 'xh', englishName: 'Xhosa' },
  zh: { name: '中文', value: 'zh', englishName: 'Chinese' },
};

/** Global language display order — sorted by worldwide usage/importance.
 *  Languages in this array appear first (in this order);
 *  any remaining languages fall back to alphabetical by englishName. */
export const LANGUAGE_PRIORITY: string[] = [
  'en', 'zh', 'es', 'fr', 'ar',
  'pt', 'ru', 'de', 'ja', 'hi',
  'ko', 'it', 'tr', 'vi', 'th',
  'id', 'nl', 'pl', 'sv', 'da',
  'fi', 'no', 'uk', 'cs', 'ro',
  'hu', 'el', 'bg', 'hr', 'sk',
  'sl', 'et', 'lt', 'lv',
  'af', 'xh', 'mt',
];

/** Look up a LanguageOption by code, with fallback to code as display name */
export function getLanguageOption(code: string): LanguageOption {
  return LANGUAGE_OPTIONS[code] || { name: code, value: code, englishName: code };
}

/** Sort language options by global priority, then alphabetically for unlisted languages. */
export function sortLanguageOptions(options: LanguageOption[]): LanguageOption[] {
  return [...options].sort((a, b) => {
    const ai = LANGUAGE_PRIORITY.indexOf(a.value);
    const bi = LANGUAGE_PRIORITY.indexOf(b.value);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.englishName.localeCompare(b.englishName);
  });
}
