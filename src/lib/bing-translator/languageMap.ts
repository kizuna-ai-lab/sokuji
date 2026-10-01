// Maps ISO-639-1 (and common BCP-47 subtags) to Bing Translator's language codes.
// Most codes pass through unchanged; the overrides below capture the known exceptions.

const BING_LANGUAGE_OVERRIDES: Record<string, string> = {
  'no': 'nb',        // App uses 'no' for Norwegian (see Opus-MT entries); Bing wants 'nb' (Bokmål)
  'zh': 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
};

// Curated list of Bing-supported language ISO codes (the codes we accept as *input*,
// before mapping). Covers the main language pairs users request. Extend as needed.
export const BING_SUPPORTED_LANGUAGES: readonly string[] = [
  'af', 'ar', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'de',
  'el', 'en', 'es', 'et', 'fa', 'fi', 'fil', 'fj', 'fr', 'ga',
  'he', 'hi', 'hr', 'ht', 'hu', 'id', 'is', 'it', 'ja', 'kk',
  'km', 'ko', 'lt', 'lv', 'mg', 'ml', 'mr', 'ms', 'mt', 'mww',
  'my', 'nb', 'no', 'nl', 'or', 'otq', 'pa', 'pl', 'pt', 'ro', 'ru',
  'sk', 'sl', 'sm', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tlh',
  'to', 'tr', 'ty', 'uk', 'ur', 'vi', 'yua', 'yue',
  'zh', 'zh-cn', 'zh-tw', 'zh-hk',
];

const SUPPORTED_SET = new Set(BING_SUPPORTED_LANGUAGES.map(c => c.toLowerCase()));

export function isSupportedByBing(isoCode: string): boolean {
  if (!isoCode) return false;
  return SUPPORTED_SET.has(isoCode.toLowerCase());
}

export function mapToBingCode(isoCode: string): string {
  const lower = (isoCode || '').toLowerCase();
  if (!SUPPORTED_SET.has(lower)) {
    throw new Error(`unsupported language code: "${isoCode}"`);
  }
  return BING_LANGUAGE_OVERRIDES[lower] ?? lower;
}
