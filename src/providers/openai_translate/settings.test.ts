import { describe, it, expect } from 'vitest';
import { readCredentials } from '../../lib/provider/credentials';
import { AUTO, normalizePair, reverseSupported, swapped } from '../../lib/provider/languages';
import {
  isTranslateModelId, migrateTranslateSettings, NOISE_REDUCTIONS, TRANSCRIPT_MODEL, TRANSLATE_DEFAULTS, TRANSLATE_MODEL, TRANSLATE_SOURCES,
  TRANSLATE_TARGETS, translateCredentials, translateLanguages,
} from './settings';

const translate = { languages: translateLanguages };
const S = TRANSLATE_DEFAULTS;
const signedOut = { signedIn: false, getToken: async () => null };

describe("OpenAI Translate's settings", () => {
  it('keeps the noise reduction, defaulting to none, and no transport: every session runs over WebSocket (ruling 1)', () => {
    expect(TRANSLATE_DEFAULTS).toEqual({ noiseReduction: 'None' });
    expect(NOISE_REDUCTIONS).toEqual(['None', 'Near field', 'Far field']);
  });

  it('migrates what was stored field by field, and reads neither a stored WebRTC choice nor a transcript model (rulings 1, 8)', () => {
    expect(migrateTranslateSettings({ ...TRANSLATE_DEFAULTS })).toEqual(TRANSLATE_DEFAULTS);
    expect(migrateTranslateSettings({ noiseReduction: 'Far field', transportType: 'webrtc', transcriptModel: 'gpt-realtime-whisper' }))
      .toEqual({ noiseReduction: 'Far field' });
    expect(migrateTranslateSettings({ noiseReduction: 'near_field', transportType: 'sip' })).toEqual(TRANSLATE_DEFAULTS);
    expect(migrateTranslateSettings({})).toEqual(TRANSLATE_DEFAULTS);
  });

  it('runs one model and one transcript model, and knows the family the check requires (rulings 7, 8)', () => {
    expect(TRANSLATE_MODEL).toBe('gpt-realtime-translate');
    expect(TRANSCRIPT_MODEL).toBe('gpt-live-transcribe');
    for (const id of ['gpt-realtime-translate', 'gpt-realtime-translate-2026-05-01', 'GPT-Realtime-Translate']) expect(isTranslateModelId(id), id).toBe(true);
    for (const id of ['gpt-realtime', 'gpt-4o-realtime-preview', 'gpt-live-transcribe', 'x-gpt-realtime-translate']) expect(isTranslateModelId(id), id).toBe(false);
  });
});

describe("OpenAI Translate's languages", () => {
  it('hears the old descriptor\'s 74 languages, with no auto, and speaks thirteen (ruling 15)', () => {
    expect(TRANSLATE_SOURCES).toHaveLength(74);
    expect(new Set(TRANSLATE_SOURCES.map((o) => o.value)).size).toBe(74);
    expect(TRANSLATE_SOURCES.some((o) => o.value === AUTO)).toBe(false);
    expect(TRANSLATE_TARGETS.map((o) => o.value)).toEqual(['en', 'es', 'pt', 'fr', 'ja', 'ru', 'zh', 'de', 'ko', 'hi', 'id', 'vi', 'it']);
    // Every target is a source too, so the participant leg of any pair hears its target.
    for (const t of TRANSLATE_TARGETS) expect(TRANSLATE_SOURCES.map((o) => o.value), t.value).toContain(t.value);
    expect(TRANSLATE_SOURCES.find((o) => o.value === 'fil')).toEqual({ name: 'Filipino', value: 'fil', englishName: 'Filipino' });
  });

  it('offers the thirteen for every source, the source itself included, speaking or not (ruling 15)', () => {
    for (const source of ['en', 'ja', 'th', 'fil']) {
      for (const context of [undefined, { speech: true }, { speech: false }]) {
        expect(translateLanguages.targets(source, S, context)).toBe(TRANSLATE_TARGETS);
      }
    }
    expect(translateLanguages.sources(S, { speech: false })).toBe(TRANSLATE_SOURCES);
    expect(normalizePair(translate, S, { source: 'en', target: 'en' })).toEqual({ source: 'en', target: 'en' });
  });

  it('starts from English into Chinese', () => {
    expect(translateLanguages.initial!(S)).toEqual({ source: 'en', target: 'zh' });
    expect(normalizePair(translate, S, translateLanguages.initial!(S))).toEqual({ source: 'en', target: 'zh' });
  });

  it('reverses a pair whose source it speaks, and no other: the participant leg of a source-only language is refused (D20)', () => {
    expect(reverseSupported(translate, S, { source: 'ja', target: 'en' })).toBe(true);
    expect(swapped(translate, S, { source: 'ja', target: 'en' })).toEqual({ source: 'en', target: 'ja' });
    expect(reverseSupported(translate, S, { source: 'th', target: 'en' })).toBe(false);
    expect(swapped(translate, S, { source: 'th', target: 'en' })).toBeNull();
  });
});

describe("OpenAI Translate's credentials", () => {
  it('asks for one API key, the OpenAI key the old slice stored', () => {
    expect(translateCredentials.keys).toEqual(['apiKey']);
    expect(translateCredentials.fields(S)).toEqual([{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }]);
  });

  it('reads the key trimmed — a pasted newline is no valid subprotocol token (choice 14) — and an empty one as missing', () => {
    expect(readCredentials({ credentials: translateCredentials }, S, { apiKey: '  sk-proj-abc123\n' }, signedOut)).toEqual({ apiKey: 'sk-proj-abc123' });
    expect(readCredentials({ credentials: translateCredentials }, S, { apiKey: ' \n' }, signedOut)).toEqual({ missing: 'Enter your OpenAI API key.' });
    expect(readCredentials({ credentials: translateCredentials }, S, {}, signedOut)).toEqual({ missing: 'Enter your OpenAI API key.' });
  });
});
