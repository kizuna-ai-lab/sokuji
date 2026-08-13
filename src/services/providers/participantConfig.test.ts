import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
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
import { reverseGeminiTranslationDirection } from './geminiTranslateModel';
import { reverseTranscriptionDirection } from './openaiTranscriptionContext';
import type {
  GeminiSessionConfig,
  OpenAISessionConfig,
  OpenAITranslateSessionConfig,
} from '../interfaces/IClient';

const shell = { keepReplayAudio: false };

// Local mapping from settingsSliceKey to default settings slice, scoped to
// the two openai-family providers exercised below — mirrors DEFAULTS_BY_SLICE
// in descriptorRegistry.test.ts.
const DEFAULTS_BY_SLICE_LOCAL: Record<string, unknown> = {
  openai: defaultOpenAISettings,
  openaiCompatible: defaultOpenAICompatibleSettings,
};

describe('participant config: direction lives in config fields', () => {
  it('soniox swaps sourceLanguage/targetLanguage', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.SONIOX);
    const slice = { ...defaultSonioxSettings, sourceLanguage: 'zh', targetLanguage: 'en' };
    const base = d.buildSessionConfig(slice, 'i') as { sourceLanguage?: string; targetLanguage?: string };
    const { config, notices } = d.buildParticipantSessionConfig(slice, 'i', shell);
    const c = config as { sourceLanguage?: string; targetLanguage?: string; textOnly?: boolean };
    expect(c.sourceLanguage).toBe(base.targetLanguage);
    expect(c.targetLanguage).toBe(base.sourceLanguage);
    expect(c.textOnly).toBe(true);
    expect(notices).toEqual([]);
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

  it('openai_translate swaps targetLanguage to the old sourceLanguage', () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.OPENAI_TRANSLATE);
    const slice = { ...defaultOpenAITranslateSettings, sourceLanguage: 'ja', targetLanguage: 'en' };
    const base = d.buildSessionConfig(slice, 'i') as OpenAITranslateSessionConfig;
    const c = d.buildParticipantSessionConfig(slice, 'i', shell).config as OpenAITranslateSessionConfig;
    expect(c.targetLanguage).toBe(base.sourceLanguage ?? base.targetLanguage);
    expect(c.sourceLanguage).toBe(base.targetLanguage);
  });
});
