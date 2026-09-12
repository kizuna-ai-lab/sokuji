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
  // The product order decided 2026-09-12: Kizuna-managed, Free, Gemini, Doubao
  // AST 2.0, the three OpenAI providers, Soniox, OpenAI Compatible, Palabra,
  // then the rest.
  it('lists every provider in the decided order when every gate is on', async () => {
    const ids = await allProviders();

    expect(ids).toEqual([
      Provider.KIZUNA_AI_SONIOX,
      Provider.KIZUNA_AI_OPENAI_TRANSLATE,
      Provider.KIZUNA_AI_VOLCENGINE_AST2,
      Provider.LOCAL_INFERENCE,
      Provider.GEMINI,
      Provider.VOLCENGINE_AST2,
      Provider.OPENAI,
      Provider.OPENAI_TRANSLATE,
      Provider.OPENAI_LIVE,
      Provider.SONIOX,
      Provider.OPENAI_COMPATIBLE,
      Provider.PALABRA_AI,
      Provider.LOCAL_NATIVE,
      Provider.VOLCENGINE_ST,
      Provider.ZOOM_AI,
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

    expect(ids).toEqual([
      Provider.LOCAL_INFERENCE,
      Provider.GEMINI,
      Provider.OPENAI,
      Provider.OPENAI_TRANSLATE,
      Provider.SONIOX,
      Provider.VOLCENGINE_ST,
      Provider.ZOOM_AI,
    ]);
  });
});
