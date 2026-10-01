/**
 * Soniox's languages and the table between the app's codes and Soniox's own. Kept apart from `settings.ts` so the
 * session side (the adapter) can read the table without reaching the settings side.
 */
import { wireTable } from '../../lib/language/wire';
import { AUTO } from '../../lib/provider/languages';
import type { LanguageOption } from '../../lib/provider/types';

/** The 60 languages of Soniox's own STS demo: translation is any-to-any across them. */
export const SONIOX_LANGUAGES: readonly LanguageOption[] = [
  { value: 'af' },
  { value: 'sq' },
  { value: 'ar' },
  { value: 'az' },
  { value: 'eu' },
  { value: 'be' },
  { value: 'bn' },
  { value: 'bs' },
  { value: 'bg' },
  { value: 'ca' },
  { value: 'zh' },
  { value: 'hr' },
  { value: 'cs' },
  { value: 'da' },
  { value: 'nl' },
  { value: 'en' },
  { value: 'et' },
  { value: 'fi' },
  { value: 'fr' },
  { value: 'gl' },
  { value: 'de' },
  { value: 'el' },
  { value: 'gu' },
  { value: 'he' },
  { value: 'hi' },
  { value: 'hu' },
  { value: 'id' },
  { value: 'it' },
  { value: 'ja' },
  { value: 'kn' },
  { value: 'kk' },
  { value: 'ko' },
  { value: 'lv' },
  { value: 'lt' },
  { value: 'mk' },
  { value: 'ms' },
  { value: 'ml' },
  { value: 'mr' },
  { value: 'no' },
  { value: 'fa' },
  { value: 'pl' },
  { value: 'pt' },
  { value: 'pa' },
  { value: 'ro' },
  { value: 'ru' },
  { value: 'sr' },
  { value: 'sk' },
  { value: 'sl' },
  { value: 'es' },
  { value: 'sw' },
  { value: 'sv' },
  { value: 'fil' },
  { value: 'ta' },
  { value: 'te' },
  { value: 'th' },
  { value: 'tr' },
  { value: 'uk' },
  { value: 'ur' },
  { value: 'vi' },
  { value: 'cy' },
];

// Soniox's codes are ISO 639-1 and the app's but for Tagalog, which the app writes fil (CLDR's canonical form).
export const sonioxWire = wireTable([[AUTO], ...SONIOX_LANGUAGES.map((o) => (o.value === 'fil' ? (['fil', 'tl'] as const) : ([o.value] as const)))]);
