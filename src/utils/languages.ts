import { englishLanguageName } from '../lib/language/label';
import type { LanguageOption } from '../lib/provider/types';

/** The local vocabulary: every app code a universal local model offers (spec "Unified language codes" §7). Named by `languageLabel`. */
export const LANGUAGE_CODES: readonly string[] = [
  'af', 'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'en', 'el', 'es', 'et', 'fa', 'fi', 'fr', 'gu', 'he', 'hi', 'hr', 'hu',
  'id', 'is', 'it', 'ja', 'kn', 'ko', 'lt', 'lv', 'ml', 'mr', 'mt', 'mul', 'nl', 'no', 'pa', 'pl', 'pt', 'ro', 'ru', 'sk',
  'sl', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'fil', 'tr', 'uk', 'ur', 'vi', 'xh', 'yue', 'zh', 'zu',
];

/** Global language display order — sorted by worldwide usage/importance.
 *  Languages in this array appear first (in this order);
 *  any remaining languages fall back to alphabetical by CLDR English name (`englishLanguageName`). */
export const LANGUAGE_PRIORITY: string[] = [
  'en', 'zh', 'es', 'fr', 'ar',
  'bn', 'pt', 'ru', 'de', 'ja',
  'hi', 'ko', 'it', 'tr', 'vi',
  'th', 'id', 'fa', 'ur', 'fil',
  'nl', 'pl', 'sv', 'da', 'ta',
  'te', 'ml', 'kn', 'gu', 'mr',
  'pa', 'fi', 'no', 'uk', 'cs',
  'ro', 'hu', 'el', 'bg', 'hr',
  'sk', 'sl', 'sr', 'ca', 'he',
  'sw', 'is', 'et', 'lt', 'lv',
  'af', 'xh', 'zu', 'mt',
];

/** Sort language options by global priority, then alphabetically for unlisted languages. */
export function sortLanguageOptions(options: LanguageOption[]): LanguageOption[] {
  return [...options].sort((a, b) => {
    const ai = LANGUAGE_PRIORITY.indexOf(a.value);
    const bi = LANGUAGE_PRIORITY.indexOf(b.value);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return englishLanguageName(a.value).localeCompare(englishLanguageName(b.value));
  });
}
