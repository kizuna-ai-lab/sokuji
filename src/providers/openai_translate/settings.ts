/**
 * OpenAI Translate's `S`, languages and credentials (survey §2.2, §2.3,
 * §2.5). `S` is the old slice (`OpenAITranslateProviderConfig.ts:20-50`)
 * without what leaves it: the key (a credential, same key), the pair
 * (`providerStore`, same keys), the transcript model (a constant now,
 * ruling 8) and the transport choice — every session runs over WebSocket
 * (ruling 1), and the owner abandoned WebRTC for this provider
 * (2026-09-29), so a stored `transportType` is not read. Stored under
 * `settings.openaiTranslate.*` as before. The language lists are the old
 * descriptor's (`:161-256`), copied: nothing here imports `src/services`.
 */
import type { CredentialsMissing, LanguageOption, Provider } from '../../lib/provider/types';

export type NoiseReduction = 'None' | 'Near field' | 'Far field';
/** The old select's modes, in its order (`OpenAITranslateProviderConfig.ts:283`). */
export const NOISE_REDUCTIONS: readonly NoiseReduction[] = ['None', 'Near field', 'Far field'];

export interface TranslateSettings {
  noiseReduction: NoiseReduction;
}

export const TRANSLATE_DEFAULTS: TranslateSettings = { noiseReduction: 'None' };

/** The model every session runs (ruling 7): the endpoint fixes it at creation, and the old builder always sent it (`OpenAITranslateProviderConfig.ts:106`). */
export const TRANSLATE_MODEL = 'gpt-realtime-translate';
/** The source transcript's model (ruling 8): the old select's one option (`OpenAITranslateProviderConfig.ts:284`). */
export const TRANSCRIPT_MODEL = 'gpt-live-transcribe';

/** The model family the check requires (`OpenAIClient.ts:265-267`). */
export function isTranslateModelId(id: string): boolean {
  return id.toLowerCase().startsWith(TRANSLATE_MODEL);
}

const NOISE_VALUES: readonly unknown[] = NOISE_REDUCTIONS;

/**
 * What was stored, made valid field by field. A stored transcript model
 * (`gpt-live-transcribe`, or the legacy `gpt-realtime-whisper`) is not read:
 * the model is a constant (ruling 8). Nor is a stored transport: every
 * session runs over WebSocket (ruling 1). Nothing is written back.
 */
export function migrateTranslateSettings(stored: Readonly<Record<string, unknown>>): TranslateSettings {
  return {
    noiseReduction: NOISE_VALUES.includes(stored.noiseReduction) ? (stored.noiseReduction as NoiseReduction) : TRANSLATE_DEFAULTS.noiseReduction,
  };
}

/** The thirteen languages the model speaks: the targets for every source, the source included (ruling 15). */
export const TRANSLATE_TARGETS: readonly LanguageOption[] = [
  { name: 'English', value: 'en', englishName: 'English' },
  { name: 'Español', value: 'es', englishName: 'Spanish' },
  { name: 'Português', value: 'pt', englishName: 'Portuguese' },
  { name: 'Français', value: 'fr', englishName: 'French' },
  { name: '日本語', value: 'ja', englishName: 'Japanese' },
  { name: 'Русский', value: 'ru', englishName: 'Russian' },
  { name: '中文', value: 'zh', englishName: 'Chinese' },
  { name: 'Deutsch', value: 'de', englishName: 'German' },
  { name: '한국어', value: 'ko', englishName: 'Korean' },
  { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
  { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
  { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
  { name: 'Italiano', value: 'it', englishName: 'Italian' },
];

/** The 74 languages it hears (the old comment's "75" miscounts, survey §1.14.16); no `auto`, though the model detects what is spoken (ruling 15). */
export const TRANSLATE_SOURCES: readonly LanguageOption[] = [
  { name: 'Afrikaans', value: 'af', englishName: 'Afrikaans' },
  { name: 'العربية', value: 'ar', englishName: 'Arabic' },
  { name: 'Azərbaycan', value: 'az', englishName: 'Azerbaijani' },
  { name: 'Беларуская', value: 'be', englishName: 'Belarusian' },
  { name: 'বাংলা', value: 'bn', englishName: 'Bengali' },
  { name: 'Bosanski', value: 'bs', englishName: 'Bosnian' },
  { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
  { name: 'Català', value: 'ca', englishName: 'Catalan' },
  { name: '中文', value: 'zh', englishName: 'Chinese' },
  { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
  { name: 'Čeština', value: 'cs', englishName: 'Czech' },
  { name: 'Dansk', value: 'da', englishName: 'Danish' },
  { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
  { name: 'རྫོང་ཁ', value: 'dz', englishName: 'Dzongkha' },
  { name: 'English', value: 'en', englishName: 'English' },
  { name: 'Esperanto', value: 'eo', englishName: 'Esperanto' },
  { name: 'Eesti', value: 'et', englishName: 'Estonian' },
  { name: 'Euskara', value: 'eu', englishName: 'Basque' },
  { name: 'فارسی', value: 'fa', englishName: 'Persian' },
  { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
  { name: 'Filipino', value: 'fil', englishName: 'Filipino' },
  { name: 'Français', value: 'fr', englishName: 'French' },
  { name: 'Galego', value: 'gl', englishName: 'Galician' },
  { name: 'Deutsch', value: 'de', englishName: 'German' },
  { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
  { name: 'ગુજરાતી', value: 'gu', englishName: 'Gujarati' },
  { name: 'Kreyòl Ayisyen', value: 'ht', englishName: 'Haitian Creole' },
  { name: 'ʻŌlelo Hawaiʻi', value: 'haw', englishName: 'Hawaiian' },
  { name: 'עברית', value: 'he', englishName: 'Hebrew' },
  { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
  { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
  { name: 'Հայերեն', value: 'hy', englishName: 'Armenian' },
  { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
  { name: 'Italiano', value: 'it', englishName: 'Italian' },
  { name: '日本語', value: 'ja', englishName: 'Japanese' },
  { name: 'Basa Jawa', value: 'jv', englishName: 'Javanese' },
  { name: 'ქართული', value: 'ka', englishName: 'Georgian' },
  { name: 'Қазақ', value: 'kk', englishName: 'Kazakh' },
  { name: '한국어', value: 'ko', englishName: 'Korean' },
  { name: 'Kurdî', value: 'ku', englishName: 'Kurdish' },
  { name: 'Latine', value: 'la', englishName: 'Latin' },
  { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
  { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
  { name: 'Македонски', value: 'mk', englishName: 'Macedonian' },
  { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
  { name: 'മലയാളം', value: 'ml', englishName: 'Malayalam' },
  { name: 'Māori', value: 'mi', englishName: 'Maori' },
  { name: 'Монгол', value: 'mn', englishName: 'Mongolian' },
  { name: 'မြန်မာ', value: 'my', englishName: 'Burmese' },
  { name: 'नेपाली', value: 'ne', englishName: 'Nepali' },
  { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
  { name: 'Nynorsk', value: 'nn', englishName: 'Nynorsk' },
  { name: 'Polski', value: 'pl', englishName: 'Polish' },
  { name: 'Português', value: 'pt', englishName: 'Portuguese' },
  { name: 'ਪੰਜਾਬੀ', value: 'pa', englishName: 'Punjabi' },
  { name: 'Română', value: 'ro', englishName: 'Romanian' },
  { name: 'Русский', value: 'ru', englishName: 'Russian' },
  { name: 'Српски', value: 'sr', englishName: 'Serbian' },
  { name: 'ChiShona', value: 'sn', englishName: 'Shona' },
  { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
  { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
  { name: 'Shqip', value: 'sq', englishName: 'Albanian' },
  { name: 'Español', value: 'es', englishName: 'Spanish' },
  { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
  { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
  { name: 'Tagalog', value: 'tl', englishName: 'Tagalog' },
  { name: 'తెలుగు', value: 'te', englishName: 'Telugu' },
  { name: 'ไทย', value: 'th', englishName: 'Thai' },
  { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
  { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
  { name: 'Oʻzbek', value: 'uz', englishName: 'Uzbek' },
  { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
  { name: 'Cymraeg', value: 'cy', englishName: 'Welsh' },
  { name: 'Yorùbá', value: 'yo', englishName: 'Yoruba' },
];

/**
 * Every source targets the thirteen (the old `resolveTargetLanguages`); the
 * offer is the same speaking or not. D20 then opens the participant leg only
 * for a source among the thirteen.
 */
export const translateLanguages: Provider<TranslateSettings, never, never>['languages'] = {
  sources: () => TRANSLATE_SOURCES,
  targets: () => TRANSLATE_TARGETS,
  initial: () => ({ source: 'en', target: 'zh' }),
};

export interface TranslateCredentials {
  apiKey: string;
}

export const translateCredentials: Provider<TranslateSettings, TranslateCredentials, never>['credentials'] = {
  keys: ['apiKey'],
  fields: () => [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }],
  read: (values): TranslateCredentials | CredentialsMissing => {
    // Trimmed (choice 14): the key rides in a subprotocol, and a pasted trailing newline or space is no valid token.
    const apiKey = (values.apiKey ?? '').trim();
    // No code: the runner words it `credentials_missing` ("Enter your API key in Settings before starting.").
    return apiKey ? { apiKey } : { missing: 'Enter your OpenAI API key.' };
  },
};
