/**
 * OpenAI Realtime's `S`, languages, credentials and effective model (survey
 * §2.3–2.8). `S` is the old slice (`OpenAIProviderConfig.ts:24-75`) without
 * what leaves it — the key (a credential, same key), the pair
 * (`providerStore`, same keys), the temperature, which the GA endpoint
 * takes none of (ruling 6), and the transport choice: every session runs
 * over WebSocket (ruling 12), and the owner abandoned WebRTC for this
 * provider (2026-09-29), so a stored `transportType` is not read — plus the
 * instructions it now owns (Stage 2 Gemini, ruling 4). Stored under
 * `settings.openai.*` as before. The language and voice lists are the old
 * descriptor's, copied: nothing here imports `src/services`.
 */
import { AUTO } from '../../lib/provider/languages';
import { identityWire } from '../../lib/language/wire';
import { englishLanguageName } from '../../lib/language/label';
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS, migrateInstructions, type InstructionsSettings } from '../../lib/provider/instructions';
import type { CredentialsMissing, LanguageOption, MigrationInputs, ModelOption, Provider } from '../../lib/provider/types';

/** The transcription models for the source text, current generation first (`OpenAIProviderConfig.ts:292-298`); only the first two take `languages` / `keywords` (`transcription.ts`). */
export const TRANSCRIPT_MODELS = ['gpt-live-transcribe', 'gpt-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'] as const;
export type TranscriptModel = (typeof TRANSCRIPT_MODELS)[number];

export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export const SEMANTIC_EAGERNESSES = ['Auto', 'Low', 'Medium', 'High'] as const;
export type SemanticEagerness = (typeof SEMANTIC_EAGERNESSES)[number];

/** The turn-detection mechanisms (`TurnDetectionMode`), in the order the controls offer them. */
export const TURN_DETECTION_MODES = ['Normal', 'Semantic'] as const;

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
export type TurnDetectionMode = (typeof TURN_DETECTION_MODES)[number];

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
 * `'Normal'`, a stored temperature or transport is not read, and a model
 * OpenAI has deprecated stays saved — the effective model moves off it once
 * the check no longer lists it (choice 4). The instructions come from
 * `migrateInstructions`. Nothing is written back.
 */
export function migrateRealtimeSettings(stored: Readonly<Record<string, unknown>>, inputs: MigrationInputs): RealtimeSettings {
  const text = (k: 'model' | 'voice' | 'transcriptKeywords') => (typeof stored[k] === 'string' ? (stored[k] as string) : REALTIME_DEFAULTS[k]);
  return {
    ...migrateInstructions(stored, inputs.legacy),
    model: text('model'),
    voice: text('voice'),
    turnDetectionMode: oneOf(TURN_DETECTION_MODES, stored.turnDetectionMode, REALTIME_DEFAULTS.turnDetectionMode),
    threshold: numberOf(stored.threshold, REALTIME_DEFAULTS.threshold),
    prefixPadding: numberOf(stored.prefixPadding, REALTIME_DEFAULTS.prefixPadding),
    silenceDuration: numberOf(stored.silenceDuration, REALTIME_DEFAULTS.silenceDuration),
    semanticEagerness: oneOf(SEMANTIC_EAGERNESSES, stored.semanticEagerness, REALTIME_DEFAULTS.semanticEagerness),
    maxTokens: maxTokensOf(stored.maxTokens),
    transcriptModel: oneOf(TRANSCRIPT_MODELS, stored.transcriptModel, REALTIME_DEFAULTS.transcriptModel),
    transcriptKeywords: text('transcriptKeywords'),
    noiseReduction: oneOf(NOISE_REDUCTIONS, stored.noiseReduction, REALTIME_DEFAULTS.noiseReduction),
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

/** "Auto-detect" stays a source (ruling 7): the model hears any language. Named as the other providers name it; the picker shows `common.autoDetect`. */
const AUTO_SOURCE: LanguageOption = { value: AUTO };

/**
 * `AUTO` first, then the 55, as the old picker listed them (`LanguageSection.tsx:587-589`);
 * every language a target for every source, the source included (the old
 * `resolveTargetLanguages`). D20 refuses Both for an `AUTO` source: it
 * never reverses.
 */
export const realtimeLanguages: Provider<RealtimeSettings, never, never>['languages'] = {
  sources: () => [AUTO_SOURCE, ...REALTIME_LANGUAGES],
  targets: () => REALTIME_LANGUAGES,
  initial: () => ({ source: 'en', target: 'zh-CN' }),
  // The pair never reaches the wire: the instructions name it, and the transcription hint takes its base language.
  wire: identityWire(),
};

/**
 * A code's English name, for the instructions' template (the old rule: the
 * code when unnamed, `settingsStore.ts:1443-1444`). `AUTO` is "the spoken
 * language" (ruling 7), where the old template read "auto".
 */
export function realtimeLanguageName(code: string): string {
  if (code === AUTO) return 'the spoken language';
  return englishLanguageName(code);
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

/**
 * Only `gpt-realtime-2*` takes `reasoning.effort`; older models refuse it
 * (`openAIRealtimeSession.ts:106-108`). A dated 1.0 snapshot such as
 * `gpt-realtime-2025-08-28` is not itself a 2.x model — its next segment is
 * a four-digit year, not a minor version — so the leading number must read
 * as a plausible major version, not a year.
 */
export function takesReasoning(model: string): boolean {
  const match = /^gpt-realtime-(\d+)(?:\.\d+)?(?:-|$)/.exec(model);
  if (!match) return false;
  const major = Number(match[1]);
  return major >= 2 && major < 1000;
}
