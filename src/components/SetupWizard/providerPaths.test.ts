import { describe, it, expect, vi } from 'vitest';
// All gates on, Electron: the widest registry, so every path has something to offer.
vi.mock('../../utils/environment', async (orig) => ({
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
import { Provider } from '../../types/Provider';
import { availablePaths, managedProvider, ownKeyOptions, offlineOptions, providerFits } from './providerPaths';

describe('providerPaths', () => {
  it('offers all three paths when a managed provider is registered', () => {
    expect(availablePaths()).toEqual(['managed', 'own-key', 'offline']);
    expect(managedProvider()).toBe(Provider.KIZUNA_AI_SONIOX);
  });

  it('own-key lists every user-managed provider in registration order, never managed or local ones', () => {
    const ids = ownKeyOptions('understand-others').map((o) => o.id);
    expect(ids).toEqual([
      Provider.OPENAI, Provider.OPENAI_TRANSLATE, Provider.VOLCENGINE_AST2, Provider.GEMINI,
      Provider.SONIOX, Provider.PALABRA_AI, Provider.OPENAI_COMPATIBLE, Provider.VOLCENGINE_ST, Provider.ZOOM_AI,
    ]);
  });

  it('marks providers that cannot serve the scenario instead of hiding them', () => {
    const speak = Object.fromEntries(ownKeyOptions('be-heard').map((o) => [o.id, o.fit]));
    expect(speak[Provider.VOLCENGINE_ST]).toEqual({ ok: false, reason: 'cannot-speak' });
    expect(speak[Provider.ZOOM_AI]).toEqual({ ok: false, reason: 'cannot-speak' });
    expect(speak[Provider.OPENAI]).toEqual({ ok: true });

    const text = Object.fromEntries(ownKeyOptions('subtitle-myself').map((o) => [o.id, o.fit]));
    expect(text[Provider.PALABRA_AI]).toEqual({ ok: false, reason: 'cannot-be-text-only' });
    expect(text[Provider.OPENAI_TRANSLATE]).toEqual({ ok: false, reason: 'cannot-be-text-only' });
    expect(text[Provider.SONIOX]).toEqual({ ok: true });
  });

  it('offline offers WASM and, on Electron, Native', () => {
    expect(offlineOptions()).toEqual([Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE]);
  });

  it('providerFits answers for any provider, including managed and local ones', () => {
    expect(providerFits(Provider.KIZUNA_AI_SONIOX, 'subtitle-myself')).toBe(true);
    expect(providerFits(Provider.KIZUNA_AI_OPENAI_TRANSLATE, 'subtitle-myself')).toBe(false);
    expect(providerFits(Provider.LOCAL_NATIVE, 'two-way-voice')).toBe(true);
  });
});
