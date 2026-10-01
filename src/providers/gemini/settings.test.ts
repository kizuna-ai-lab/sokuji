import { describe, it, expect } from 'vitest';
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS } from '../../lib/provider/instructions';
import { AUTO, reverseSupported } from '../../lib/provider/languages';
import { englishLanguageName } from '../../lib/language';
import type { AuthContext } from '../../lib/provider/types';
import {
  compareGeminiModels, defaultGeminiModel, effectiveGeminiModel, geminiActivityHandling, GEMINI_DEFAULTS, GEMINI_DIALOGUE_LANGUAGES, GEMINI_LEGACY_KEYS,
  GEMINI_TRANSLATE_SOURCES, GEMINI_TRANSLATE_TARGETS, GEMINI_VOICES, geminiCredentials, geminiLanguageName, geminiLanguages, isGeminiLiveModel,
  isGeminiTranslateModel, migrateGeminiSettings, sortGeminiModels,
} from './settings';

const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
const migrate = (stored: Record<string, unknown>, legacy: Record<string, unknown> = {}) => migrateGeminiSettings(stored, { legacy, credentials: { apiKey: '' } });
const ids = (list: readonly string[]) => list.map((id) => ({ id }));
const values = (options: readonly { value: string }[]) => options.map((o) => o.value);
const sorted = (codes: readonly string[]) => [...codes].sort();

/** The Live API capabilities guide's 99 languages, as Google documented them on 2026-09-29 (Norwegian's row names `no, nb`; `no` is offered). */
const DOCUMENTED_LIVE = [
  'af', 'ak', 'sq', 'am', 'ar', 'hy', 'as', 'az', 'eu', 'be', 'bn', 'bs', 'bg', 'my', 'ca', 'ceb', 'zh-Hans', 'zh-Hant', 'hr', 'cs', 'da', 'nl',
  'en', 'et', 'fo', 'fil', 'fi', 'fr', 'gl', 'ka', 'de', 'el', 'gu', 'ha', 'he', 'hi', 'hu', 'is', 'id', 'ga', 'it', 'ja', 'kn', 'kk', 'km', 'rw',
  'ko', 'ku', 'ky', 'lo', 'lv', 'lt', 'mk', 'ms', 'ml', 'mt', 'mi', 'mr', 'mn', 'ne', 'no', 'or', 'om', 'ps', 'fa', 'pl', 'pt-BR', 'pt-PT', 'pa',
  'qu', 'ro', 'rm', 'ru', 'sr', 'sd', 'si', 'sk', 'sl', 'so', 'st', 'es', 'sw', 'sv', 'tg', 'ta', 'te', 'th', 'tn', 'tr', 'tk', 'uk', 'ur', 'uz',
  'vi', 'cy', 'fy', 'wo', 'yo', 'zu',
];
/** Live Translate's 78 `targetLanguageCode` values, as documented on 2026-09-29. */
const DOCUMENTED_TRANSLATE = [
  'af', 'ak', 'sq', 'am', 'ar', 'hy', 'az', 'eu', 'be', 'bn', 'bg', 'my', 'ca', 'zh-Hans', 'zh-Hant', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fil',
  'fi', 'fr', 'gl', 'ka', 'de', 'el', 'gu', 'ha', 'he', 'hi', 'hu', 'is', 'id', 'it', 'ja', 'jv', 'kn', 'kk', 'km', 'rw', 'ko', 'lo', 'lv', 'lt',
  'mk', 'ms', 'ml', 'mr', 'mn', 'ne', 'no', 'fa', 'pl', 'pt-BR', 'pt-PT', 'pa', 'ro', 'ru', 'sr', 'sd', 'si', 'sk', 'sl', 'es', 'su', 'sw', 'sv',
  'ta', 'te', 'th', 'tr', 'uk', 'ur', 'uz', 'vi', 'zu',
];
const DIALOGUE_MODEL = { ...GEMINI_DEFAULTS, model: 'gemini-2.5-flash-native-audio-preview-12-2025' };
const TRANSLATE_MODEL = { ...GEMINI_DEFAULTS, model: 'gemini-3.5-live-translate-preview' };

/** A realistic Developer API listing (2026-09): the Live ids the repo's tests and benchmark docs name, the dated native-audio previews, and the ids the Live filter drops. */
const LISTED = [
  'gemini-2.0-flash-live-001',
  'gemini-2.5-flash',
  'gemini-2.5-flash-exp-native-audio-thinking-dialog',
  'gemini-2.5-flash-live-preview',
  'gemini-2.5-flash-native-audio-latest',
  'gemini-2.5-flash-native-audio-preview-09-2025',
  'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-2.5-flash-preview-native-audio-dialog',
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro',
  'gemini-3.1-flash-live-preview',
  'gemini-3.5-live-translate-preview',
  'gemini-3.5-transcribe-live',
  'gemini-live-2.5-flash-preview',
  'lyria-realtime-exp',
  'text-embedding-004',
];
/** The Live ones, newest first by the rule (ruling 2). */
const LIVE_NEWEST_FIRST = [
  'gemini-3.5-live-translate-preview',
  'gemini-3.1-flash-live-preview',
  'gemini-2.5-flash-native-audio-preview-12-2025',
  'gemini-2.5-flash-native-audio-preview-09-2025',
  'gemini-2.5-flash-exp-native-audio-thinking-dialog',
  'gemini-2.5-flash-live-preview',
  'gemini-2.5-flash-native-audio-latest',
  'gemini-2.5-flash-preview-native-audio-dialog',
  'gemini-live-2.5-flash-preview',
  'gemini-2.0-flash-live-001',
];

describe("Gemini's settings", () => {
  it("default to the old slice's values and the old app's instructions", () => {
    expect(GEMINI_DEFAULTS).toEqual({
      ...INSTRUCTIONS_DEFAULTS,
      model: '', voice: 'Aoede', temperature: 0.8, maxTokens: 'inf',
      vadStartSensitivity: 'low', vadEndSensitivity: 'high', vadSilenceDurationMs: 500, vadPrefixPaddingMs: 300,
    });
  });

  it('migrate the defaults, stored as they are, into the defaults, and drop what left the slice', () => {
    expect(migrate({ ...GEMINI_DEFAULTS })).toEqual(GEMINI_DEFAULTS);
    const out = migrate({ ...GEMINI_DEFAULTS, apiKey: 'k', sourceLanguage: 'en-US', turnDetectionMode: 'Push-to-Talk' });
    for (const gone of ['apiKey', 'sourceLanguage', 'turnDetectionMode']) expect(out, gone).not.toHaveProperty(gone);
  });

  it("read the old Electron app's max tokens — stored as the string '2048' — as the number (ruling 10)", () => {
    expect(migrate({ ...GEMINI_DEFAULTS, maxTokens: '2048' }).maxTokens).toBe(2048);
    expect(migrate({ ...GEMINI_DEFAULTS, maxTokens: 2048 }).maxTokens).toBe(2048);
    expect(migrate({ ...GEMINI_DEFAULTS, maxTokens: 'inf' }).maxTokens).toBe('inf');
    expect(migrate({ ...GEMINI_DEFAULTS, maxTokens: 'lots' }).maxTokens).toBe('inf');
  });

  it('read a wrong-typed field as its default', () => {
    const out = migrate({ ...GEMINI_DEFAULTS, temperature: 'hot', vadStartSensitivity: 'medium', vadSilenceDurationMs: Number.NaN, model: 7, voice: null });
    expect(out).toMatchObject({ temperature: 0.8, vadStartSensitivity: 'low', vadSilenceDurationMs: 500, model: '', voice: 'Aoede' });
  });

  it("start the instructions from the old app's global copy (ruling 4)", () => {
    expect(GEMINI_LEGACY_KEYS).toEqual(INSTRUCTION_LEGACY_KEYS);
    const out = migrate({ ...GEMINI_DEFAULTS }, { 'settings.common.useTemplateMode': false, 'settings.common.systemInstructions': 'mine' });
    expect(out).toMatchObject({ useTemplateMode: false, systemInstructions: 'mine', participantSystemInstructions: '' });
  });
});

describe("Gemini's credentials and languages", () => {
  it('show one secret key field, and read an empty one as missing, worded by the runner', () => {
    expect(geminiCredentials.keys).toEqual(['apiKey']);
    expect(geminiCredentials.fields(GEMINI_DEFAULTS)).toEqual([{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }]);
    expect(geminiCredentials.read({ apiKey: '' }, signedOut)).toEqual({ missing: 'Enter your Gemini API key.' });
    expect(geminiCredentials.read({ apiKey: 'k' }, signedOut)).toEqual({ apiKey: 'k' });
  });

  it("hold Google's documented codes exactly: the Live API's 99 for a dialogue model, Live Translate's 78 as its targets, their union as its sources (Gemini/AST2 follow-up, ruling 6)", () => {
    expect(sorted(values(GEMINI_DIALOGUE_LANGUAGES))).toEqual(sorted(DOCUMENTED_LIVE));
    expect(sorted(values(GEMINI_TRANSLATE_TARGETS))).toEqual(sorted(DOCUMENTED_TRANSLATE));
    expect(sorted(values(GEMINI_TRANSLATE_SOURCES))).toEqual(sorted([...new Set([...DOCUMENTED_LIVE, ...DOCUMENTED_TRANSLATE])]));
    expect([GEMINI_DIALOGUE_LANGUAGES.length, GEMINI_TRANSLATE_TARGETS.length, GEMINI_TRANSLATE_SOURCES.length]).toEqual([99, 78, 101]);
    // Live Translate translates into two languages the Live API's table lacks.
    expect(DOCUMENTED_TRANSLATE.filter((code) => !DOCUMENTED_LIVE.includes(code))).toEqual(['jv', 'su']);
    for (const list of [GEMINI_DIALOGUE_LANGUAGES, GEMINI_TRANSLATE_TARGETS, GEMINI_TRANSLATE_SOURCES]) {
      expect(values(list)).not.toContain(AUTO);
      expect(new Set(values(list)).size).toBe(list.length);
      // English first (Gemini/AST2 follow-up, choice 14); a row carries no name — CLDR names it.
      expect(list[0].value).toBe('en');
      for (const o of list) expect(o).toEqual({ value: o.value });
    }
    // No region variant but the two Google documents; none of the old codes.
    expect(values(GEMINI_TRANSLATE_SOURCES).filter((code) => code.includes('-'))).toEqual(['zh-Hans', 'zh-Hant', 'pt-BR', 'pt-PT']);
    for (const old of ['en-US', 'ja-JP', 'cmn-CN', 'ar-XA', 'nl-BE']) expect(values(GEMINI_TRANSLATE_SOURCES)).not.toContain(old);
  });

  it("offer by the saved model's family: a dialogue model the 99 both ways; Live Translate — and no model chosen, its default — its sources and its 78 targets (Gemini/AST2 follow-up, choice 16)", () => {
    expect(geminiLanguages.sources(DIALOGUE_MODEL)).toBe(GEMINI_DIALOGUE_LANGUAGES);
    expect(geminiLanguages.targets('en', DIALOGUE_MODEL)).toBe(GEMINI_DIALOGUE_LANGUAGES);
    for (const s of [TRANSLATE_MODEL, GEMINI_DEFAULTS]) {
      expect(geminiLanguages.sources(s)).toBe(GEMINI_TRANSLATE_SOURCES);
      expect(geminiLanguages.targets('en', s)).toBe(GEMINI_TRANSLATE_TARGETS);
    }
    expect(geminiLanguages.initial?.(GEMINI_DEFAULTS)).toEqual({ source: 'en', target: 'ja' });
    const reverses = (s: typeof GEMINI_DEFAULTS, source: string, target: string) => reverseSupported({ languages: geminiLanguages }, s, { source, target });
    expect(reverses(DIALOGUE_MODEL, 'en', 'ja')).toBe(true);
    expect(reverses(TRANSLATE_MODEL, 'en', 'ja')).toBe(true);
    // Live Translate: a source outside its 78 cannot be the participant's target, so Both is refused (D20).
    expect(reverses(TRANSLATE_MODEL, 'as', 'en')).toBe(false);
    expect(reverses(DIALOGUE_MODEL, 'as', 'en')).toBe(true);
    // Javanese, Live Translate's own: a source and a target of it, none of a dialogue model.
    expect(reverses(TRANSLATE_MODEL, 'en', 'jv')).toBe(true);
    expect(values(GEMINI_DIALOGUE_LANGUAGES)).not.toContain('jv');
  });

  it('names a code for the instructions by its CLDR English name, and sends Google its own code', () => {
    expect(geminiLanguageName('zh-Hant')).toBe(englishLanguageName('zh-Hant'));
    expect(geminiLanguages.wire.toWire('zh-Hant')).toBe('zh-Hant');
  });

  it('offer the old 30 prebuilt voices, Aoede first', () => {
    expect(GEMINI_VOICES).toHaveLength(30);
    expect(GEMINI_VOICES[0]).toEqual({ value: 'Aoede', name: 'Aoede' });
    expect(new Set(GEMINI_VOICES.map((v) => v.value)).size).toBe(30);
  });
});

describe("Gemini's models", () => {
  it('tell Live Translate by its marker, narrowly (the old cases, `geminiTranslateModel.test.ts:26-45`)', () => {
    expect(isGeminiTranslateModel('gemini-3.5-live-translate-preview')).toBe(true);
    expect(isGeminiTranslateModel('gemini-3.1-flash-live-preview')).toBe(false);
    expect(isGeminiTranslateModel('gemini-2.5-flash-native-audio-latest')).toBe(false);
    expect(isGeminiTranslateModel('gemini-translate-text-preview')).toBe(false);
    expect(isGeminiTranslateModel('')).toBe(false);
  });

  it('keep the Live models by the old rule: audio or live in the id, never transcribe (`GeminiClient.test.ts:963-993`)', () => {
    expect(LISTED.filter(isGeminiLiveModel).sort()).toEqual([...LIVE_NEWEST_FIRST].sort());
    expect(isGeminiLiveModel('gemini-3.5-transcribe-live')).toBe(false);
    expect(isGeminiLiveModel('GEMINI-2.5-FLASH-NATIVE-AUDIO-LATEST')).toBe(true);
  });

  it('sort newest first: the higher family, then the later -MM-YYYY, a dated id before an undated one, then the id (ruling 2)', () => {
    expect(sortGeminiModels(LISTED.filter(isGeminiLiveModel))).toEqual(LIVE_NEWEST_FIRST);
    expect(compareGeminiModels('gemini-2.5-flash-native-audio-preview-12-2025', 'gemini-2.5-flash-native-audio-latest')).toBeLessThan(0);
    expect(compareGeminiModels('gemini-3.5-flash-native-audio', 'gemini-2.5-flash-native-audio-preview-12-2025')).toBeLessThan(0);
  });

  it('read a family with no minor as its major.0, not as an undated id (Fix round 1)', () => {
    // Google spells some Gemini 3 ids without a minor, e.g. `gemini-3-pro-preview`.
    const majorOnly = 'gemini-3-flash-native-audio-preview-01-2026';
    for (const id of LIVE_NEWEST_FIRST.filter((existing) => !existing.startsWith('gemini-3'))) {
      expect(compareGeminiModels(majorOnly, id)).toBeLessThan(0);
    }
    expect(defaultGeminiModel(ids([majorOnly, 'gemini-2.5-flash-native-audio-preview-12-2025']))).toBe(majorOnly);
    expect(sortGeminiModels(LIVE_NEWEST_FIRST)).toEqual(LIVE_NEWEST_FIRST);
  });

  it('default a fresh profile to Live Translate when the key lists it, whatever order the list came in (Gemini/AST2 follow-up, ruling 3)', () => {
    const live = LISTED.filter(isGeminiLiveModel);
    expect(defaultGeminiModel(ids(live))).toBe('gemini-3.5-live-translate-preview');
    expect(defaultGeminiModel(ids([...live].reverse()))).toBe('gemini-3.5-live-translate-preview');
    expect(effectiveGeminiModel(GEMINI_DEFAULTS, ids(live))).toBe('gemini-3.5-live-translate-preview');
    // Two listed: the newest.
    expect(defaultGeminiModel(ids(['gemini-3.5-live-translate-preview', 'gemini-4.0-live-translate-preview']))).toBe('gemini-4.0-live-translate-preview');
  });

  it('with no Live Translate listed, default by the old rule: the newest native-audio dialogue model, then the newest model, then nothing (ruling 2)', () => {
    const dialogue = LISTED.filter((id) => isGeminiLiveModel(id) && !isGeminiTranslateModel(id));
    expect(defaultGeminiModel(ids(dialogue))).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
    expect(defaultGeminiModel(ids(['gemini-2.0-flash-live-001', 'gemini-3.1-flash-live-preview']))).toBe('gemini-3.1-flash-live-preview');
    expect(defaultGeminiModel([])).toBe('');
  });

  it('barge in on a dialogue model of family 3.0 or later; keep NO_INTERRUPTION on 2.5 and below, an unversioned id and Live Translate (Gemini/AST2 follow-up, ruling 5)', () => {
    for (const id of ['gemini-3.8-live', 'gemini-3.8-live-extended-thinking', 'gemini-3.1-flash-live-preview', 'gemini-3-flash-native-audio-preview-01-2026', 'gemini-4.0-live']) {
      expect(geminiActivityHandling(id), id).toBe('START_OF_ACTIVITY_INTERRUPTS');
    }
    for (const id of [
      'gemini-2.5-flash-native-audio-preview-12-2025', 'gemini-2.5-flash-native-audio-latest', 'gemini-live-2.5-flash-preview', 'gemini-2.0-flash-live-001',
      'gemini-live-latest', 'gemini-3.5-live-translate-preview',
    ]) {
      expect(geminiActivityHandling(id), id).toBe('NO_INTERRUPTION');
    }
  });

  it('keep a saved model the check listed — a dialogue model too: nothing is migrated — replace one it no longer lists, and keep it while nothing is listed', () => {
    const live = ids(LISTED.filter(isGeminiLiveModel));
    expect(effectiveGeminiModel({ model: 'gemini-2.5-flash-native-audio-preview-12-2025' }, live)).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
    expect(effectiveGeminiModel({ model: 'gemini-1.0-retired' }, live)).toBe('gemini-3.5-live-translate-preview');
    expect(effectiveGeminiModel({ model: 'gemini-3.1-flash-live-preview' }, [])).toBe('gemini-3.1-flash-live-preview');
  });
});
