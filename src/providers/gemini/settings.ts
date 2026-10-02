/**
 * Gemini's `S`, languages, credentials and default model (survey §2.2–2.5).
 * `S` is the old slice (`GeminiProviderConfig.ts:15-43`) without what leaves
 * it — the key (a credential, same key), the pair (`providerStore`, same
 * keys) and `turnDetectionMode` (the global turn mode, migrated once by
 * `storedSettings.ts:56`) — plus the instructions it now owns (ruling 4).
 * Stored under `settings.gemini.*` as before. The Live Translate helpers
 * are copied from `geminiTranslateModel.ts`, deleted since with the old
 * client (Stage 2 deletion, ruling 2).
 */
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS, migrateInstructions, type InstructionsSettings } from '../../lib/provider/instructions';
import { englishLanguageName, wireTable } from '../../lib/language';
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

export interface GeminiVoice {
  value: string;
  name: string;
  /** Cloud Text-to-Speech's gender for the same voice (docs.cloud.google.com/text-to-speech/docs/chirp3-hd): the Gemini guides give none. */
  gender: 'female' | 'male';
  /** The speech-generation guide's one word (ai.google.dev/gemini-api/docs/speech-generation), as a facet value: `Easy-going` is `easy_going`. */
  style: string;
}

/**
 * The prebuilt voices (`GeminiProviderConfig.ts:177-206`), in the old order:
 * still the 30 Google documents for the Live models (2026-10-03), each
 * speaking every language the model does.
 */
export const GEMINI_VOICES: readonly GeminiVoice[] = ([
  ['Aoede', 'female', 'breezy'], ['Puck', 'male', 'upbeat'], ['Charon', 'male', 'informative'], ['Kore', 'female', 'firm'],
  ['Fenrir', 'male', 'excitable'], ['Leda', 'female', 'youthful'], ['Orus', 'male', 'firm'], ['Zephyr', 'female', 'bright'],
  ['Achird', 'male', 'friendly'], ['Algenib', 'male', 'gravelly'], ['Algieba', 'male', 'smooth'], ['Alnilam', 'male', 'firm'],
  ['Autonoe', 'female', 'bright'], ['Callirrhoe', 'female', 'easy_going'], ['Despina', 'female', 'smooth'], ['Enceladus', 'male', 'breathy'],
  ['Erinome', 'female', 'clear'], ['Gacrux', 'female', 'mature'], ['Iapetus', 'male', 'clear'], ['Laomedeia', 'female', 'upbeat'],
  ['Pulcherrima', 'female', 'forward'], ['Rasalgethi', 'male', 'informative'], ['Sadachbia', 'male', 'lively'], ['Sadaltager', 'male', 'knowledgeable'],
  ['Schedar', 'male', 'even'], ['Sulafat', 'female', 'warm'], ['Umbriel', 'male', 'easy_going'], ['Vindemiatrix', 'female', 'gentle'],
  ['Zubenelgenubi', 'male', 'casual'], ['Achernar', 'female', 'soft'],
] as const).map(([value, gender, style]) => ({ value, name: value, gender, style }));

/** Where Google documents a language (Gemini/AST2 follow-up, ruling 6): in both tables below, the Live API's alone, or Live Translate's alone. */
type Documented = 'both' | 'dialogue' | 'translate';

/**
 * Google's two language tables, as documented on 2026-09-29, in one list:
 * English first, then Google's own order, by English name (Gemini/AST2
 * follow-up, ruling 6; choice 14):
 * - the Live API capabilities guide's 99: what the dialogue models hear and
 *   speak, with no language code on the wire — only the instructions name the
 *   pair, by the English names here;
 * - Live Translate's 78, its `targetLanguageCode` values. It takes no source
 *   language: it detects it.
 * Each code is Google's own — bare but for Portuguese's and Chinese's two
 * variants each; Norwegian's row names `no` and `nb`, and `no` is offered.
 * Named from CLDR (unified language codes), not here.
 */
const GEMINI_LANGUAGE_TABLE: ReadonlyArray<readonly [value: string, documented: Documented]> = [
  // First, as in the old list. A side a model switch takes out of the offer falls here by the generic rule (`normalizePair`
  // takes the first entry), English → English included; a stored one takes `initial`'s (Gemini/AST2 follow-up, choice 17).
  ['en', 'both'],
  ['af', 'both'],
  ['ak', 'both'],
  ['sq', 'both'],
  ['am', 'both'],
  ['ar', 'both'],
  ['hy', 'both'],
  ['as', 'dialogue'],
  ['az', 'both'],
  ['eu', 'both'],
  ['be', 'both'],
  ['bn', 'both'],
  ['bs', 'dialogue'],
  ['bg', 'both'],
  ['my', 'both'],
  ['ca', 'both'],
  ['ceb', 'dialogue'],
  ['zh-Hans', 'both'],
  ['zh-Hant', 'both'],
  ['hr', 'both'],
  ['cs', 'both'],
  ['da', 'both'],
  ['nl', 'both'],
  ['et', 'both'],
  ['fo', 'dialogue'],
  ['fil', 'both'],
  ['fi', 'both'],
  ['fr', 'both'],
  ['gl', 'both'],
  ['ka', 'both'],
  ['de', 'both'],
  ['el', 'both'],
  ['gu', 'both'],
  ['ha', 'both'],
  ['he', 'both'],
  ['hi', 'both'],
  ['hu', 'both'],
  ['is', 'both'],
  ['id', 'both'],
  ['ga', 'dialogue'],
  ['it', 'both'],
  ['ja', 'both'],
  ['jv', 'translate'],
  ['kn', 'both'],
  ['kk', 'both'],
  ['km', 'both'],
  ['rw', 'both'],
  ['ko', 'both'],
  ['ku', 'dialogue'],
  ['ky', 'dialogue'],
  ['lo', 'both'],
  ['lv', 'both'],
  ['lt', 'both'],
  ['mk', 'both'],
  ['ms', 'both'],
  ['ml', 'both'],
  ['mt', 'dialogue'],
  ['mi', 'dialogue'],
  ['mr', 'both'],
  ['mn', 'both'],
  ['ne', 'both'],
  ['no', 'both'],
  ['or', 'dialogue'],
  ['om', 'dialogue'],
  ['ps', 'dialogue'],
  ['fa', 'both'],
  ['pl', 'both'],
  ['pt-BR', 'both'],
  ['pt-PT', 'both'],
  ['pa', 'both'],
  ['qu', 'dialogue'],
  ['ro', 'both'],
  ['rm', 'dialogue'],
  ['ru', 'both'],
  ['sr', 'both'],
  ['sd', 'both'],
  ['si', 'both'],
  ['sk', 'both'],
  ['sl', 'both'],
  ['so', 'dialogue'],
  ['st', 'dialogue'],
  ['es', 'both'],
  ['su', 'translate'],
  ['sw', 'both'],
  ['sv', 'both'],
  ['tg', 'dialogue'],
  ['ta', 'both'],
  ['te', 'both'],
  ['th', 'both'],
  ['tn', 'dialogue'],
  ['tr', 'both'],
  ['tk', 'dialogue'],
  ['uk', 'both'],
  ['ur', 'both'],
  ['uz', 'both'],
  ['vi', 'both'],
  ['cy', 'dialogue'],
  ['fy', 'dialogue'],
  ['wo', 'dialogue'],
  ['yo', 'dialogue'],
  ['zu', 'both'],
];

const offered = (documented: readonly Documented[]): readonly LanguageOption[] =>
  GEMINI_LANGUAGE_TABLE.filter((row) => documented.includes(row[1])).map(([value]) => ({ value }));

/** A dialogue model's sources and targets alike: the Live API's 99. */
export const GEMINI_DIALOGUE_LANGUAGES = offered(['both', 'dialogue']);
/** Live Translate's targets: its 78. */
export const GEMINI_TRANSLATE_TARGETS = offered(['both', 'translate']);
/** Live Translate's sources: every language Google documents either model hearing — the 99, and its own two besides (Gemini/AST2 follow-up, choice 16). */
export const GEMINI_TRANSLATE_SOURCES = offered(['both', 'dialogue', 'translate']);

/**
 * The saved model's family decides the offer (Gemini/AST2 follow-up, choice
 * 16): Live Translate's, or a dialogue model's. No model chosen ('') reads as
 * Live Translate, the default a key that lists it runs (Gemini/AST2
 * follow-up, ruling 3). A key that lists none runs a dialogue model on the
 * Live Translate offer until a model is picked: narrower targets, each one a
 * dialogue model takes too but Javanese and Sundanese, which only its
 * instructions name. The typed-text box reads it too (`textInput`).
 */
export function offersTranslate(s: Pick<GeminiSettings, 'model'>): boolean {
  return s.model === '' || isGeminiTranslateModel(s.model);
}

/** No `auto`: Live Translate detects the source, but the source still decides Both's reversal and the rows' labels (D20). */
export const geminiLanguages: Provider<GeminiSettings, never, never>['languages'] = {
  sources: (s) => (offersTranslate(s) ? GEMINI_TRANSLATE_SOURCES : GEMINI_DIALOGUE_LANGUAGES),
  targets: (_source, s) => (offersTranslate(s) ? GEMINI_TRANSLATE_TARGETS : GEMINI_DIALOGUE_LANGUAGES),
  initial: () => ({ source: 'en', target: 'ja' }),
  // Google's codes are BCP-47 and the app's: Live Translate's targetLanguageCode is the code itself.
  wire: wireTable(GEMINI_LANGUAGE_TABLE.map(([value]) => [value] as const)),
};

/** A code's English name, CLDR's, for the instructions' template. */
export function geminiLanguageName(code: string): string {
  return englishLanguageName(code);
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

/**
 * Whether typed text sent alone under manual turns belongs in activity marks
 * (the owner's text probe, 2026-09-30): 2.5 and below, and an id with no
 * version, answer typed text only when it sits inside `activityStart` /
 * `activityEnd` — a bare send waits for the next activity to close it. A
 * 3.x model is the opposite: it closes the socket with 1007 "Precondition
 * check failed." on marks around text with no audio, and answers a bare
 * send at once, on its own.
 */
export function geminiTextInMarks(model: string): boolean {
  return familyOf(model) < 3000;
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
