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
import { identityWire } from '../../lib/language/wire';
import { englishLanguageName } from '../../lib/language/label';
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

/**
 * The sample OpenAI's Platform playground plays for a voice. No guide links
 * it and it may move without notice; a voice whose sample is gone just fails
 * its preview, with no synthesized fallback (decision 2026-10-03).
 */
const VOICE_PREVIEWS = 'https://cdn.openai.com/API/voice-previews/';

export interface LiveVoice {
  value: string;
  name: string;
  /** One of the ten Realtime voices, or one of the twelve Live added: the settings list each under a heading of its own. */
  origin: 'realtime' | 'live';
  /** Its published sample, in English. */
  clip: string;
  /** The guide's presentation, where it gives one: for the twelve Live added only. */
  gender?: 'female' | 'male';
  /** The guide's regional influence and language, in its own English. Not a language limit: "Regional influence describes a voice's speaking style", so the list is not filtered by it (decision 2026-10-03). */
  description?: string;
}

const realtime = (value: string): LiveVoice => ({ name: value[0].toUpperCase() + value.slice(1), value, origin: 'realtime', clip: `${VOICE_PREVIEWS}${value}.flac` });
const live = (value: string, gender: 'female' | 'male', description: string): LiveVoice =>
  ({ name: value[0].toUpperCase() + value.slice(1), value, origin: 'live', clip: `${VOICE_PREVIEWS}${value}.wav`, gender, description });

/**
 * The ten Realtime voices in their order, then the twelve Live added
 * (`OpenAILiveProviderConfig.ts:27-41`), still the guide's 22
 * (live-conversations#voice-options, 2026-10-03). Only the twelve have a
 * documented presentation and accent; the ten carry none.
 */
export const LIVE_VOICES: readonly LiveVoice[] = [
  ...['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'marin', 'sage', 'shimmer', 'verse'].map(realtime),
  live('quartz', 'female', 'Australian English'),
  live('ripple', 'male', 'Australian English'),
  live('vesper', 'male', 'British English'),
  live('willow', 'female', 'Irish English'),
  live('stone', 'male', 'Irish English'),
  live('gleam', 'female', 'North American English'),
  live('meridian', 'male', 'North American English'),
  live('bossa', 'female', 'Brazilian Portuguese'),
  live('tempo', 'male', 'Brazilian Portuguese'),
  live('beacon', 'male', 'Filipino English'),
  live('delta', 'female', 'Southern U.S. English'),
  live('cinder', 'male', 'Southern U.S. English'),
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
  { value: 'ar' },
  { value: 'am' },
  { value: 'bg' },
  { value: 'bn' },
  { value: 'ca' },
  { value: 'cs' },
  { value: 'da' },
  { value: 'de' },
  { value: 'el' },
  { value: 'en' },
  { value: 'en-AU' },
  { value: 'en-GB' },
  { value: 'en-US' },
  { value: 'es' },
  { value: 'es-419' },
  { value: 'et' },
  { value: 'fa' },
  { value: 'fi' },
  { value: 'fil' },
  { value: 'fr' },
  { value: 'gu' },
  { value: 'he' },
  { value: 'hi' },
  { value: 'hr' },
  { value: 'hu' },
  { value: 'id' },
  { value: 'it' },
  { value: 'ja' },
  { value: 'kn' },
  { value: 'ko' },
  { value: 'lt' },
  { value: 'lv' },
  { value: 'ml' },
  { value: 'mr' },
  { value: 'ms' },
  { value: 'nl' },
  { value: 'no' },
  { value: 'pl' },
  { value: 'pt-BR' },
  { value: 'pt-PT' },
  { value: 'ro' },
  { value: 'ru' },
  { value: 'sk' },
  { value: 'sl' },
  { value: 'sr' },
  { value: 'sv' },
  { value: 'sw' },
  { value: 'ta' },
  { value: 'te' },
  { value: 'th' },
  { value: 'tr' },
  { value: 'uk' },
  { value: 'vi' },
  { value: 'zh-CN' },
  { value: 'zh-TW' },
];

/** "Auto-detect" stays a source: the model hears any language. Named as the other providers name it; the picker shows `common.autoDetect`. */
const AUTO_SOURCE: LanguageOption = { value: AUTO };

/**
 * `AUTO` first, then the 55, as the old picker listed them; every language a
 * target for every source, the source included. D20 refuses Both for an
 * `AUTO` source — the old `reversesDirectionViaSourceLanguage` has no
 * successor to write.
 */
export const liveLanguages: Provider<LiveSettings, never, never>['languages'] = {
  sources: () => [AUTO_SOURCE, ...LIVE_LANGUAGES],
  targets: () => LIVE_LANGUAGES,
  initial: () => ({ source: 'en', target: 'zh-CN' }),
  // The pair never reaches the wire: the instructions name it, and the transcription hint takes its base language.
  wire: identityWire(),
};

/**
 * A code's English name, for the instructions' template: the code when
 * unnamed, and `AUTO` "the spoken language" — OpenAI Realtime's rule, where
 * the old client rendered the literal "auto" (a stated departure).
 */
export function liveLanguageName(code: string): string {
  if (code === AUTO) return 'the spoken language';
  return englishLanguageName(code);
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
