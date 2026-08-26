import { describe, it, expect } from 'vitest';
import { Provider } from '../../types/Provider';
import { OFFLINE_PROVIDERS, providerPathFor } from './providerPath';

describe('providerPathFor', () => {
  it('maps the backend-managed twins to the managed path', () => {
    expect(providerPathFor(Provider.KIZUNA_AI_SONIOX)).toBe('managed');
    expect(providerPathFor(Provider.KIZUNA_AI_OPENAI_TRANSLATE)).toBe('managed');
    expect(providerPathFor(Provider.KIZUNA_AI_VOLCENGINE_AST2)).toBe('managed');
  });

  it('maps both local engines to the offline path', () => {
    expect(providerPathFor(Provider.LOCAL_INFERENCE)).toBe('offline');
    expect(providerPathFor(Provider.LOCAL_NATIVE)).toBe('offline');
    expect(OFFLINE_PROVIDERS).toEqual([Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE]);
  });

  it('maps everything else to own-key', () => {
    for (const p of [Provider.OPENAI, Provider.GEMINI, Provider.PALABRA_AI, Provider.SONIOX,
      Provider.OPENAI_COMPATIBLE, Provider.OPENAI_TRANSLATE, Provider.VOLCENGINE_ST,
      Provider.VOLCENGINE_AST2, Provider.ZOOM_AI]) {
      expect(providerPathFor(p)).toBe('own-key');
    }
  });

  it('classifies every provider in the enum', () => {
    // The tour gates a step on the answer, so an unclassified provider would
    // silently fall into own-key and point the user at a key field it has no
    // use for. Walking the enum fails the day one is added unclassified.
    for (const p of Object.values(Provider)) {
      expect(['managed', 'own-key', 'offline']).toContain(providerPathFor(p));
    }
  });
});
