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

// The real module (src/locales/index.ts) preloads en/translation.json and
// i18n.init()s at import time, so an unmocked i18n.t() resolves the KEY's real
// resource string, not the caller's defaultValue — masking exactly the
// fallback path these tests assert on. Mock it the same way the component
// layer mocks react-i18next's t (def ?? key) so a defaultValue round-trips.
vi.mock('../../locales', () => ({
  default: { t: (key: string, def?: string) => def ?? key },
}));

import { ProviderConfigFactory } from './ProviderConfigFactory';
import { Provider } from '../../types/Provider';

describe('local prepareToStart', () => {
  const ports = (revalidateResult: { valid: boolean; message?: string }) => ({
    getAuthToken: async () => null,
    userId: null,
    revalidate: vi.fn().mockResolvedValue(revalidateResult),
    sessionShape: { speakerWillStart: true, participantWillStart: false, textOnly: false },
    onPhase: vi.fn(),
    signal: new AbortController().signal,
  });

  for (const id of [Provider.LOCAL_INFERENCE, Provider.LOCAL_NATIVE]) {
    it(`${id}: valid revalidation → bare ok`, async () => {
      const d = ProviderConfigFactory.getDescriptor(id);
      const p = ports({ valid: true });
      await expect(d.prepareToStart!({}, p)).resolves.toEqual({ ok: true });
      expect(p.revalidate).toHaveBeenCalledTimes(1);
    });

    it(`${id}: invalid revalidation passes the store's message through verbatim`, async () => {
      const d = ProviderConfigFactory.getDescriptor(id);
      const out = await d.prepareToStart!({}, ports({ valid: false, message: 'no ASR model for ja' }));
      expect(out).toEqual({ ok: false, message: 'no ASR model for ja' });
    });

    it(`${id}: invalid with an empty message falls back to the provider's own default`, async () => {
      const d = ProviderConfigFactory.getDescriptor(id);
      const out = await d.prepareToStart!({}, ports({ valid: false, message: '' }));
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.message).toBe('Required models not available for selected language pair.');
    });
  }
});
