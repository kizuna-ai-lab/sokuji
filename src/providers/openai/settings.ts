/**
 * OpenAI Realtime's `S`, languages, credentials and effective model (survey
 * §2.3–2.8). `S` is the old slice (`OpenAIProviderConfig.ts:24-75`) without
 * what leaves it — the key (a credential, same key), the pair
 * (`providerStore`, same keys) and the temperature, which the GA endpoint
 * takes none of (ruling 6) — plus the instructions it now owns (Stage 2
 * Gemini, ruling 4). Stored under `settings.openai.*` as before. The
 * language and voice lists are the old descriptor's, copied: nothing here
 * imports `src/services`.
 */
import { AUTO } from '../../lib/provider/languages';
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS, migrateInstructions, type InstructionsSettings } from '../../lib/provider/instructions';
import type { CredentialsMissing, LanguageOption, MigrationInputs, ModelOption, Provider } from '../../lib/provider/types';

/** The transcription models for the source text, current generation first (`OpenAIProviderConfig.ts:292-298`); only the first two take `languages` / `keywords` (`transcription.ts`). */
export const TRANSCRIPT_MODELS = ['gpt-live-transcribe', 'gpt-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'] as const;
export type TranscriptModel = (typeof TRANSCRIPT_MODELS)[number];

export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const SEMANTIC_EAGERNESSES = ['Auto', 'Low', 'Medium', 'High'] as const;
export type SemanticEagerness = (typeof SEMANTIC_EAGERNESSES)[number];

export type NoiseReduction = 'None' | 'Near field' | 'Far field';
/** The old select's modes, in its order (`OpenAIProviderConfig.ts:288`). */
export const NOISE_REDUCTIONS: readonly NoiseReduction[] = ['None', 'Near field', 'Far field'];

/**
 * Automatic turn detection's mechanism, stored as it always was (choice 4):
 * `'Normal'` is server VAD, `'Semantic'` semantic VAD. The old field also
 * held the push modes (`'Disabled'`, OpenAI's push-to-talk, and
 * `'Push-to-Translate'`), which the global turn mode owns now; read back,
 * they are not a mechanism, and the field falls to its default.
 */
export type TurnDetectionMode = 'Normal' | 'Semantic';

export interface RealtimeSettings extends InstructionsSettings {
  /** The saved model; `effectiveRealtimeModel` decides at use, and nothing writes it back. */
  model: string;
  voice: string;
  turnDetectionMode: TurnDetectionMode;
  /** Server VAD, 0..1. */
  threshold: number;
  /** Server VAD, seconds, 0..2. */
  prefixPadding: number;
  /** Server VAD, seconds, 0..2. */
  silenceDuration: number;
  semanticEagerness: SemanticEagerness;
  /** 1..4096, or unlimited. */
  maxTokens: number | 'inf';
  transcriptModel: TranscriptModel;
  /** The raw glossary as typed: `transcription.ts` splits it, for the models that take keywords. */
  transcriptKeywords: string;
  noiseReduction: NoiseReduction;
  /**
   * The old transport choice: read and kept for the WebRTC step, never
   * shown, and not honoured — every session runs over WebSocket until that
   * step (ruling 12; choice 18).
   */
  transportType: 'websocket' | 'webrtc';
  /** Sent only for a `gpt-realtime-2*` model (`takesReasoning`). */
  reasoningEffort: ReasoningEffort;
}

export const REALTIME_DEFAULT_MODEL = 'gpt-realtime-2.1-mini';
export const REALTIME_DEFAULT_VOICE = 'alloy';

/** The old defaults (`OpenAIProviderConfig.ts:52-75`), less the temperature (ruling 6). */
export const REALTIME_DEFAULTS: RealtimeSettings = {
  ...INSTRUCTIONS_DEFAULTS,
  model: REALTIME_DEFAULT_MODEL,
  voice: REALTIME_DEFAULT_VOICE,
  turnDetectionMode: 'Normal',
  threshold: 0.49,
  prefixPadding: 0.5,
  silenceDuration: 0.5,
  semanticEagerness: 'Auto',
  maxTokens: 'inf',
  // The cheapest, the old default: upgrading is a per-user choice (`OpenAIProviderConfig.ts:63-66`).
  transcriptModel: 'gpt-4o-mini-transcribe',
  transcriptKeywords: '',
  noiseReduction: 'None',
  transportType: 'websocket',
  reasoningEffort: 'low',
};

/** The old sliders' ranges (`ProviderSpecificSettings.tsx:611-690`, `OpenAIProviderConfig.ts:320`): the view's and the builder's clamps. */
export const REALTIME_THRESHOLD_RANGE = { min: 0, max: 1, step: 0.01 } as const;
export const REALTIME_PREFIX_RANGE = { min: 0, max: 2, step: 0.01 } as const;
export const REALTIME_SILENCE_RANGE = { min: 0, max: 2, step: 0.01 } as const;
export const REALTIME_MAX_TOKENS_RANGE = { min: 1, max: 4096, step: 1 } as const;

/** The instructions' legacy keys (Stage 2 Gemini, choice 1): nothing else is read that `S` does not name (ruling 5). */
export const REALTIME_LEGACY_KEYS: readonly string[] = INSTRUCTION_LEGACY_KEYS;

const oneOf = <T extends string>(values: readonly T[], v: unknown, fallback: T): T => (values.includes(v as T) ? (v as T) : fallback);

/** A finite number as stored, else the default: the builder clamps it. */
function numberOf(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** `'inf'`, a number, or — as Electron reads back a number saved over a string default — the number's string (Stage 2 Gemini, ruling 10). */
function maxTokensOf(v: unknown): number | 'inf' {
  if (v === 'inf') return 'inf';
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : REALTIME_DEFAULTS.maxTokens;
}

/**
 * What was stored, made valid field by field, as every provider's
 * `migrate` does (ruling 5): a field of the wrong type or outside its values
 * falls to its default; clamping stays in `build`. No value is converted:
 * a push mode stored in `turnDetectionMode` is not a mechanism and reads as
 * `'Normal'`, a stored temperature is not read, and a model OpenAI has
 * deprecated stays saved — the effective model moves off it once the check
 * no longer lists it (choice 4). The instructions come from
 * `migrateInstructions`. Nothing is written back.
 */
export function migrateRealtimeSettings(stored: Readonly<Record<string, unknown>>, inputs: MigrationInputs): RealtimeSettings {
  const text = (k: 'model' | 'voice' | 'transcriptKeywords') => (typeof stored[k] === 'string' ? (stored[k] as string) : REALTIME_DEFAULTS[k]);
  return {
    ...migrateInstructions(stored, inputs.legacy),
    model: text('model'),
    voice: text('voice'),
    turnDetectionMode: oneOf<TurnDetectionMode>(['Normal', 'Semantic'], stored.turnDetectionMode, REALTIME_DEFAULTS.turnDetectionMode),
    threshold: numberOf(stored.threshold, REALTIME_DEFAULTS.threshold),
    prefixPadding: numberOf(stored.prefixPadding, REALTIME_DEFAULTS.prefixPadding),
    silenceDuration: numberOf(stored.silenceDuration, REALTIME_DEFAULTS.silenceDuration),
    semanticEagerness: oneOf(SEMANTIC_EAGERNESSES, stored.semanticEagerness, REALTIME_DEFAULTS.semanticEagerness),
    maxTokens: maxTokensOf(stored.maxTokens),
    transcriptModel: oneOf(TRANSCRIPT_MODELS, stored.transcriptModel, REALTIME_DEFAULTS.transcriptModel),
    transcriptKeywords: text('transcriptKeywords'),
    noiseReduction: oneOf(NOISE_REDUCTIONS, stored.noiseReduction, REALTIME_DEFAULTS.noiseReduction),
    transportType: oneOf<RealtimeSettings['transportType']>(['websocket', 'webrtc'], stored.transportType, REALTIME_DEFAULTS.transportType),
    reasoningEffort: oneOf(REASONING_EFFORTS, stored.reasoningEffort, REALTIME_DEFAULTS.reasoningEffort),
  };
}

/** The prebuilt voices (`OpenAIProviderConfig.ts:249-260`). */
export const REALTIME_VOICES: readonly { value: string; name: string }[] = [
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
];

/** The 55 languages the old provider offered (`OpenAIProviderConfig.ts:191-247`): every one a source and a target. */
export const REALTIME_LANGUAGES: readonly LanguageOption[] = [
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

/** "Auto-detect" stays a source (ruling 7): the model hears any language. Named as the other providers name it; the picker shows `common.autoDetect`. */
const AUTO_SOURCE: LanguageOption = { value: AUTO, name: 'Auto', englishName: 'Auto' };

/**
 * `AUTO` first, then the 55, as the old picker listed them (`LanguageSection.tsx:587-589`);
 * every language a target for every source, the source included (the old
 * `resolveTargetLanguages`). D20 refuses Both for an `AUTO` source: it
 * never reverses.
 */
export const realtimeLanguages: Provider<RealtimeSettings, never, never>['languages'] = {
  sources: () => [AUTO_SOURCE, ...REALTIME_LANGUAGES],
  targets: () => REALTIME_LANGUAGES,
  initial: () => ({ source: 'en', target: 'zh_CN' }),
};

/**
 * A code's English name, for the instructions' template (the old rule: the
 * code when unnamed, `settingsStore.ts:1443-1444`). `AUTO` is "the spoken
 * language" (ruling 7), where the old template read "auto".
 */
export function realtimeLanguageName(code: string): string {
  if (code === AUTO) return 'the spoken language';
  return REALTIME_LANGUAGES.find((o) => o.value === code)?.englishName || code;
}

export interface RealtimeCredentials {
  apiKey: string;
}

export const realtimeCredentials: Provider<RealtimeSettings, RealtimeCredentials, never>['credentials'] = {
  keys: ['apiKey'],
  fields: () => [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }],
  read: (values): RealtimeCredentials | CredentialsMissing => {
    // Trimmed (choice 19): the key rides in a subprotocol, and a pasted trailing newline or space is no valid token.
    const apiKey = (values.apiKey ?? '').trim();
    // No code: the runner words it `credentials_missing` ("Enter your API key in Settings before starting.").
    return apiKey ? { apiKey } : { missing: 'Enter your OpenAI API key.' };
  },
};

/**
 * A voice-agent model (`OpenAIClient.ts:250-259`): an id starting
 * `gpt-realtime`, less the transcription and translation families, which
 * are other providers' (OpenAI Translate's, a transcriber's).
 */
export function isRealtimeModelId(id: string): boolean {
  const name = id.toLowerCase();
  return name.startsWith('gpt-realtime') && !name.startsWith('gpt-realtime-whisper') && !name.startsWith('gpt-realtime-translate');
}

/**
 * The model a session runs (spec: "Readiness is one check"): the saved one
 * when the check listed it, else the default model when listed — so a model
 * OpenAI stopped listing runs as the default, whatever sorts newest — else
 * the newest listed, else the saved one while nothing is listed yet (choice
 * 4). The settings view and `build` call this same function; nothing writes
 * it back (the old auto-select's write-back, `settingsStore.ts:1174-1191`,
 * is gone).
 */
export function effectiveRealtimeModel(s: Pick<RealtimeSettings, 'model'>, models: readonly ModelOption[]): string {
  if (models.some((m) => m.id === s.model)) return s.model;
  if (models.some((m) => m.id === REALTIME_DEFAULT_MODEL)) return REALTIME_DEFAULT_MODEL;
  return models[0]?.id ?? s.model;
}

/** Only `gpt-realtime-2*` takes `reasoning.effort`; older models refuse it (`openAIRealtimeSession.ts:106-108`). */
export function takesReasoning(model: string): boolean {
  return model.startsWith('gpt-realtime-2');
}
