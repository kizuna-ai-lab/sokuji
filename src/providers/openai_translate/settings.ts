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
import { wireTable } from '../../lib/language/wire';
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
  { value: 'en' },
  { value: 'es' },
  { value: 'pt' },
  { value: 'fr' },
  { value: 'ja' },
  { value: 'ru' },
  { value: 'zh' },
  { value: 'de' },
  { value: 'ko' },
  { value: 'hi' },
  { value: 'id' },
  { value: 'vi' },
  { value: 'it' },
];

/** The 73 languages it hears (Tagalog's row folded into Filipino: CLDR names `tl` and `fil` alike); no `auto`, though the model detects what is spoken (ruling 15). */
export const TRANSLATE_SOURCES: readonly LanguageOption[] = [
  { value: 'af' },
  { value: 'ar' },
  { value: 'az' },
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
  { value: 'dz' },
  { value: 'en' },
  { value: 'eo' },
  { value: 'et' },
  { value: 'eu' },
  { value: 'fa' },
  { value: 'fi' },
  { value: 'fil' },
  { value: 'fr' },
  { value: 'gl' },
  { value: 'de' },
  { value: 'el' },
  { value: 'gu' },
  { value: 'ht' },
  { value: 'haw' },
  { value: 'he' },
  { value: 'hi' },
  { value: 'hu' },
  { value: 'hy' },
  { value: 'id' },
  { value: 'it' },
  { value: 'ja' },
  { value: 'jv' },
  { value: 'ka' },
  { value: 'kk' },
  { value: 'ko' },
  { value: 'ku' },
  { value: 'la' },
  { value: 'lv' },
  { value: 'lt' },
  { value: 'mk' },
  { value: 'ms' },
  { value: 'ml' },
  { value: 'mi' },
  { value: 'mn' },
  { value: 'my' },
  { value: 'ne' },
  { value: 'no' },
  { value: 'nn' },
  { value: 'pl' },
  { value: 'pt' },
  { value: 'pa' },
  { value: 'ro' },
  { value: 'ru' },
  { value: 'sr' },
  { value: 'sn' },
  { value: 'sk' },
  { value: 'sl' },
  { value: 'sq' },
  { value: 'es' },
  { value: 'sw' },
  { value: 'sv' },
  { value: 'te' },
  { value: 'th' },
  { value: 'tr' },
  { value: 'uk' },
  { value: 'uz' },
  { value: 'vi' },
  { value: 'cy' },
  { value: 'yo' },
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
  // Its codes are the app's: the target goes out as `output.language` unchanged.
  wire: wireTable([...new Set([...TRANSLATE_TARGETS, ...TRANSLATE_SOURCES].map((o) => o.value))].map((code) => [code] as const)),
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
