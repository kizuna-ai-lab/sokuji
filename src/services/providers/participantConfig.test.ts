import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
}));

vi.mock('./localParticipantConfig', () => ({
  createParticipantLocalInferenceConfig: vi.fn(),
  createParticipantLocalNativeConfig: vi.fn(),
}));

import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
import { createParticipantLocalInferenceConfig, createParticipantLocalNativeConfig } from './localParticipantConfig';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { directionKey } from '../../lib/local-inference/selection/types';
import type { NativeModelInfo } from '../../lib/local-inference/native/nativeProtocol';
import type {
  LocalInferenceSessionConfig,
  LocalNativeSessionConfig,
} from '../interfaces/IClient';

const mockedLocalInference = vi.mocked(createParticipantLocalInferenceConfig);
const mockedLocalNative = vi.mocked(createParticipantLocalNativeConfig);

const shell = { keepReplayAudio: false };

const M = (id: string, kind: NativeModelInfo['kind'], languages: string[], order: number,
           recommended = false): NativeModelInfo =>
  ({ id, name: id, languages, recommended, tiers: [{ tier: 'cpu', backend: 'ct2', available: true }],
     order, repo: id, kind });

const NATIVE_FIXTURE: Record<string, NativeModelInfo> = {
  'ja-only-asr': M('ja-only-asr', 'asr', ['ja'], 1, true),
  'en-asr': M('en-asr', 'asr', ['en'], 1, true),
  'whisper-base': M('whisper-base', 'asr', ['multi'], 5),
  'qwen2.5-0.5b': M('qwen2.5-0.5b', 'translate', ['multi'], 1, true),
};

/** Minimal speaker-side session config; each test overrides the language pair. */
const BASE = {
  sourceLanguage: 'ja',
  targetLanguage: 'en',
  asrModelId: 'ja-only-asr',
  translationModelId: 'qwen2.5-0.5b',
  ttsModelId: 'piper-en',
  ttsVariant: 'int8',
} as unknown as LocalNativeSessionConfig;

describe('participant config: direction lives in config fields', () => {
  it('palabraai swaps sourceLanguage/targetLanguage', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);
    const slice = { ...defaultPalabraAISettings, sourceLanguage: 'en', targetLanguage: 'es-mx' };
    const base = d.buildSessionConfig(slice, 'i') as { sourceLanguage?: string; targetLanguage?: string };
    const c = d.buildParticipantSessionConfig(slice, 'i', shell).config as { sourceLanguage?: string; targetLanguage?: string };
    expect(c.sourceLanguage).toBe(base.targetLanguage);
    expect(c.targetLanguage).toBe(base.sourceLanguage);
  });
});

describe('participant config: reversed pairs the provider catalog cannot run', () => {
  it('palabraai rejects a reversed target from the five source-only codes (eu is not a valid target)', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);
    const slice = { ...defaultPalabraAISettings, sourceLanguage: 'eu', targetLanguage: 'ja' };
    const { config, notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    expect(config).toBeNull();
    expect(notices).toHaveLength(1);
    expect(notices[0].channel).toBe('error');
    expect(notices[0].message).toContain('eu');
    expect(notices[0].message).toContain('ja');
  });

  it('palabraai accepts a reversed target that exactly matches a TARGET_LANGUAGES entry (es)', () => {
    // Pins the exact-match arm of the guard (`t.value === newTarget`) — 'es'
    // has its own entry in TARGET_LANGUAGES. The split('-')[0] arm described
    // in PalabraAIProviderConfig's guard comment is currently unreachable
    // defensive cover for future suffixed-only target entries: every source
    // code in today's catalog either matches exactly or is one of the five
    // excluded source-only codes (eu, ga, mn, mt, ug).
    const d = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);
    const slice = { ...defaultPalabraAISettings, sourceLanguage: 'es', targetLanguage: 'ja' };
    const { config, notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    expect(config).not.toBeNull();
    expect(notices).toEqual([]);
  });
});

describe('participant config: local providers (mocked helpers)', () => {
  beforeEach(() => {
    mockedLocalInference.mockReset();
    mockedLocalNative.mockReset();
  });

  it('local_inference: success with translation available maps to config + no notices', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
    const slice = { ...defaultLocalInferenceSettings };
    const resultConfig = { provider: 'local_inference', sourceLanguage: 'en', targetLanguage: 'ja' } as LocalInferenceSessionConfig;
    mockedLocalInference.mockReturnValue({
      success: true,
      translationAvailable: true,
      config: resultConfig,
    });

    const { config, notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    expect(config).toBe(resultConfig);
    expect(notices).toEqual([]);
  });

  it("local_inference: failure reason 'memory_exceeded' returns null config + warning notice", () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
    const slice = { ...defaultLocalInferenceSettings };
    mockedLocalInference.mockReturnValue({
      success: false, reason: 'memory_exceeded', detail: 'Total RAM ~5000MB exceeds budget ~4000MB (device memory: 4GB)',
    });

    const { config, notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    expect(config).toBeNull();
    expect(notices).toEqual([{ channel: 'warning', message: 'Total RAM ~5000MB exceeds budget ~4000MB (device memory: 4GB)' }]);
  });

  it('local_inference: other failure reason returns null config + error notice', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
    const slice = { ...defaultLocalInferenceSettings };
    mockedLocalInference.mockReturnValue({
      success: false, reason: 'no_asr', detail: 'No ASR model available for en',
    });

    const { config, notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    expect(config).toBeNull();
    expect(notices).toEqual([{ channel: 'error', message: 'No ASR model available for en' }]);
  });

  it('local_inference: translationAvailable false emits the exact target → source warning template', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
    const slice = { ...defaultLocalInferenceSettings, sourceLanguage: 'ja', targetLanguage: 'en' };
    mockedLocalInference.mockReturnValue({
      success: true,
      translationAvailable: false,
      config: { provider: 'local_inference' } as LocalInferenceSessionConfig,
    });

    const { notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    expect(notices).toEqual([{ channel: 'warning', message: 'No translation model for en → ja — transcription only' }]);
  });

  it('local_native: failure returns null config + error notice', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_NATIVE);
    const slice = { ...defaultLocalNativeSettings };
    mockedLocalNative.mockReturnValue({
      success: false, reason: 'no_asr', detail: 'No ASR model available for en',
    });

    const { config, notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    expect(config).toBeNull();
    expect(notices).toEqual([{ channel: 'error', message: 'No ASR model available for en' }]);
  });

  it('local_native: translationAvailable false emits the exact source → target warning template (direction differs from local_inference)', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_NATIVE);
    const slice = { ...defaultLocalNativeSettings };
    mockedLocalNative.mockReturnValue({
      success: true,
      translationAvailable: false,
      config: { provider: 'local_native', sourceLanguage: 'en', targetLanguage: 'ja' } as LocalNativeSessionConfig,
    });

    const { notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    expect(notices).toEqual([{ channel: 'warning', message: 'No translation model for en → ja — transcription only' }]);
  });

  it('local_native: success with translation available maps to config + no notices', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_NATIVE);
    const slice = { ...defaultLocalNativeSettings };
    const resultConfig = { provider: 'local_native', sourceLanguage: 'en', targetLanguage: 'ja' } as LocalNativeSessionConfig;
    mockedLocalNative.mockReturnValue({ success: true, translationAvailable: true, config: resultConfig });

    const { config, notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    expect(config).toBe(resultConfig);
    expect(notices).toEqual([]);
  });

  it('local_inference and local_native pass the BASE participant config (textOnly already applied) to their helper', () => {
    const dInf = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
    mockedLocalInference.mockReturnValue({
      success: true,
      translationAvailable: true,
      config: {} as LocalInferenceSessionConfig,
    });
    dInf.buildParticipantSessionConfig({ ...defaultLocalInferenceSettings }, 'i', shell);
    const infCalls = mockedLocalInference.mock.calls;
    const argInf = infCalls[infCalls.length - 1]?.[0] as unknown as {
      textOnly?: boolean; keepReplayAudio?: boolean;
    };
    expect(argInf.textOnly).toBe(true);
    expect(argInf.keepReplayAudio).toBe(false);

    const dNat = ProviderConfigFactory.getDescriptor(Provider.LOCAL_NATIVE);
    mockedLocalNative.mockReturnValue({ success: true, translationAvailable: true, config: {} as LocalNativeSessionConfig });
    dNat.buildParticipantSessionConfig({ ...defaultLocalNativeSettings }, 'i', shell);
    const natCalls = mockedLocalNative.mock.calls;
    const argNat = natCalls[natCalls.length - 1]?.[0] as unknown as {
      textOnly?: boolean; keepReplayAudio?: boolean;
    };
    expect(argNat.textOnly).toBe(true);
    expect(argNat.keepReplayAudio).toBe(false);
  });
});

describe('participant resolves the reverse direction as a peer', () => {
  // The module-level vi.mock('./localParticipantConfig', ...) above replaces
  // both exports with vi.fn() for every test in this file (the descriptor
  // tests above depend on that). These tests exercise the REAL resolver
  // behaviour instead, so they reach past the mock via vi.importActual —
  // the only way to get the unmocked function back out of a mocked module.
  let realCreateParticipantLocalNativeConfig: typeof createParticipantLocalNativeConfig;

  beforeAll(async () => {
    const actual = await vi.importActual<typeof import('./localParticipantConfig')>('./localParticipantConfig');
    realCreateParticipantLocalNativeConfig = actual.createParticipantLocalNativeConfig;
  });

  it('reads selections[tgt→src] rather than borrowing the speaker memory', () => {
    const dir = directionKey('en', 'ja');
    useNativeModelStore.setState({
      catalog: NATIVE_FIXTURE,
      statuses: { 'whisper-base': 'ready', 'qwen2.5-0.5b': 'ready' },
    });

    const r = realCreateParticipantLocalNativeConfig(
      { ...BASE, sourceLanguage: 'ja', targetLanguage: 'en' },
      { [dir]: { asr: { modelId: 'whisper-base' }, translation: { modelId: '' }, tts: { modelId: '' } } },
    );
    expect(r.success).toBe(true);
    expect(r.success && r.config.sourceLanguage).toBe('en');
    expect(r.success && r.config.targetLanguage).toBe('ja');
    expect(r.success && r.config.asrModelId).toBe('whisper-base');
  });

  it('drops TTS entirely — the participant channel is text-only', () => {
    // Self-contained: sets its own catalog+statuses rather than relying on
    // whatever a PRECEDING test in this file happened to leave in the store
    // (the previous version of this test read state set by the 'reads
    // selections[tgt→src]...' test above, purely from execution order).
    useNativeModelStore.setState({
      catalog: NATIVE_FIXTURE,
      statuses: { 'whisper-base': 'ready', 'qwen2.5-0.5b': 'ready' },
    });
    const dir = directionKey('en', 'ja');
    const r = realCreateParticipantLocalNativeConfig(
      { ...BASE, sourceLanguage: 'ja', targetLanguage: 'en' },
      { [dir]: { asr: { modelId: 'whisper-base' }, translation: { modelId: '' }, tts: { modelId: '' } } },
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.config.ttsModelId).toBeUndefined();
    expect(r.config.ttsVariant).toBeUndefined();
  });

  it("fails with no_asr when the reverse direction cannot resolve ASR", () => {
    useNativeModelStore.setState({ catalog: NATIVE_FIXTURE, statuses: {} });
    const r = realCreateParticipantLocalNativeConfig({ ...BASE, sourceLanguage: 'ja', targetLanguage: 'en' }, {});
    expect(r.success).toBe(false);
    expect(!r.success && r.reason).toBe('no_asr');
  });

  it('does not inherit the speaker direction: an explicit speaker pick is not copied', () => {
    const speakerDir = directionKey('ja', 'en');
    useNativeModelStore.setState({
      catalog: NATIVE_FIXTURE,
      statuses: { 'ja-only-asr': 'ready', 'en-asr': 'ready', 'qwen2.5-0.5b': 'ready' },
    });
    const r = realCreateParticipantLocalNativeConfig(
      { ...BASE, sourceLanguage: 'ja', targetLanguage: 'en' },
      // 'ja-only-asr' is explicitly chosen for the speaker direction. It cannot
      // serve 'en', so if the participant inherited it we would see it here.
      { [speakerDir]: { asr: { modelId: 'ja-only-asr' }, translation: { modelId: '' }, tts: { modelId: '' } } },
    );
    expect(r.success && r.config.asrModelId).toBe('en-asr');
  });
});
