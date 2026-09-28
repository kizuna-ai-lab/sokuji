/**
 * Gemini's `S`, languages, credentials and default model (survey §2.2–2.5).
 * `S` is the old slice (`GeminiProviderConfig.ts:15-43`) without what leaves
 * it — the key (a credential, same key), the pair (`providerStore`, same
 * keys) and `turnDetectionMode` (the global turn mode, migrated once by
 * `storedSettings.ts:56`) — plus the instructions it now owns (ruling 4).
 * Stored under `settings.gemini.*` as before. The Live Translate helpers
 * are copied from `geminiTranslateModel.ts`: nothing here imports
 * `src/services`, whose copy the deletion plan removes.
 */
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS, migrateInstructions, type InstructionsSettings } from '../../lib/provider/instructions';
import type { CredentialsMissing, LanguageOption, MigrationInputs, ModelOption, Provider } from '../../lib/provider/types';

export interface GeminiSettings extends InstructionsSettings {
  /** The Live model; '' until one is chosen — `effectiveGeminiModel` decides at use, and nothing writes it back. */
  model: string;
  /** A prebuilt voice (`GEMINI_VOICES`); Live Translate speaks in the speaker's own. */
  voice: string;
  /** Dialogue models: 0..2. */
  temperature: number;
  /** Dialogue models: 1..8192, or unlimited. */
  maxTokens: number | 'inf';
  vadStartSensitivity: 'high' | 'low';
  vadEndSensitivity: 'high' | 'low';
  /** 50..3000 ms. */
  vadSilenceDurationMs: number;
  /** 0..2000 ms. */
  vadPrefixPaddingMs: number;
}

export const GEMINI_DEFAULT_VOICE = 'Aoede';

export const GEMINI_DEFAULTS: GeminiSettings = {
  ...INSTRUCTIONS_DEFAULTS,
  model: '',
  voice: GEMINI_DEFAULT_VOICE,
  temperature: 0.8,
  maxTokens: 'inf',
  vadStartSensitivity: 'low',
  vadEndSensitivity: 'high',
  vadSilenceDurationMs: 500,
  vadPrefixPaddingMs: 300,
};

/** The old UI's ranges (`GeminiProviderConfig.ts:243-244`; `ProviderSpecificSettings.tsx:1184-1187, 1209-1212`): the sliders' and the builder's clamps. */
export const GEMINI_TEMPERATURE_RANGE = { min: 0, max: 2, step: 0.1 } as const;
export const GEMINI_MAX_TOKENS_RANGE = { min: 1, max: 8192, step: 1 } as const;
export const GEMINI_VAD_SILENCE_RANGE = { min: 50, max: 3000, step: 50 } as const;
export const GEMINI_VAD_PREFIX_RANGE = { min: 0, max: 2000, step: 50 } as const;

/** The instructions' legacy keys (ruling 4; choice 1): Gemini's own three fields, then the old global three. */
export const GEMINI_LEGACY_KEYS: readonly string[] = INSTRUCTION_LEGACY_KEYS;

const SENSITIVITIES: readonly unknown[] = ['high', 'low'];

/** A stored `maxTokens`: `'inf'`, a number, or — the old Electron app's — the number's string (ruling 10). */
function maxTokensOf(v: unknown): number | 'inf' {
  if (v === 'inf') return 'inf';
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : GEMINI_DEFAULTS.maxTokens;
}

/**
 * What was stored, made valid field by field; clamping stays in `build`.
 * `maxTokens` saved by the old Electron app reads back as its string
 * (`'2048'`: the default `'inf'` is a string, `SettingsService.ts:58-60`)
 * and is read as the number it was (ruling 10). The instructions come
 * from `migrateInstructions` (ruling 4). Nothing is written back.
 */
export function migrateGeminiSettings(stored: Readonly<Record<string, unknown>>, inputs: MigrationInputs): GeminiSettings {
  const str = (k: 'model' | 'voice') => (typeof stored[k] === 'string' ? (stored[k] as string) : GEMINI_DEFAULTS[k]);
  const num = (k: 'temperature' | 'vadSilenceDurationMs' | 'vadPrefixPaddingMs') => {
    const v = stored[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : GEMINI_DEFAULTS[k];
  };
  const sensitivity = (k: 'vadStartSensitivity' | 'vadEndSensitivity') =>
    SENSITIVITIES.includes(stored[k]) ? (stored[k] as 'high' | 'low') : GEMINI_DEFAULTS[k];
  return {
    ...migrateInstructions(stored, inputs.legacy),
    model: str('model'),
    voice: str('voice'),
    temperature: num('temperature'),
    maxTokens: maxTokensOf(stored.maxTokens),
    vadStartSensitivity: sensitivity('vadStartSensitivity'),
    vadEndSensitivity: sensitivity('vadEndSensitivity'),
    vadSilenceDurationMs: num('vadSilenceDurationMs'),
    vadPrefixPaddingMs: num('vadPrefixPaddingMs'),
  };
}

/** The prebuilt voices (`GeminiProviderConfig.ts:177-206`). */
export const GEMINI_VOICES: readonly { value: string; name: string }[] = [
  'Aoede', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Zephyr', 'Achird', 'Algenib',
  'Algieba', 'Alnilam', 'Autonoe', 'Callirrhoe', 'Despina', 'Enceladus', 'Erinome', 'Gacrux', 'Iapetus', 'Laomedeia',
  'Pulcherrima', 'Rasalgethi', 'Sadachbia', 'Sadaltager', 'Schedar', 'Sulafat', 'Umbriel', 'Vindemiatrix', 'Zubenelgenubi', 'Achernar',
].map((voice) => ({ value: voice, name: voice }));

/** The 34 regional values the Live API takes (`GeminiProviderConfig.ts:139-174`). */
export const GEMINI_LANGUAGES: readonly LanguageOption[] = [
  { name: 'English (United States)', value: 'en-US', englishName: 'English (United States)' },
  { name: 'English (Australia)', value: 'en-AU', englishName: 'English (Australia)' },
  { name: 'English (United Kingdom)', value: 'en-GB', englishName: 'English (United Kingdom)' },
  { name: 'English (India)', value: 'en-IN', englishName: 'English (India)' },
  { name: 'Español (Estados Unidos)', value: 'es-US', englishName: 'Spanish (United States)' },
  { name: 'Deutsch (Deutschland)', value: 'de-DE', englishName: 'German (Germany)' },
  { name: 'Français (France)', value: 'fr-FR', englishName: 'French (France)' },
  { name: 'हिन्दी (भारत)', value: 'hi-IN', englishName: 'Hindi (India)' },
  { name: 'Português (Brasil)', value: 'pt-BR', englishName: 'Portuguese (Brazil)' },
  { name: 'العربية (عام)', value: 'ar-XA', englishName: 'Arabic (Standard)' },
  { name: 'Español (España)', value: 'es-ES', englishName: 'Spanish (Spain)' },
  { name: 'Français (Canada)', value: 'fr-CA', englishName: 'French (Canada)' },
  { name: 'Bahasa Indonesia (Indonesia)', value: 'id-ID', englishName: 'Indonesian (Indonesia)' },
  { name: 'Italiano (Italia)', value: 'it-IT', englishName: 'Italian (Italy)' },
  { name: '日本語 (日本)', value: 'ja-JP', englishName: 'Japanese (Japan)' },
  { name: 'Türkçe (Türkiye)', value: 'tr-TR', englishName: 'Turkish (Turkey)' },
  { name: 'Tiếng Việt (Việt Nam)', value: 'vi-VN', englishName: 'Vietnamese (Vietnam)' },
  { name: 'বাংলা (ভারত)', value: 'bn-IN', englishName: 'Bengali (India)' },
  { name: 'ગુજરાતી (ભારત)', value: 'gu-IN', englishName: 'Gujarati (India)' },
  { name: 'ಕನ್ನಡ (ಭಾರತ)', value: 'kn-IN', englishName: 'Kannada (India)' },
  { name: 'മലയാളം (ഇന്ത്യ)', value: 'ml-IN', englishName: 'Malayalam (India)' },
  { name: 'मराठी (भारत)', value: 'mr-IN', englishName: 'Marathi (India)' },
  { name: 'தமிழ் (இந்தியா)', value: 'ta-IN', englishName: 'Tamil (India)' },
  { name: 'తెలుగు (భారతదేశం)', value: 'te-IN', englishName: 'Telugu (India)' },
  { name: 'Nederlands (België)', value: 'nl-BE', englishName: 'Dutch (Belgium)' },
  { name: 'Nederlands (Nederland)', value: 'nl-NL', englishName: 'Dutch (Netherlands)' },
  { name: '한국어 (대한민국)', value: 'ko-KR', englishName: 'Korean (South Korea)' },
  { name: '普通话 (中国)', value: 'cmn-CN', englishName: 'Mandarin Chinese (China)' },
  { name: 'Polski (Polska)', value: 'pl-PL', englishName: 'Polish (Poland)' },
  { name: 'Русский (Россия)', value: 'ru-RU', englishName: 'Russian (Russia)' },
  { name: 'Kiswahili (Kenya)', value: 'sw-KE', englishName: 'Swahili (Kenya)' },
  { name: 'ไทย (ประเทศไทย)', value: 'th-TH', englishName: 'Thai (Thailand)' },
  { name: 'اردو (ہندوستان)', value: 'ur-IN', englishName: 'Urdu (India)' },
  { name: 'Українська (Україна)', value: 'uk-UA', englishName: 'Ukrainian (Ukraine)' },
];

/** Every value is a source and a target (the old `resolveTargetLanguages` returned the same list); no `auto`, so the participant leg always reverses (D20). */
export const geminiLanguages: Provider<GeminiSettings, never, never>['languages'] = {
  sources: () => GEMINI_LANGUAGES,
  targets: () => GEMINI_LANGUAGES,
  initial: () => ({ source: 'en-US', target: 'ja-JP' }),
};

/** A code's English name, for the instructions' template (the old rule: the code when unnamed, `settingsStore.ts:1443-1444`). */
export function geminiLanguageName(code: string): string {
  return GEMINI_LANGUAGES.find((o) => o.value === code)?.englishName || code;
}

export interface GeminiCredentials {
  apiKey: string;
}

export const geminiCredentials: Provider<GeminiSettings, GeminiCredentials, never>['credentials'] = {
  keys: ['apiKey'],
  fields: () => [{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }],
  read: (values): GeminiCredentials | CredentialsMissing => {
    const apiKey = values.apiKey ?? '';
    // No code: the runner words it `credentials_missing` ("Enter your API key in Settings before starting.").
    return apiKey ? { apiKey } : { missing: 'Enter your Gemini API key.' };
  },
};

/** The substring naming Live Translate (`geminiTranslateModel.ts:30-37`): narrower than `translate`, so a text model cannot match. */
const TRANSLATE_MODEL_MARKER = 'live-translate';

export function isGeminiTranslateModel(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.includes(TRANSLATE_MODEL_MARKER);
}

/** `zh` came back Simplified, `cmn` Traditional (measured 2026-08-10, `geminiTranslateModel.ts:39-50`). */
const EXPLICIT_TRANSLATION_CODES: Readonly<Record<string, string>> = { 'cmn-CN': 'zh' };

/** A regional value as Live Translate's `targetLanguageCode` takes it (`ja-JP` → `ja`, `cmn-CN` → `zh`). */
export function toTranslationLanguageCode(code: string): string {
  if (!code) return '';
  return EXPLICIT_TRANSLATION_CODES[code] ?? code.split('-')[0];
}

/** A Live (bidirectional) model by the old rule (`GeminiClient.ts:238-251`): the id names `audio` or `live`, and not `transcribe` — the STT-only Live models translate nothing. */
export function isGeminiLiveModel(id: string): boolean {
  const lower = id.toLowerCase();
  return !lower.includes('transcribe') && (lower.includes('audio') || lower.includes('live'));
}

/**
 * The family: an id's first `major[.minor]` right after `gemini-` (or
 * `gemini-live-`) — `gemini-2.5-…`, `gemini-live-2.5-…` — as one comparable
 * number. A missing minor reads as 0 (Google spells some Gemini 3 ids with
 * no minor at all, e.g. `gemini-3-pro-preview`); an id with no leading
 * version reads 0.
 */
function familyOf(id: string): number {
  const m = /^gemini-(?:live-)?(\d+)(?:\.(\d+))?(?=-|$)/.exec(id);
  return m ? Number(m[1]) * 1000 + Number(m[2] ?? 0) : 0;
}

/** What the user's speech does to a response still playing: nothing, or cut it off (barge-in). The Live API's own two values. */
export type GeminiActivityHandling = 'NO_INTERRUPTION' | 'START_OF_ACTIVITY_INTERRUPTS';

/**
 * A model's activity handling, by its family (Gemini/AST2 follow-up, ruling
 * 5; choice 9). The owner's overlap probe: `gemini-3.8-live` under
 * `NO_INTERRUPTION` dropped the input that arrived while it answered, and
 * barge-in kept both utterances whole; the 2.5 native-audio models are the
 * opposite, barge-in truncating the answer they were still speaking. So a
 * dialogue model of family 3.0 or later barges in; 2.5 and below, and an id
 * with no version, keep today's `NO_INTERRUPTION`; Live Translate keeps it
 * too — its guide never mentions activity handling.
 */
export function geminiActivityHandling(model: string): GeminiActivityHandling {
  if (isGeminiTranslateModel(model)) return 'NO_INTERRUPTION';
  return familyOf(model) >= 3000 ? 'START_OF_ACTIVITY_INTERRUPTS' : 'NO_INTERRUPTION';
}

/** The release date an id ends with, `-MM-YYYY` (`…-preview-12-2025`), as YYYYMM; an undated id reads 0. */
function dateOf(id: string): number {
  const m = /-(\d{2})-(\d{4})$/.exec(id);
  return m ? Number(m[2]) * 100 + Number(m[1]) : 0;
}

/** Newest first (ruling 2): the higher family, then the later date — a dated id before an undated one — then the id, ascending. */
export function compareGeminiModels(a: string, b: string): number {
  return familyOf(b) - familyOf(a) || dateOf(b) - dateOf(a) || (a < b ? -1 : a > b ? 1 : 0);
}

export function sortGeminiModels(ids: readonly string[]): string[] {
  return [...ids].sort(compareGeminiModels);
}

/**
 * A fresh profile's model: the newest Live Translate the check listed —
 * simultaneous interpretation, the product's own scenario (Gemini/AST2
 * follow-up, ruling 3); with none, the old rule (ruling 2): the newest
 * `native-audio` dialogue model, else the newest model; with none, ''.
 * Nothing is migrated: a saved model the check lists stays, and an unset
 * one (''), or one no longer listed, resolves to this at use
 * (`effectiveGeminiModel`).
 */
export function defaultGeminiModel(models: readonly ModelOption[]): string {
  const newest = sortGeminiModels(models.map((m) => m.id));
  return newest.find(isGeminiTranslateModel) ?? newest.find((id) => id.includes('native-audio')) ?? newest[0] ?? '';
}

/**
 * The model a session runs (spec: "Readiness is one check"): the saved one
 * when the check listed it, else the default; the saved one while nothing
 * is listed yet. The settings view and `build` call this same function.
 */
export function effectiveGeminiModel(s: Pick<GeminiSettings, 'model'>, models: readonly ModelOption[]): string {
  return models.some((m) => m.id === s.model) ? s.model : defaultGeminiModel(models) || s.model;
}
