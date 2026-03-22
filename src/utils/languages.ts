import { LanguageOption } from '../services/providers/ProviderConfig';

/** Shared language display name registry — single source of truth for code → display name */
export const LANGUAGE_OPTIONS: Record<string, LanguageOption> = {
  af: { name: 'Afrikaans', value: 'af', englishName: 'Afrikaans' },
  ar: { name: 'العربية', value: 'ar', englishName: 'Arabic' },
  // bat: { name: 'Baltic', value: 'bat', englishName: 'Baltic Languages' },
  bg: { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
  bn: { name: 'বাংলা', value: 'bn', englishName: 'Bengali' },
  ca: { name: 'Català', value: 'ca', englishName: 'Catalan' },
  cs: { name: 'Čeština', value: 'cs', englishName: 'Czech' },
  da: { name: 'Dansk', value: 'da', englishName: 'Danish' },
  de: { name: 'Deutsch', value: 'de', englishName: 'German' },
  en: { name: 'English', value: 'en', englishName: 'English' },
  el: { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
  es: { name: 'Español', value: 'es', englishName: 'Spanish' },
  et: { name: 'Eesti', value: 'et', englishName: 'Estonian' },
  fa: { name: 'فارسی', value: 'fa', englishName: 'Persian' },
  fi: { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
  fr: { name: 'Français', value: 'fr', englishName: 'French' },
  // gem: { name: 'Germanic', value: 'gem', englishName: 'Germanic Languages' },
  // gmw: { name: 'West Germanic', value: 'gmw', englishName: 'West Germanic Languages' },
  gu: { name: 'ગુજરાતી', value: 'gu', englishName: 'Gujarati' },
  he: { name: 'עברית', value: 'he', englishName: 'Hebrew' },
  hi: { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
  hr: { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
  hu: { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
  id: { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
  is: { name: 'Íslenska', value: 'is', englishName: 'Icelandic' },
  it: { name: 'Italiano', value: 'it', englishName: 'Italian' },
  ja: { name: '日本語', value: 'ja', englishName: 'Japanese' },
  kn: { name: 'ಕನ್ನಡ', value: 'kn', englishName: 'Kannada' },
  ko: { name: '한국어', value: 'ko', englishName: 'Korean' },
  lt: { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
  lv: { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
  ml: { name: 'മലയാളം', value: 'ml', englishName: 'Malayalam' },
  mr: { name: 'मराठी', value: 'mr', englishName: 'Marathi' },
  mt: { name: 'Malti', value: 'mt', englishName: 'Maltese' },
  mul: { name: 'Multiple', value: 'mul', englishName: 'Multiple Languages' },
  nl: { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
  no: { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
  pa: { name: 'ਪੰਜਾਬੀ', value: 'pa', englishName: 'Punjabi' },
  pl: { name: 'Polski', value: 'pl', englishName: 'Polish' },
  pt: { name: 'Português', value: 'pt', englishName: 'Portuguese' },
  // ROMANCE: { name: 'Romance', value: 'ROMANCE', englishName: 'Romance Languages' },
  ro: { name: 'Română', value: 'ro', englishName: 'Romanian' },
  ru: { name: 'Русский', value: 'ru', englishName: 'Russian' },
  sk: { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
  sl: { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
  sr: { name: 'Српски', value: 'sr', englishName: 'Serbian' },
  sv: { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
  sw: { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
  ta: { name: 'தமிழ்', value: 'ta', englishName: 'Tamil' },
  te: { name: 'తెలుగు', value: 'te', englishName: 'Telugu' },
  th: { name: 'ไทย', value: 'th', englishName: 'Thai' },
  tl: { name: 'Tagalog', value: 'tl', englishName: 'Tagalog' },
  tr: { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
  uk: { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
  ur: { name: 'اردو', value: 'ur', englishName: 'Urdu' },
  vi: { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
  xh: { name: 'isiXhosa', value: 'xh', englishName: 'Xhosa' },
  cantonese: { name: '粵語 (cantonese)', value: 'cantonese', englishName: 'Cantonese' },
  zh: { name: '中文', value: 'zh', englishName: 'Chinese' },
  zu: { name: 'isiZulu', value: 'zu', englishName: 'Zulu' },
};

/** Global language display order — sorted by worldwide usage/importance.
 *  Languages in this array appear first (in this order);
 *  any remaining languages fall back to alphabetical by englishName. */
export const LANGUAGE_PRIORITY: string[] = [
  'en', 'zh', 'es', 'fr', 'ar',
  'bn', 'pt', 'ru', 'de', 'ja',
  'hi', 'ko', 'it', 'tr', 'vi',
  'th', 'id', 'fa', 'ur', 'tl',
  'nl', 'pl', 'sv', 'da', 'ta',
  'te', 'ml', 'kn', 'gu', 'mr',
  'pa', 'fi', 'no', 'uk', 'cs',
  'ro', 'hu', 'el', 'bg', 'hr',
  'sk', 'sl', 'sr', 'ca', 'he',
  'sw', 'is', 'et', 'lt', 'lv',
  'af', 'xh', 'zu', 'mt',
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
