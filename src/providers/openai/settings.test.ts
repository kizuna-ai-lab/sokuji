import { describe, it, expect } from 'vitest';
import { INSTRUCTION_LEGACY_KEYS, INSTRUCTIONS_DEFAULTS } from '../../lib/provider/instructions';
import { AUTO, reverseSupported } from '../../lib/provider/languages';
import type { AuthContext } from '../../lib/provider/types';
import { parseCode } from '../../lib/language/code';
import { englishLanguageName } from '../../lib/language/label';
import {
  effectiveRealtimeModel, isRealtimeModelId, migrateRealtimeSettings, realtimeCredentials, realtimeLanguageName, realtimeLanguages,
  REALTIME_DEFAULTS, REALTIME_LANGUAGES, REALTIME_LEGACY_KEYS, REALTIME_VOICES, takesReasoning,
} from './settings';

const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
const migrate = (stored: Record<string, unknown>, legacy: Record<string, unknown> = {}) => migrateRealtimeSettings(stored, { legacy, credentials: { apiKey: '' } });
const ids = (...list: string[]) => list.map((id) => ({ id }));

describe("OpenAI Realtime's settings", () => {
  it('starts from the old defaults, less the temperature (ruling 6) and the transport (WebSocket only, ruling 12), plus the instructions it now owns', () => {
    expect(REALTIME_DEFAULTS).toEqual({
      ...INSTRUCTIONS_DEFAULTS,
      model: 'gpt-realtime-2.1-mini',
      voice: 'alloy',
      turnDetectionMode: 'Normal',
      threshold: 0.49,
      prefixPadding: 0.5,
      silenceDuration: 0.5,
      semanticEagerness: 'Auto',
      maxTokens: 'inf',
      transcriptModel: 'gpt-4o-mini-transcribe',
      transcriptKeywords: '',
      noiseReduction: 'None',
      reasoningEffort: 'low',
    });
    expect(REALTIME_DEFAULTS).not.toHaveProperty('temperature');
    expect(REALTIME_DEFAULTS).not.toHaveProperty('transportType');
    // The instructions' legacy keys, and nothing else (ruling 5).
    expect(REALTIME_LEGACY_KEYS).toEqual(INSTRUCTION_LEGACY_KEYS);
  });

  it('loads an old profile field by field, converting nothing: a stored temperature is not read, nor a stored WebRTC choice', () => {
    const s = migrate({
      model: 'gpt-realtime-2.1', voice: 'marin', turnDetectionMode: 'Semantic', threshold: 0.7, prefixPadding: 0.3, silenceDuration: 1.2,
      semanticEagerness: 'High', maxTokens: 2048, transcriptModel: 'gpt-live-transcribe', transcriptKeywords: 'Sokuji', noiseReduction: 'Far field',
      transportType: 'webrtc', reasoningEffort: 'medium', temperature: 1.1,
    });
    expect(s).toMatchObject({
      model: 'gpt-realtime-2.1', voice: 'marin', turnDetectionMode: 'Semantic', threshold: 0.7, prefixPadding: 0.3, silenceDuration: 1.2,
      semanticEagerness: 'High', maxTokens: 2048, transcriptModel: 'gpt-live-transcribe', transcriptKeywords: 'Sokuji', noiseReduction: 'Far field',
      reasoningEffort: 'medium',
    });
    expect(s).not.toHaveProperty('temperature');
    expect(s).not.toHaveProperty('transportType');
  });

  it("reads a stored push mode as no mechanism: 'Disabled' and 'Push-to-Translate' fall to 'Normal' (ruling 5; choice 4)", () => {
    expect(migrate({ turnDetectionMode: 'Disabled' }).turnDetectionMode).toBe('Normal');
    expect(migrate({ turnDetectionMode: 'Push-to-Translate' }).turnDetectionMode).toBe('Normal');
    expect(migrate({ turnDetectionMode: 'Normal' }).turnDetectionMode).toBe('Normal');
  });

  it('leaves a model OpenAI deprecated saved as it was: the effective model moves off it to the default model once the check stops listing it (ruling 5; choice 4)', () => {
    expect(migrate({ model: 'gpt-realtime-mini' }).model).toBe('gpt-realtime-mini');
    expect(effectiveRealtimeModel({ model: 'gpt-realtime-mini' }, ids('gpt-realtime-2.1', 'gpt-realtime-2.1-mini'))).toBe('gpt-realtime-2.1-mini');
  });

  it('falls each malformed field to its default, and reads an Electron max-tokens string as its number (Stage 2 Gemini, ruling 10)', () => {
    const s = migrate({
      model: 5, voice: null, turnDetectionMode: 'Loud', threshold: 'high', prefixPadding: Number.NaN, silenceDuration: undefined, semanticEagerness: 'Eager',
      maxTokens: '2048', transcriptModel: 'gpt-5-transcribe', transcriptKeywords: ['a'], noiseReduction: 'Loud', transportType: 'sip', reasoningEffort: 'max',
    });
    expect(s).toEqual({ ...REALTIME_DEFAULTS, maxTokens: 2048 });
    expect(migrate({ maxTokens: 'lots' }).maxTokens).toBe('inf');
    expect(migrate({ maxTokens: 'inf' }).maxTokens).toBe('inf');
  });

  it('reads the instructions from the old global copy until its own is written (Stage 2 Gemini, ruling 4)', () => {
    const s = migrate({}, { 'settings.common.useTemplateMode': false, 'settings.common.systemInstructions': 'Translate plainly.' });
    expect(s).toMatchObject({ useTemplateMode: false, systemInstructions: 'Translate plainly.' });
  });

  it('offers Auto-detect and the old 55 as sources, the 55 as every source\'s targets, en → zh-CN first (ruling 7)', () => {
    const sources = realtimeLanguages.sources(REALTIME_DEFAULTS);
    expect(sources).toHaveLength(56);
    expect(sources[0].value).toBe(AUTO);
    expect(sources.slice(1)).toEqual(REALTIME_LANGUAGES);
    expect(realtimeLanguages.targets(AUTO, REALTIME_DEFAULTS)).toEqual(REALTIME_LANGUAGES);
    expect(realtimeLanguages.targets('en', REALTIME_DEFAULTS).map((o) => o.value)).toContain('en');
    expect(realtimeLanguages.initial?.(REALTIME_DEFAULTS)).toEqual({ source: 'en', target: 'zh-CN' });
    // D20: an Auto-detect source never reverses, so Both is refused for it; a named one does.
    expect(reverseSupported({ languages: realtimeLanguages }, REALTIME_DEFAULTS, { source: AUTO, target: 'en' })).toBe(false);
    expect(reverseSupported({ languages: realtimeLanguages }, REALTIME_DEFAULTS, { source: 'ja', target: 'en' })).toBe(true);
  });

  it('names a language in English for the template, Auto-detect as "the spoken language" (ruling 7)', () => {
    expect(realtimeLanguageName('zh-CN')).toBe(englishLanguageName('zh-CN'));
    expect(realtimeLanguageName(AUTO)).toBe('the spoken language');
    expect(realtimeLanguageName('xx')).toBe('xx');
  });

  it('offers the ten old voices', () => {
    expect(REALTIME_VOICES.map((v) => v.value)).toEqual(['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'marin', 'sage', 'shimmer', 'verse']);
  });

  it('reads one key, trimmed, and an empty one as missing (choice 19)', () => {
    expect(realtimeCredentials.fields(REALTIME_DEFAULTS)).toEqual([{ key: 'apiKey', labelKey: 'setup.credentials.apiKey', secret: true, placeholderKey: 'simpleSettings.apiKeyPlaceholder' }]);
    expect(realtimeCredentials.read({ apiKey: ' sk-proj-abc\n' }, signedOut)).toEqual({ apiKey: 'sk-proj-abc' });
    expect(realtimeCredentials.read({ apiKey: '  ' }, signedOut)).toEqual({ missing: 'Enter your OpenAI API key.' });
  });

  it('knows a voice-agent model, less the transcription and translation families (`OpenAIClient.ts:250-259`)', () => {
    for (const id of ['gpt-realtime', 'gpt-realtime-mini', 'gpt-realtime-2.1', 'gpt-realtime-2.1-mini', 'GPT-Realtime-2.1']) expect(isRealtimeModelId(id), id).toBe(true);
    for (const id of ['gpt-realtime-whisper', 'gpt-realtime-translate', 'gpt-realtime-translate-2026-09-01', 'gpt-4o-realtime-preview', 'gpt-audio-1.5', 'whisper-1']) {
      expect(isRealtimeModelId(id), id).toBe(false);
    }
  });

  it('runs the saved model when the check listed it, else the default model when listed, else the newest listed, else the saved one while nothing is listed', () => {
    const listed = ids('gpt-realtime-2.1', 'gpt-realtime-2.1-mini');
    expect(effectiveRealtimeModel({ model: 'gpt-realtime-2.1' }, listed)).toBe('gpt-realtime-2.1');
    expect(effectiveRealtimeModel({ model: 'gpt-realtime-9' }, listed)).toBe('gpt-realtime-2.1-mini');
    expect(effectiveRealtimeModel({ model: 'gpt-realtime-9' }, ids('gpt-realtime-2.1', 'gpt-realtime-mini'))).toBe('gpt-realtime-2.1');
    expect(effectiveRealtimeModel({ model: 'gpt-realtime-2.1-mini' }, [])).toBe('gpt-realtime-2.1-mini');
  });

  it('sends reasoning to a gpt-realtime-2* model only', () => {
    expect(takesReasoning('gpt-realtime-2.1-mini')).toBe(true);
    expect(takesReasoning('gpt-realtime-2')).toBe(true);
    expect(takesReasoning('gpt-realtime-2.1')).toBe(true);
    expect(takesReasoning('gpt-realtime-mini')).toBe(false);
    expect(takesReasoning('gpt-realtime-1.5')).toBe(false);
    expect(takesReasoning('gpt-realtime')).toBe(false);
    // A dated 1.0 snapshot: the four-digit year is not a 2.x minor version.
    expect(takesReasoning('gpt-realtime-2025-08-28')).toBe(false);
  });
});

describe('unified language codes', () => {
  it('offers app codes only, Chinese and English variants by region (unified language codes)', () => {
    const values = REALTIME_LANGUAGES.map((o) => o.value);
    for (const v of values) expect(parseCode(v), v).not.toBeNull();
    expect(values).toEqual(expect.arrayContaining(['zh-CN', 'zh-TW', 'en-US', 'en-GB', 'en-AU', 'es-419', 'pt-BR', 'pt-PT']));
    expect(realtimeLanguages.initial?.(REALTIME_DEFAULTS)).toEqual({ source: 'en', target: 'zh-CN' });
    expect(realtimeLanguages.wire?.toWire('zh-TW')).toBe('zh-TW');
  });

  it("names a code in English for the instructions, auto as 'the spoken language'", () => {
    expect(realtimeLanguageName('zh-TW')).toBe(englishLanguageName('zh-TW'));
    expect(realtimeLanguageName(AUTO)).toBe('the spoken language');
  });
});
