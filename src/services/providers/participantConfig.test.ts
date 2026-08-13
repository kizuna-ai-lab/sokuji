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

const shell = { keepReplayAudio: false };

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
