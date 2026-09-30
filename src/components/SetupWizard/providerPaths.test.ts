import { describe, it, expect, vi } from 'vitest';
// All gates on, Electron: the widest registry, so every path has something to offer.
vi.mock('../../utils/environment', async (orig) => ({
  ...(await orig<any>()),
  isKizunaAIEnabled: () => true,
  isPalabraAIEnabled: () => true,
  isLocalNativeEnabled: () => true,
  isElectron: () => true,
  isExtension: () => false,
}));
import { Provider } from '../../types/Provider';
import {
  availablePaths, managedProvider, managedOption, ownKeyOptions, offlineOptions, providerFits, offersRecord,
  textOnlyCapabilityOf, wizardProvider,
} from './providerPaths';

describe('providerPaths', () => {
  it('offers the managed path first, then own key and offline', () => {
    expect(availablePaths()).toEqual(['managed', 'own-key', 'offline']);
    expect(managedProvider()).toBe(Provider.KIZUNA_AI_SONIOX);
  });

  it("lists the registered own-key providers in registry order, in the old enum's spelling", () => {
    expect(ownKeyOptions('understand-others').map((o) => o.id)).toEqual(['gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'soniox', 'palabraai', 'fake']);
  });

  it("judges a provider's fit from its speech", () => {
    expect(textOnlyCapabilityOf({ speech: 'always' })).toBe('never');
    expect(textOnlyCapabilityOf({ speech: 'never' })).toBe('always');
    expect(textOnlyCapabilityOf({ speech: 'optional' })).toBe('optional');

    const text = Object.fromEntries(ownKeyOptions('subtitle-myself').map((o) => [o.id, o.fit]));
    expect(text[Provider.SONIOX]).toEqual({ ok: true });
    // OpenAI Translate offers Text only now (Stage 2 OpenAI Translate, ruling 4): the subtitles-only scenario no longer greys it.
    expect(text[Provider.OPENAI_TRANSLATE]).toEqual({ ok: true });
    // OpenAI Realtime asks for text alone when a leg does not speak (Stage 2 OpenAI Realtime), as the old provider offered.
    expect(text[Provider.OPENAI]).toEqual({ ok: true });
    // Palabra AI asks for text alone too when a leg does not speak (Stage 2 Palabra, ruling 7).
    expect(text[Provider.PALABRA_AI]).toEqual({ ok: true });
  });

  it("judges the managed card's fit from the definition's speech", () => {
    expect(managedOption('subtitle-myself')).toEqual({ id: Provider.KIZUNA_AI_SONIOX, fit: { ok: true } });
  });

  it('offline offers only the in-app engine, on Electron too — LocalNative is not on the branch', () => {
    expect(offlineOptions()).toEqual([Provider.LOCAL_INFERENCE]);
  });

  it('providerFits answers for a registered provider, and no for one this build lacks', () => {
    expect(providerFits(Provider.SONIOX, 'subtitle-myself')).toBe(true);
    expect(providerFits(Provider.LOCAL_INFERENCE, 'two-way-voice')).toBe(true);
    expect(providerFits(Provider.KIZUNA_AI_SONIOX, 'subtitle-myself')).toBe(true);
    // OpenAI Compatible, retired (Stage 2 OpenAI Realtime, ruling 1): no build registers it.
    expect(providerFits(Provider.OPENAI_COMPATIBLE, 'be-heard')).toBe(false);
  });

  describe('offersRecord', () => {
    it('offers an offline record for local_inference', () => {
      expect(offersRecord({ scenario: 'be-heard', providerPath: 'offline', provider: Provider.LOCAL_INFERENCE })).toBe(true);
    });

    it('refuses an offline record for local_native — not on the branch', () => {
      expect(offersRecord({ scenario: 'be-heard', providerPath: 'offline', provider: Provider.LOCAL_NATIVE })).toBe(false);
    });

    it('offers a managed record for Kizuna Soniox', () => {
      expect(offersRecord({ scenario: 'be-heard', providerPath: 'managed', provider: Provider.KIZUNA_AI_SONIOX })).toBe(true);
    });

    it('refuses a managed record naming a provider this build does not register', () => {
      // The OpenAI Translate relay twin, deleted (Stage 2 deletion, ruling 2).
      expect(offersRecord({ scenario: 'be-heard', providerPath: 'managed', provider: 'kizunaai_openai_translate' as Provider })).toBe(false);
    });

    it('offers an own-key record for Soniox', () => {
      expect(offersRecord({ scenario: 'be-heard', providerPath: 'own-key', provider: Provider.SONIOX })).toBe(true);
    });

    it('refuses an own-key record for a provider this build does not register', () => {
      expect(offersRecord({ scenario: 'be-heard', providerPath: 'own-key', provider: Provider.OPENAI_COMPATIBLE })).toBe(false);
    });

    it('refuses a null providerPath or scenario', () => {
      expect(offersRecord({ scenario: 'be-heard', providerPath: null, provider: Provider.LOCAL_INFERENCE })).toBe(false);
      expect(offersRecord({ scenario: null, providerPath: 'offline', provider: Provider.LOCAL_INFERENCE })).toBe(false);
    });
  });

  it("wizardProvider reads a draft's old spelling", () => {
    expect(wizardProvider('local_inference')?.id).toBe('localInference');
    expect(wizardProvider('soniox')?.id).toBe('soniox');
    expect(wizardProvider('kizunaai_soniox')?.kind).toBe('managed');
    expect(wizardProvider('openai')?.id).toBe('openai');
    expect(wizardProvider('openai_compatible')).toBeUndefined();
    expect(wizardProvider(null)).toBeUndefined();
  });
});
