import { describe, it, expect } from 'vitest';
import type { CheckContext } from '../../lib/provider/types';
import { presentProviders } from '../registry';
import { edgeProvider } from './provider';
import { EDGE_DEFAULTS } from './settings';

const env = { platform: 'electron' as const, dev: false, enabled: new Set<string>(), kizuna: true, switchOn: () => false };
const ctx: CheckContext = { pair: { source: 'en', target: 'ja' }, legs: ['speaker'] };

describe('the Edge provider', () => {
  it('is present on electron, extension and web, right after Bing', () => {
    for (const platform of ['electron', 'extension', 'web'] as const) {
      const ids = presentProviders({ ...env, platform }).map((p) => p.id);
      expect(ids.indexOf('edge'), platform).toBe(ids.indexOf('bing') + 1);
    }
  });

  it('is online, with nothing to enter, and one speech unit', async () => {
    expect(edgeProvider.kind).toBe('online');
    expect(edgeProvider.credentials.keys).toEqual([]);
    expect(edgeProvider.credentials.read({}, { signedIn: false, getToken: async () => null })).toEqual({});
    expect(edgeProvider.units.map((u) => u.id)).toEqual(['speech']);
    expect(edgeProvider.settingsStages).toEqual([['speech']]);
    expect(edgeProvider.units[0].capabilities(EDGE_DEFAULTS).speech).toBe('optional');
    expect(await edgeProvider.check({}, EDGE_DEFAULTS, ctx)).toEqual({ ok: true });
  });

  it("migrates from the local provider's keys", () => {
    expect(edgeProvider.settings.legacyKeys).toEqual(['voices', 'speed', 'settings.localInference.voices', 'settings.localInference.ttsSpeed']);
  });
});
