import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Provider } from '../../types/Provider';

// Registration order in ProviderConfigFactory's static block IS the UI list
// order (the configs Map preserves insertion order, and ProviderSection
// renders getAllConfigs() as-is). This pins the curated head of that list.
async function allProviders(): Promise<Provider[]> {
  vi.resetModules();
  vi.doMock('../../utils/environment', async (orig) => ({
    ...(await orig<any>()),
    isKizunaAIEnabled: () => true,
    isKizunaSonioxEnabled: () => true,
    isKizunaOpenAITranslateEnabled: () => true,
    isKizunaVolcengineAST2Enabled: () => true,
    isPalabraAIEnabled: () => true,
    isLocalNativeEnabled: () => true,
    isElectron: () => true,
    isExtension: () => false,
    getRelayWsUrl: () => 'wss://r.example/v1',
  }));
  const { ProviderConfigFactory } = await import('./ProviderConfigFactory');
  return ProviderConfigFactory.getAvailableProviders();
}

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock('../../utils/environment');
});

describe('provider list order', () => {
  it('leads with the curated eight, in order, before everything else', async () => {
    const ids = await allProviders();

    expect(ids.slice(0, 8)).toEqual([
      Provider.OPENAI,
      Provider.KIZUNA_AI_SONIOX,
      Provider.OPENAI_TRANSLATE,
      Provider.LOCAL_INFERENCE,
      Provider.VOLCENGINE_AST2,
      Provider.GEMINI,
      Provider.SONIOX,
      Provider.PALABRA_AI,
    ]);
  });

  // When a gated provider in the head is absent, the remaining head providers
  // must still lead the list in the same relative order — the gate removes an
  // entry, it must not reshuffle the others.
  it('keeps the head order stable when gated entries drop out', async () => {
    vi.resetModules();
    vi.doMock('../../utils/environment', async (orig) => ({
      ...(await orig<any>()),
      isKizunaAIEnabled: () => false,
      isKizunaSonioxEnabled: () => false,
      isKizunaOpenAITranslateEnabled: () => false,
      isKizunaVolcengineAST2Enabled: () => false,
      isPalabraAIEnabled: () => false,
      isLocalNativeEnabled: () => false,
      isElectron: () => false,
      isExtension: () => false,
      getRelayWsUrl: () => 'wss://r.example/v1',
    }));
    const { ProviderConfigFactory } = await import('./ProviderConfigFactory');
    const ids = ProviderConfigFactory.getAvailableProviders();

    expect(ids.slice(0, 5)).toEqual([
      Provider.OPENAI,
      Provider.OPENAI_TRANSLATE,
      Provider.LOCAL_INFERENCE,
      Provider.GEMINI,
      Provider.SONIOX,
    ]);
  });
});
