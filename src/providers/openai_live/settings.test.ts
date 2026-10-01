import { describe, it, expect } from 'vitest';
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS } from '../../lib/provider/instructions';
import { AUTO, reverseSupported } from '../../lib/provider/languages';
import type { AuthContext } from '../../lib/provider/types';
import { parseCode } from '../../lib/language/code';
import { englishLanguageName } from '../../lib/language/label';
import {
  isLiveModelId, LIVE_DEFAULTS, LIVE_LANGUAGES, LIVE_LEGACY_KEYS, LIVE_VOICES, liveCredentials, liveLanguageName, liveLanguages, migrateLiveSettings,
} from './settings';

const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
const migrate = (stored: Record<string, unknown>, legacy: Record<string, unknown> = {}) => migrateLiveSettings(stored, { legacy, credentials: { apiKey: '' } });

describe("OpenAI Live's settings", () => {
  it("starts from the old voice, marin, and the instructions it now owns; reads the instructions' legacy keys and nothing else", () => {
    expect(LIVE_DEFAULTS).toEqual({ ...INSTRUCTIONS_DEFAULTS, voice: 'marin' });
    expect(LIVE_LEGACY_KEYS).toEqual(INSTRUCTION_LEGACY_KEYS);
  });

  it("loads an old profile field by field, converting nothing: a voice outside the 22 falls to marin, and the old slice's key, pair and pauses are not read into S", () => {
    const s = migrate({ apiKey: 'sk-x', sourceLanguage: 'ja', targetLanguage: 'en', voice: 'cedar', userSilenceDuration: 800, assistantSilenceDuration: 1200 });
    expect(s).toEqual({ ...INSTRUCTIONS_DEFAULTS, voice: 'cedar' });
    expect(migrate({ voice: 'nova' }).voice).toBe('marin');
    expect(migrate({ voice: 7 }).voice).toBe('marin');
  });

  it("reads the global instructions until its own are written, as every provider that owns them does", () => {
    const s = migrate({}, { 'settings.common.useTemplateMode': false, 'settings.common.systemInstructions': 'Interpret faithfully.' });
    expect(s).toMatchObject({ useTemplateMode: false, systemInstructions: 'Interpret faithfully.' });
  });

  it('offers the 22 voices — the ten Realtime ones, then the twelve Live added — in the old order', () => {
    expect(LIVE_VOICES.map((v) => v.value)).toEqual([
      'alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'marin', 'sage', 'shimmer', 'verse',
      'quartz', 'ripple', 'vesper', 'willow', 'stone', 'gleam', 'meridian', 'bossa', 'tempo', 'beacon', 'delta', 'cinder',
    ]);
  });
});

describe("OpenAI Live's languages (D20)", () => {
  it('hears Auto-detect and the 55, speaks the 55, and starts from English into Chinese (China)', () => {
    expect(LIVE_LANGUAGES).toHaveLength(55);
    expect(liveLanguages.sources(LIVE_DEFAULTS)[0].value).toBe(AUTO);
    expect(liveLanguages.sources(LIVE_DEFAULTS).slice(1)).toEqual(LIVE_LANGUAGES);
    expect(liveLanguages.targets('ja', LIVE_DEFAULTS)).toEqual(LIVE_LANGUAGES);
    expect(liveLanguages.initial?.(LIVE_DEFAULTS)).toEqual({ source: 'en', target: 'zh-CN' });
  });

  it('refuses Both for an Auto-detect source, as D20 does for every provider — no provider rule is left to write', () => {
    const p = { languages: liveLanguages };
    expect(reverseSupported(p, LIVE_DEFAULTS, { source: AUTO, target: 'en' })).toBe(false);
    expect(reverseSupported(p, LIVE_DEFAULTS, { source: 'en', target: 'zh-CN' })).toBe(true);
  });

  it('names a language in English for the template; Auto-detect is "the spoken language", where the old client wrote "auto"', () => {
    expect(liveLanguageName('zh-CN')).toBe(englishLanguageName('zh-CN'));
    expect(liveLanguageName(AUTO)).toBe('the spoken language');
    expect(liveLanguageName('xx')).toBe('xx');
  });
});

describe("OpenAI Live's credentials and model family", () => {
  it("reads its own key, trimmed — not OpenAI Realtime's or Translate's, and no prefill (ruling 9)", () => {
    expect(liveCredentials.keys).toEqual(['apiKey']);
    expect(liveCredentials.fields(LIVE_DEFAULTS)).toEqual([{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }]);
    expect(liveCredentials.read({ apiKey: '  sk-live \n' }, signedOut)).toEqual({ apiKey: 'sk-live' });
    expect(liveCredentials.read({ apiKey: ' ' }, signedOut)).toEqual({ missing: 'Enter your OpenAI API key.' });
  });

  it('takes gpt-live-1 and any dated gpt-live snapshot, never the transcription model', () => {
    expect(['gpt-live-1', 'GPT-LIVE-1', 'gpt-live-2026-10-01'].every(isLiveModelId)).toBe(true);
    expect(['gpt-live-transcribe', 'gpt-live-transcribe-2026', 'gpt-realtime', 'gpt-live'].some(isLiveModelId)).toBe(false);
  });
});

describe('unified language codes', () => {
  it('offers app codes only, Chinese and English variants by region (unified language codes)', () => {
    const values = LIVE_LANGUAGES.map((o) => o.value);
    for (const v of values) expect(parseCode(v), v).not.toBeNull();
    expect(values).toEqual(expect.arrayContaining(['zh-CN', 'zh-TW', 'en-US', 'en-GB', 'en-AU', 'es-419', 'pt-BR', 'pt-PT']));
    expect(liveLanguages.initial?.(LIVE_DEFAULTS)).toEqual({ source: 'en', target: 'zh-CN' });
    expect(liveLanguages.wire?.toWire('zh-TW')).toBe('zh-TW');
  });

  it("names a code in English for the instructions, auto as 'the spoken language'", () => {
    expect(liveLanguageName('zh-TW')).toBe(englishLanguageName('zh-TW'));
    expect(liveLanguageName(AUTO)).toBe('the spoken language');
  });
});
