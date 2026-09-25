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
import { availablePaths, managedProvider, ownKeyOptions, offlineOptions, providerFits, offersRecord } from './providerPaths';

describe('providerPaths', () => {
  it('offers the offline path only, whatever is registered', () => {
    expect(availablePaths()).toEqual(['offline']);
    expect(managedProvider()).toBe(Provider.KIZUNA_AI_SONIOX);
  });

  it('own-key lists every user-managed provider in registration order, never managed or local ones', () => {
    const ids = ownKeyOptions('understand-others').map((o) => o.id);
    expect(ids).toEqual([
      Provider.GEMINI, Provider.VOLCENGINE_AST2, Provider.OPENAI, Provider.OPENAI_TRANSLATE, Provider.OPENAI_LIVE,
      Provider.SONIOX, Provider.OPENAI_COMPATIBLE, Provider.PALABRA_AI,
    ]);
  });

  it('marks providers that cannot serve the scenario instead of hiding them', () => {
    const speak = Object.fromEntries(ownKeyOptions('be-heard').map((o) => [o.id, o.fit]));
    expect(speak[Provider.OPENAI]).toEqual({ ok: true });

    const text = Object.fromEntries(ownKeyOptions('subtitle-myself').map((o) => [o.id, o.fit]));
    expect(text[Provider.PALABRA_AI]).toEqual({ ok: false, reason: 'cannot-be-text-only' });
    expect(text[Provider.OPENAI_TRANSLATE]).toEqual({ ok: false, reason: 'cannot-be-text-only' });
    expect(text[Provider.SONIOX]).toEqual({ ok: true });
  });

  it('offline offers only the in-app engine, on Electron too — LocalNative is not on the branch', () => {
    expect(offlineOptions()).toEqual([Provider.LOCAL_INFERENCE]);
  });

  it('providerFits answers for any provider, including managed and local ones', () => {
    expect(providerFits(Provider.KIZUNA_AI_SONIOX, 'subtitle-myself')).toBe(true);
    expect(providerFits(Provider.KIZUNA_AI_OPENAI_TRANSLATE, 'subtitle-myself')).toBe(false);
    expect(providerFits(Provider.LOCAL_NATIVE, 'two-way-voice')).toBe(true);
  });

  describe('offersRecord', () => {
    it('offers an offline record for local_inference', () => {
      expect(offersRecord({ scenario: 'be-heard', providerPath: 'offline', provider: Provider.LOCAL_INFERENCE })).toBe(true);
    });

    it('refuses an offline record for local_native — not on the branch', () => {
      expect(offersRecord({ scenario: 'be-heard', providerPath: 'offline', provider: Provider.LOCAL_NATIVE })).toBe(false);
    });

    it('refuses a managed record — no managed card until Stage 2', () => {
      expect(offersRecord({ scenario: 'be-heard', providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX })).toBe(false);
    });

    it('refuses an own-key record — no own-key card until Stage 2', () => {
      expect(offersRecord({ scenario: 'be-heard', providerPath: 'own-key', provider: Provider.OPENAI })).toBe(false);
    });

    it('refuses a null providerPath or scenario', () => {
      expect(offersRecord({ scenario: 'be-heard', providerPath: null, provider: Provider.LOCAL_INFERENCE })).toBe(false);
      expect(offersRecord({ scenario: null, providerPath: 'offline', provider: Provider.LOCAL_INFERENCE })).toBe(false);
    });
  });
});
