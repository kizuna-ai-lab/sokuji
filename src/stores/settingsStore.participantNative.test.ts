import { describe, it, expect, beforeEach } from 'vitest';
import { createParticipantLocalNativeConfig } from './settingsStore';
import { useNativeModelStore } from './nativeModelStore';
import type { LocalNativeSessionConfig } from '../services/interfaces/IClient';
import type { NativeModelInfo } from '../lib/local-inference/native/nativeProtocol';

/** Minimal catalog-entry factory (mirrors nativeCatalog.test.ts). */
const M = (id: string, kind: NativeModelInfo['kind'], languages: string[], order: number,
           recommended = false): NativeModelInfo =>
  ({ id, name: id, languages, recommended, tiers: [], order, repo: id, kind });

const CATALOG: Record<string, NativeModelInfo> = {
  // ASR
  'whisper-base': M('whisper-base', 'asr', ['multi'], 3),
  'sense-voice': M('sense-voice', 'asr', ['zh', 'en', 'ja', 'ko'], 1, true),
  // Translation
  'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true),
  'opus-mt-zh-en': M('opus-mt-zh-en', 'translate', ['zh', 'en'], 21),
  'opus-mt-en-zh': M('opus-mt-en-zh', 'translate', ['en', 'zh'], 22),
};

/** Build a speaker-direction native session config (the base the participant helper reverses). */
const baseConfig = (over: Partial<LocalNativeSessionConfig>): LocalNativeSessionConfig => ({
  provider: 'local_native',
  model: 'native-asr-translate',
  instructions: '',
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  asrModelId: 'whisper-base',
  translationModelId: 'qwen2.5-0.5b',
  ttsModelId: 'some-tts',
  ...over,
});

/** Seed the native model store with a catalog and a set of "ready" (downloaded) ids. */
const seed = (readyIds: string[]) => {
  useNativeModelStore.setState({
    catalog: CATALOG,
    statuses: Object.fromEntries(readyIds.map((id) => [id, 'ready' as const])),
    modelPreferences: {},
  });
};

describe('createParticipantLocalNativeConfig', () => {
  beforeEach(() => {
    seed([]);
  });

  it('reverses languages and reuses a multilingual model (no extra models loaded)', () => {
    seed(['whisper-base', 'qwen2.5-0.5b']);
    const result = createParticipantLocalNativeConfig(baseConfig({}));

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Direction reversed.
    expect(result.config.sourceLanguage).toBe('en');
    expect(result.config.targetLanguage).toBe('zh');
    // Multilingual models handle both directions → same ids reused.
    expect(result.config.asrModelId).toBe('whisper-base');
    expect(result.config.translationModelId).toBe('qwen2.5-0.5b');
    expect(result.translationAvailable).toBe(true);
    // Participant channel is text-only.
    expect(result.config.ttsModelId).toBeUndefined();
  });

  it('re-resolves a directional Opus model to the reverse-direction pair', () => {
    // Speaker uses zh→en Opus; only the reverse en→zh Opus is downloaded.
    seed(['whisper-base', 'opus-mt-en-zh']);
    const result = createParticipantLocalNativeConfig(
      baseConfig({ translationModelId: 'opus-mt-zh-en' }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    // Would have translated the WRONG direction if left as opus-mt-zh-en.
    expect(result.config.translationModelId).toBe('opus-mt-en-zh');
    expect(result.translationAvailable).toBe(true);
  });

  it('falls back to transcription-only when no reverse translation model is downloaded', () => {
    // Only ASR downloaded; neither the reverse Opus nor any multilingual model is ready.
    seed(['whisper-base']);
    const result = createParticipantLocalNativeConfig(
      baseConfig({ translationModelId: 'opus-mt-zh-en' }),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.config.asrModelId).toBe('whisper-base');
    expect(result.config.translationModelId).toBeUndefined();
    expect(result.translationAvailable).toBe(false);
  });

  it('fails with no_asr when no ASR model can serve the reversed source language', () => {
    // Speaker zh→de; reversed source is 'de'. sense-voice does not cover 'de' and no
    // multilingual ASR is downloaded, so the participant channel cannot be built.
    seed(['sense-voice']);
    const result = createParticipantLocalNativeConfig(
      baseConfig({ sourceLanguage: 'zh', targetLanguage: 'de', asrModelId: 'sense-voice', translationModelId: 'qwen2.5-0.5b' }),
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe('no_asr');
  });
});
