import { describe, it, expect } from 'vitest';
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS } from '../../lib/provider/instructions';
import { AUTO, reverseSupported } from '../../lib/provider/languages';
import type { AuthContext } from '../../lib/provider/types';
import {
  compareGeminiModels, defaultGeminiModel, effectiveGeminiModel, GEMINI_DEFAULTS, GEMINI_LANGUAGES, GEMINI_LEGACY_KEYS, GEMINI_VOICES,
  geminiCredentials, geminiLanguageName, geminiLanguages, isGeminiLiveModel, isGeminiTranslateModel, migrateGeminiSettings,
  sortGeminiModels, toTranslationLanguageCode,
} from './settings';

const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
const migrate = (stored: Record<string, unknown>, legacy: Record<string, unknown> = {}) => migrateGeminiSettings(stored, { legacy, credentials: { apiKey: '' } });
const ids = (list: readonly string[]) => list.map((id) => ({ id }));

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

  it("offer the old 34 regional values as sources and as every source's targets, never auto, and start en-US → ja-JP", () => {
    expect(GEMINI_LANGUAGES).toHaveLength(34);
    expect(geminiLanguages.sources(GEMINI_DEFAULTS)).toBe(GEMINI_LANGUAGES);
    expect(geminiLanguages.targets('ja-JP', GEMINI_DEFAULTS)).toBe(GEMINI_LANGUAGES);
    expect(GEMINI_LANGUAGES.map((o) => o.value)).not.toContain(AUTO);
    expect(GEMINI_LANGUAGES.map((o) => o.value)).toEqual(expect.arrayContaining(['en-US', 'ja-JP', 'cmn-CN', 'ar-XA', 'uk-UA']));
    expect(geminiLanguages.initial?.(GEMINI_DEFAULTS)).toEqual({ source: 'en-US', target: 'ja-JP' });
    expect(reverseSupported({ languages: geminiLanguages }, GEMINI_DEFAULTS, { source: 'en-US', target: 'ja-JP' })).toBe(true);
  });

  it("name a code in English for the instructions' template, and fall back to the code", () => {
    expect(geminiLanguageName('ja-JP')).toBe('Japanese (Japan)');
    expect(geminiLanguageName('cmn-CN')).toBe('Mandarin Chinese (China)');
    expect(geminiLanguageName('xx-YY')).toBe('xx-YY');
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

  it("reduce a target to Live Translate's short code, Mandarin to zh (`geminiTranslateModel.test.ts:47-70`)", () => {
    expect(toTranslationLanguageCode('ja-JP')).toBe('ja');
    expect(toTranslationLanguageCode('en-US')).toBe('en');
    expect(toTranslationLanguageCode('pt-BR')).toBe('pt');
    expect(toTranslationLanguageCode('ar-XA')).toBe('ar');
    expect(toTranslationLanguageCode('cmn-CN')).toBe('zh');
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

  it('default a fresh profile to the newest native-audio dialogue model, whatever order the list came in (ruling 2)', () => {
    const live = LISTED.filter(isGeminiLiveModel);
    expect(defaultGeminiModel(ids(live))).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
    expect(defaultGeminiModel(ids([...live].reverse()))).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
    expect(effectiveGeminiModel(GEMINI_DEFAULTS, ids(live))).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
  });

  it('fall back to the newest dialogue model, then the newest model, then nothing', () => {
    expect(defaultGeminiModel(ids(['gemini-2.0-flash-live-001', 'gemini-3.1-flash-live-preview', 'gemini-3.5-live-translate-preview']))).toBe('gemini-3.1-flash-live-preview');
    expect(defaultGeminiModel(ids(['gemini-3.5-live-translate-preview']))).toBe('gemini-3.5-live-translate-preview');
    expect(defaultGeminiModel([])).toBe('');
  });

  it('keep a saved model the check listed, replace one it no longer lists, and keep it while nothing is listed', () => {
    const live = ids(LISTED.filter(isGeminiLiveModel));
    expect(effectiveGeminiModel({ model: 'gemini-3.5-live-translate-preview' }, live)).toBe('gemini-3.5-live-translate-preview');
    expect(effectiveGeminiModel({ model: 'gemini-1.0-retired' }, live)).toBe('gemini-2.5-flash-native-audio-preview-12-2025');
    expect(effectiveGeminiModel({ model: 'gemini-3.1-flash-live-preview' }, [])).toBe('gemini-3.1-flash-live-preview');
  });
});
