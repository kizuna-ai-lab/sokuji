import { describe, it, expect, vi } from 'vitest';
// Force every feature flag on so ALL descriptors register regardless of build env.
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isVolcengineSTEnabled: () => true,
  isVolcengineAST2Enabled: () => true,
  isZoomAIEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
  getRelayWsUrl: () => 'wss://r.example/v1',
}));
import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';
import { OpenAITranslateGAClient } from '../clients/OpenAITranslateGAClient';
import { VolcengineAST2Client } from '../clients/VolcengineAST2Client';

describe('provider registry descriptors', () => {
  it('returns a descriptor for every available provider', () => {
    const ids = ProviderConfigFactory.getAvailableProviders();
    expect(ids.length).toBe(11);
    for (const id of ids) {
      const d = ProviderConfigFactory.getDescriptor(id);
      expect(d.getConfig().id).toBe(id);
      expect(typeof d.settingsSliceKey).toBe('string');
    }
  });

  it('slice keys are unique', () => {
    const keys = ProviderConfigFactory.getAvailableProviders()
      .map(id => ProviderConfigFactory.getDescriptor(id).settingsSliceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('descriptor.createClient', () => {
  const creds = { ok: true as const, primary: 'k', secret: 's', endpoint: 'https://e.example' };
  const ws = { transport: 'websocket' as const };

  it('constructs a client for every available provider', () => {
    for (const id of ProviderConfigFactory.getAvailableProviders()) {
      const client = ProviderConfigFactory.getDescriptor(id).createClient(creds, ws);
      expect(client.getProvider()).toBe(id === Provider.KIZUNA_AI_OPENAI_TRANSLATE ? Provider.OPENAI_TRANSLATE
        : id === Provider.KIZUNA_AI_VOLCENGINE_AST2 ? Provider.VOLCENGINE_AST2
        : id === Provider.OPENAI_COMPATIBLE ? Provider.OPENAI
        : id);
    }
  });

  it('kizuna translate twin routes to relay OpenAITranslateGAClient', () => {
    const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_OPENAI_TRANSLATE)
      .createClient({ ok: true, primary: 'sess_TOKEN' }, ws);
    expect(c).toBeInstanceOf(OpenAITranslateGAClient);
  });

  it('kizuna doubao twin routes to relay VolcengineAST2Client', () => {
    const c = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_VOLCENGINE_AST2)
      .createClient({ ok: true, primary: 'sess_TOKEN' }, ws);
    expect(c).toBeInstanceOf(VolcengineAST2Client);
  });
});

describe('descriptor.validateAndFetchModels', () => {
  it('rejects incomplete credentials with the provider-specific message', async () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.PALABRA_AI);
    const r = await d.validateAndFetchModels({ ok: false, missing: 'Both Client ID and Client Secret are required for Palabra AI' });
    expect(r.validation.valid).toBe(false);
    expect(r.validation.message).toMatch(/Client ID and Client Secret/);
    expect(r.models).toEqual([]);
  });

  it('kizuna twins validate statically from a non-empty token', async () => {
    const d = ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_OPENAI_TRANSLATE);
    const ok = await d.validateAndFetchModels({ ok: true, primary: 'sess_TOKEN' });
    expect(ok.validation.valid).toBe(true);
    expect(ok.models[0].id).toBe('gpt-realtime-translate');
    const bad = await d.validateAndFetchModels({ ok: false, missing: 'Sign in is required for Kizuna relay providers' });
    expect(bad.validation.valid).toBe(false);
  });
});

describe('descriptor.latestRealtimeModel', () => {
  it('fixed-model providers return their identifier', () => {
    expect(ProviderConfigFactory.getDescriptor(Provider.ZOOM_AI).latestRealtimeModel([])).toBe('zoom-scribe-translator-v1');
    expect(ProviderConfigFactory.getDescriptor(Provider.VOLCENGINE_AST2).latestRealtimeModel([])).toBe('ast-v2-s2s');
    expect(ProviderConfigFactory.getDescriptor(Provider.KIZUNA_AI_VOLCENGINE_AST2).latestRealtimeModel([])).toBe('ast-v2-s2s');
  });
});
