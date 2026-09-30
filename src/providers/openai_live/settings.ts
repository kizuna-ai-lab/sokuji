/**
 * OpenAI Live's `S`, languages, voices and credentials. `S` is
 * the old slice (`OpenAILiveProviderConfig.ts:10-24`) without what leaves it
 * — the key (a credential, its own: no prefill from OpenAI Realtime's,
 * ruling 9), the pair (`providerStore`, same keys) — plus the instructions
 * it now owns (Stage 2 Gemini, ruling 4). Stored under `settings.openaiLive.*`
 * as before; `userSilenceDuration` / `assistantSilenceDuration`, which two
 * builds carried, are not read. The language and voice lists are the old
 * descriptor's, copied: nothing here imports `src/services` or another
 * provider (ruling 9).
 */
import { AUTO } from '../../lib/provider/languages';
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS, migrateInstructions, type InstructionsSettings } from '../../lib/provider/instructions';
import type { CredentialsMissing, LanguageOption, MigrationInputs, Provider } from '../../lib/provider/types';

export interface LiveSettings extends InstructionsSettings {
  /** One of `LIVE_VOICES`: the voice `session.start` asks for. */
  voice: string;
}

/** The model every session runs (`OpenAILiveProviderConfig.ts:79`): the check requires it, nothing chooses it. */
export const LIVE_MODEL = 'gpt-live-1';
export const LIVE_DEFAULT_VOICE = 'marin';

export const LIVE_DEFAULTS: LiveSettings = { ...INSTRUCTIONS_DEFAULTS, voice: LIVE_DEFAULT_VOICE };

/** The instructions' legacy keys (Stage 2 Gemini, choice 1): nothing else is read that `S` does not name. */
export const LIVE_LEGACY_KEYS: readonly string[] = INSTRUCTION_LEGACY_KEYS;

/** The ten Realtime voices in their order, then the twelve Live added (`OpenAILiveProviderConfig.ts:27-41`). */
export const LIVE_VOICES: readonly { value: string; name: string }[] = [
  { name: 'Alloy', value: 'alloy' },
  { name: 'Ash', value: 'ash' },
  { name: 'Ballad', value: 'ballad' },
  { name: 'Cedar', value: 'cedar' },
  { name: 'Coral', value: 'coral' },
  { name: 'Echo', value: 'echo' },
  { name: 'Marin', value: 'marin' },
  { name: 'Sage', value: 'sage' },
  { name: 'Shimmer', value: 'shimmer' },
  { name: 'Verse', value: 'verse' },
  { name: 'Quartz', value: 'quartz' },
  { name: 'Ripple', value: 'ripple' },
  { name: 'Vesper', value: 'vesper' },
  { name: 'Willow', value: 'willow' },
  { name: 'Stone', value: 'stone' },
  { name: 'Gleam', value: 'gleam' },
  { name: 'Meridian', value: 'meridian' },
  { name: 'Bossa', value: 'bossa' },
  { name: 'Tempo', value: 'tempo' },
  { name: 'Beacon', value: 'beacon' },
  { name: 'Delta', value: 'delta' },
  { name: 'Cinder', value: 'cinder' },
];

/**
 * What was stored, made valid field by field: a voice not among the
 * twenty-two falls to `marin`, and the instructions come from
 * `migrateInstructions`. Nothing is converted, nothing written back (the
 * owner's rule).
 */
export function migrateLiveSettings(stored: Readonly<Record<string, unknown>>, inputs: MigrationInputs): LiveSettings {
  const voice = LIVE_VOICES.some((v) => v.value === stored.voice) ? (stored.voice as string) : LIVE_DEFAULT_VOICE;
  return { ...migrateInstructions(stored, inputs.legacy), voice };
}

/** The 55 languages the old provider offered (`OpenAIProviderConfig.LANGUAGES`, `OpenAILiveProviderConfig.ts:112`): every one a source and a target. */
export const LIVE_LANGUAGES: readonly LanguageOption[] = [
  { name: 'العربية', value: 'ar', englishName: 'Arabic' },
  { name: 'አማርኛ', value: 'am', englishName: 'Amharic' },
  { name: 'Български', value: 'bg', englishName: 'Bulgarian' },
  { name: 'বাংলা', value: 'bn', englishName: 'Bengali' },
  { name: 'Català', value: 'ca', englishName: 'Catalan' },
  { name: 'Čeština', value: 'cs', englishName: 'Czech' },
  { name: 'Dansk', value: 'da', englishName: 'Danish' },
  { name: 'Deutsch', value: 'de', englishName: 'German' },
  { name: 'Ελληνικά', value: 'el', englishName: 'Greek' },
  { name: 'English', value: 'en', englishName: 'English' },
  { name: 'English (Australia)', value: 'en_AU', englishName: 'English (Australia)' },
  { name: 'English (Great Britain)', value: 'en_GB', englishName: 'English (Great Britain)' },
  { name: 'English (USA)', value: 'en_US', englishName: 'English (USA)' },
  { name: 'Español', value: 'es', englishName: 'Spanish' },
  { name: 'Español (Latinoamérica)', value: 'es_419', englishName: 'Spanish (Latin America and Caribbean)' },
  { name: 'Eesti', value: 'et', englishName: 'Estonian' },
  { name: 'فارسی', value: 'fa', englishName: 'Persian' },
  { name: 'Suomi', value: 'fi', englishName: 'Finnish' },
  { name: 'Filipino', value: 'fil', englishName: 'Filipino' },
  { name: 'Français', value: 'fr', englishName: 'French' },
  { name: 'ગુજરાતી', value: 'gu', englishName: 'Gujarati' },
  { name: 'עברית', value: 'he', englishName: 'Hebrew' },
  { name: 'हिन्दी', value: 'hi', englishName: 'Hindi' },
  { name: 'Hrvatski', value: 'hr', englishName: 'Croatian' },
  { name: 'Magyar', value: 'hu', englishName: 'Hungarian' },
  { name: 'Bahasa Indonesia', value: 'id', englishName: 'Indonesian' },
  { name: 'Italiano', value: 'it', englishName: 'Italian' },
  { name: '日本語', value: 'ja', englishName: 'Japanese' },
  { name: 'ಕನ್ನಡ', value: 'kn', englishName: 'Kannada' },
  { name: '한국어', value: 'ko', englishName: 'Korean' },
  { name: 'Lietuvių', value: 'lt', englishName: 'Lithuanian' },
  { name: 'Latviešu', value: 'lv', englishName: 'Latvian' },
  { name: 'മലയാളം', value: 'ml', englishName: 'Malayalam' },
  { name: 'मराठी', value: 'mr', englishName: 'Marathi' },
  { name: 'Bahasa Melayu', value: 'ms', englishName: 'Malay' },
  { name: 'Nederlands', value: 'nl', englishName: 'Dutch' },
  { name: 'Norsk', value: 'no', englishName: 'Norwegian' },
  { name: 'Polski', value: 'pl', englishName: 'Polish' },
  { name: 'Português (Brasil)', value: 'pt_BR', englishName: 'Portuguese (Brazil)' },
  { name: 'Português (Portugal)', value: 'pt_PT', englishName: 'Portuguese (Portugal)' },
  { name: 'Română', value: 'ro', englishName: 'Romanian' },
  { name: 'Русский', value: 'ru', englishName: 'Russian' },
  { name: 'Slovenčina', value: 'sk', englishName: 'Slovak' },
  { name: 'Slovenščina', value: 'sl', englishName: 'Slovenian' },
  { name: 'Српски', value: 'sr', englishName: 'Serbian' },
  { name: 'Svenska', value: 'sv', englishName: 'Swedish' },
  { name: 'Kiswahili', value: 'sw', englishName: 'Swahili' },
  { name: 'தமிழ்', value: 'ta', englishName: 'Tamil' },
  { name: 'తెలుగు', value: 'te', englishName: 'Telugu' },
  { name: 'ไทย', value: 'th', englishName: 'Thai' },
  { name: 'Türkçe', value: 'tr', englishName: 'Turkish' },
  { name: 'Українська', value: 'uk', englishName: 'Ukrainian' },
  { name: 'Tiếng Việt', value: 'vi', englishName: 'Vietnamese' },
  { name: '中文 (中国)', value: 'zh_CN', englishName: 'Chinese (China)' },
  { name: '中文 (台灣)', value: 'zh_TW', englishName: 'Chinese (Taiwan)' },
];

/** "Auto-detect" stays a source: the model hears any language. Named as the other providers name it; the picker shows `common.autoDetect`. */
const AUTO_SOURCE: LanguageOption = { value: AUTO, name: 'Auto', englishName: 'Auto' };

/**
 * `AUTO` first, then the 55, as the old picker listed them; every language a
 * target for every source, the source included. D20 refuses Both for an
 * `AUTO` source — the old `reversesDirectionViaSourceLanguage` has no
 * successor to write.
 */
export const liveLanguages: Provider<LiveSettings, never, never>['languages'] = {
  sources: () => [AUTO_SOURCE, ...LIVE_LANGUAGES],
  targets: () => LIVE_LANGUAGES,
  initial: () => ({ source: 'en', target: 'zh_CN' }),
};

/**
 * A code's English name, for the instructions' template: the code when
 * unnamed, and `AUTO` "the spoken language" — OpenAI Realtime's rule, where
 * the old client rendered the literal "auto" (a stated departure).
 */
export function liveLanguageName(code: string): string {
  if (code === AUTO) return 'the spoken language';
  return LIVE_LANGUAGES.find((o) => o.value === code)?.englishName || code;
}

export interface LiveCredentials {
  apiKey: string;
}

export const liveCredentials: Provider<LiveSettings, LiveCredentials, never>['credentials'] = {
  keys: ['apiKey'],
  fields: () => [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }],
  read: (values): LiveCredentials | CredentialsMissing => {
    // Trimmed: the key rides in an upgrade header, where a pasted trailing newline or space is no valid token.
    const apiKey = (values.apiKey ?? '').trim();
    // No code: the runner words it `credentials_missing` ("Enter your API key in Settings before starting.").
    return apiKey ? { apiKey } : { missing: 'Enter your OpenAI API key.' };
  },
};

/** `gpt-live-1` and any dated `gpt-live-…` snapshot, never the transcription model (`OpenAILiveClient.ts:251-255`). */
export function isLiveModelId(id: string): boolean {
  const name = id.toLowerCase();
  if (name.startsWith('gpt-live-transcribe')) return false;
  return name === LIVE_MODEL || name.startsWith('gpt-live-');
}
