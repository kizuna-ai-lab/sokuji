import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));

vi.mock('./localParticipantConfig', () => ({
  createParticipantLocalInferenceConfig: vi.fn(),
  createParticipantLocalNativeConfig: vi.fn(),
}));

import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import { defaultSonioxSettings } from './SonioxProviderConfig';
import { defaultVolcengineAST2Settings } from './VolcengineAST2ProviderConfig';
import { defaultPalabraAISettings } from './PalabraAIProviderConfig';
import { defaultVolcengineSTSettings } from './VolcengineSTProviderConfig';
import { defaultZoomAISettings } from './ZoomAIProviderConfig';
import { defaultGeminiSettings } from './GeminiProviderConfig';
import { defaultOpenAISettings } from './OpenAIProviderConfig';
import { defaultOpenAICompatibleSettings } from './OpenAICompatibleProviderConfig';
import { defaultOpenAITranslateSettings } from './OpenAITranslateProviderConfig';
import { defaultLocalInferenceSettings } from './LocalInferenceProviderConfig';
import { defaultLocalNativeSettings } from './LocalNativeProviderConfig';
import { reverseGeminiTranslationDirection } from './geminiTranslateModel';
import { reverseTranscriptionDirection } from './openaiTranscriptionContext';
import { createParticipantLocalInferenceConfig, createParticipantLocalNativeConfig } from './localParticipantConfig';
import type {
  GeminiSessionConfig,
  OpenAISessionConfig,
  OpenAITranslateSessionConfig,
  LocalInferenceSessionConfig,
  LocalNativeSessionConfig,
} from '../interfaces/IClient';

const mockedLocalInference = vi.mocked(createParticipantLocalInferenceConfig);
const mockedLocalNative = vi.mocked(createParticipantLocalNativeConfig);

const shell = { keepReplayAudio: false };

// Local mapping from settingsSliceKey to default settings slice, scoped to
// the two openai-family providers exercised below — mirrors DEFAULTS_BY_SLICE
// in descriptorRegistry.test.ts.
const DEFAULTS_BY_SLICE_LOCAL: Record<string, unknown> = {
  openai: defaultOpenAISettings,
  openaiCompatible: defaultOpenAICompatibleSettings,
};

describe('participant config: direction lives in config fields', () => {
  it('soniox swaps sourceLanguage/targetLanguage (twin inherits)', () => {
    for (const id of [Provider.SONIOX, Provider.KIZUNA_AI_SONIOX]) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const slice = { ...defaultSonioxSettings, sourceLanguage: 'zh', targetLanguage: 'en' };
      const base = d.buildSessionConfig(slice, 'i') as { sourceLanguage?: string; targetLanguage?: string };
      const { config, notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
      const c = config as { sourceLanguage?: string; targetLanguage?: string; textOnly?: boolean };
      expect(c.sourceLanguage, `swap for ${id}`).toBe(base.targetLanguage);
      expect(c.targetLanguage, `swap for ${id}`).toBe(base.sourceLanguage);
      expect(c.textOnly, `textOnly for ${id}`).toBe(true);
      expect(notices, `notices for ${id}`).toEqual([]);
    }
  });

  it('volcengine_ast2 swaps sourceLanguage/targetLanguage (twin inherits)', () => {
    for (const id of [Provider.VOLCENGINE_AST2, Provider.KIZUNA_AI_VOLCENGINE_AST2]) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const slice = { ...defaultVolcengineAST2Settings, sourceLanguage: 'ja', targetLanguage: 'ko' };
      const base = d.buildSessionConfig(slice, 'i') as { sourceLanguage?: string; targetLanguage?: string };
      const c = d.buildParticipantSessionConfig(slice, 'i', shell).config as { sourceLanguage?: string; targetLanguage?: string };
      expect(c.sourceLanguage, `swap for ${id}`).toBe(base.targetLanguage);
      expect(c.targetLanguage, `swap for ${id}`).toBe(base.sourceLanguage);
    }
  });

  it('palabraai swaps sourceLanguage/targetLanguage', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);
    const slice = { ...defaultPalabraAISettings, sourceLanguage: 'en', targetLanguage: 'es-mx' };
    const base = d.buildSessionConfig(slice, 'i') as { sourceLanguage?: string; targetLanguage?: string };
    const c = d.buildParticipantSessionConfig(slice, 'i', shell).config as { sourceLanguage?: string; targetLanguage?: string };
    expect(c.sourceLanguage).toBe(base.targetLanguage);
    expect(c.targetLanguage).toBe(base.sourceLanguage);
  });

  it('volcengine_st and zoom_ai rotate sourceLanguage through targetLanguages[0]', () => {
    for (const [id, defaults] of [
      [Provider.VOLCENGINE_ST, defaultVolcengineSTSettings],
      [Provider.ZOOM_AI, defaultZoomAISettings],
    ] as const) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const slice = { ...defaults };
      const base = d.buildSessionConfig(slice, 'i') as { sourceLanguage: string; targetLanguages: string[] };
      const c = d.buildParticipantSessionConfig(slice, 'i', shell).config as { sourceLanguage: string; targetLanguages: string[] };
      expect(c.sourceLanguage, `rotate for ${id}`).toBe(base.targetLanguages[0] || base.sourceLanguage);
      expect(c.targetLanguages, `rotate for ${id}`).toEqual([base.sourceLanguage]);
    }
  });
});

describe('participant config: helper-based reversals', () => {
  it('gemini forces turnDetectionMode Auto and reverses translationConfig when present', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.GEMINI);
    // Non-Auto so the assertion below discriminates the override's forcing
    // spread from the base builder simply forwarding settings.turnDetectionMode.
    const slice = { ...defaultGeminiSettings, turnDetectionMode: 'Push-to-Talk' as const };
    const { config } = d.buildParticipantSessionConfig(slice, 'i', shell);
    const c = config as GeminiSessionConfig & { turnDetectionMode?: string };
    expect(c.turnDetectionMode).toBe('Auto');
    // Behavioural equality with the helper is asserted exactly: applying
    // reverseGeminiTranslationDirection to a fresh base+overrides copy must
    // yield the same object.
    const expected = {
      ...d.buildSessionConfig(slice, 'i'),
      keepReplayAudio: false,
      textOnly: true,
      turnDetection: { type: 'semantic_vad', createResponse: true, interruptResponse: false, eagerness: 'high' },
      turnDetectionMode: 'Auto',
    } as unknown as GeminiSessionConfig;
    reverseGeminiTranslationDirection(expected);
    expect(c).toEqual(expected);
  });

  it('gemini live-translate model reverses translationConfig direction for participant', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.GEMINI);
    // 'live-translate' matches isGeminiTranslateModel's marker, so this slice
    // exercises the branch the previous case's model: '' (defaultGeminiSettings)
    // cannot: translationConfig actually present on the base config.
    const slice = {
      ...defaultGeminiSettings,
      model: 'gemini-3.5-live-translate-preview',
      sourceLanguage: 'en-US',
      targetLanguage: 'ja-JP',
    };
    const base = d.buildSessionConfig(slice, 'i') as GeminiSessionConfig;
    // toTranslationLanguageCode reduces 'en-US' -> 'en' and 'ja-JP' -> 'ja'.
    expect(base.translationConfig).toEqual({ targetLanguageCode: 'ja', echoTargetLanguage: false });
    expect(base.sourceLanguageCode).toBe('en');

    const { config } = d.buildParticipantSessionConfig(slice, 'i', shell);
    const c = config as GeminiSessionConfig;
    // Participant translates INTO the user's own language (en): the target
    // the other party hears is now the original source, and the carried
    // sourceLanguageCode becomes the original target.
    expect(c.translationConfig).toEqual({ targetLanguageCode: 'en', echoTargetLanguage: false });
    expect(c.sourceLanguageCode).toBe('ja');
  });

  it('openai and openai_compatible rebuild the transcription hint for the reversed direction', () => {
    for (const id of [Provider.OPENAI, Provider.OPENAI_COMPATIBLE]) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const slice = { ...(DEFAULTS_BY_SLICE_LOCAL[d.settingsSliceKey] as Record<string, unknown>) };
      const { config } = d.buildParticipantSessionConfig(slice, 'i', shell);
      const expected = {
        ...d.buildSessionConfig(slice, 'i'),
        keepReplayAudio: false,
        textOnly: true,
        turnDetection: { type: 'semantic_vad', createResponse: true, interruptResponse: false, eagerness: 'high' },
      } as OpenAISessionConfig;
      reverseTranscriptionDirection(expected);
      expect(config, `hint reversal for ${id}`).toEqual(expected);
    }
  });

  it('openai_translate swaps targetLanguage to the old sourceLanguage (twin inherits)', () => {
    for (const id of [Provider.OPENAI_TRANSLATE, Provider.KIZUNA_AI_OPENAI_TRANSLATE]) {
      const d = ProviderConfigFactory.getDescriptor(id);
      const slice = { ...defaultOpenAITranslateSettings, sourceLanguage: 'ja', targetLanguage: 'en' };
      const base = d.buildSessionConfig(slice, 'i') as OpenAITranslateSessionConfig;
      const c = d.buildParticipantSessionConfig(slice, 'i', shell).config as OpenAITranslateSessionConfig;
      expect(c.targetLanguage, `target for ${id}`).toBe(base.sourceLanguage ?? base.targetLanguage);
      expect(c.sourceLanguage, `source for ${id}`).toBe(base.targetLanguage);
    }
  });
});

describe('participant config: local providers (mocked helpers)', () => {
  beforeEach(() => {
    mockedLocalInference.mockReset();
    mockedLocalNative.mockReset();
  });

  it('local_inference: success with translation available and no ASR fallback maps to config + no notices', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
    const slice = { ...defaultLocalInferenceSettings };
    const resultConfig = { provider: 'local_inference', sourceLanguage: 'en', targetLanguage: 'ja' } as LocalInferenceSessionConfig;
    mockedLocalInference.mockReturnValue({
      success: true,
      config: resultConfig,
      status: {
        asrAvailable: true, asrModelId: 'sensevoice-int8', asrFallback: false,
        asrOriginalModelId: 'sensevoice-int8', translationAvailable: true, translationModelId: 'opus-mt-en-ja',
      },
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
      config: { provider: 'local_inference' } as LocalInferenceSessionConfig,
      status: {
        asrAvailable: true, asrModelId: 'sensevoice-int8', asrFallback: false,
        asrOriginalModelId: 'sensevoice-int8', translationAvailable: false, translationModelId: null,
      },
    });

    const { notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    expect(notices).toEqual([{ channel: 'warning', message: 'No translation model for en → ja — transcription only' }]);
  });

  it('local_inference: asrFallback emits the exact info template', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
    const slice = { ...defaultLocalInferenceSettings };
    mockedLocalInference.mockReturnValue({
      success: true,
      config: { provider: 'local_inference' } as LocalInferenceSessionConfig,
      status: {
        asrAvailable: true, asrModelId: 'sensevoice-int8', asrFallback: true,
        asrOriginalModelId: 'whisper-large', translationAvailable: true, translationModelId: 'opus-mt-ja-en',
      },
    });

    const { notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    expect(notices).toEqual([{ channel: 'info', message: 'Using sensevoice-int8 instead of whisper-large for ASR' }]);
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

  it('local_inference and local_native pass the BASE participant config (textOnly + semantic VAD already applied) to their helper', () => {
    const dInf = ProviderConfigFactory.getDescriptor(Provider.LOCAL_INFERENCE);
    mockedLocalInference.mockReturnValue({
      success: true,
      config: {} as LocalInferenceSessionConfig,
      status: {
        asrAvailable: true, asrModelId: 'x', asrFallback: false,
        asrOriginalModelId: 'x', translationAvailable: true, translationModelId: 'y',
      },
    });
    dInf.buildParticipantSessionConfig({ ...defaultLocalInferenceSettings }, 'i', shell);
    const infCalls = mockedLocalInference.mock.calls;
    const argInf = infCalls[infCalls.length - 1]?.[0] as unknown as {
      textOnly?: boolean; turnDetection?: unknown; keepReplayAudio?: boolean;
    };
    expect(argInf.textOnly).toBe(true);
    expect(argInf.turnDetection).toEqual({ type: 'semantic_vad', createResponse: true, interruptResponse: false, eagerness: 'high' });
    expect(argInf.keepReplayAudio).toBe(false);

    const dNat = ProviderConfigFactory.getDescriptor(Provider.LOCAL_NATIVE);
    mockedLocalNative.mockReturnValue({ success: true, translationAvailable: true, config: {} as LocalNativeSessionConfig });
    dNat.buildParticipantSessionConfig({ ...defaultLocalNativeSettings }, 'i', shell);
    const natCalls = mockedLocalNative.mock.calls;
    const argNat = natCalls[natCalls.length - 1]?.[0] as unknown as {
      textOnly?: boolean; turnDetection?: unknown; keepReplayAudio?: boolean;
    };
    expect(argNat.textOnly).toBe(true);
    expect(argNat.turnDetection).toEqual({ type: 'semantic_vad', createResponse: true, interruptResponse: false, eagerness: 'high' });
    expect(argNat.keepReplayAudio).toBe(false);
  });
});
