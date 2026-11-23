/**
 * Bing as a provider of its own: online, nothing to set up, one unit that translates.
 */
import { describe, it, expect } from 'vitest';
import type { CheckContext } from '../../lib/provider/types';
import { presentProviders } from '../registry';
import { bingProvider } from './provider';

const env = { platform: 'electron' as const, dev: false, enabled: new Set<string>(), kizuna: true, switchOn: () => false };
const ctx: CheckContext = { pair: { source: 'en', target: 'ja' }, legs: ['speaker'] };

describe('the Bing provider', () => {
  it('bing and edge are present on electron, extension and web', () => {
    for (const platform of ['electron', 'extension', 'web'] as const) {
      expect(presentProviders({ ...env, platform }).map((p) => p.id), platform).toEqual(expect.arrayContaining(['bing']));
    }
  });

  it('is online, with nothing to enter', () => {
    expect(bingProvider.kind).toBe('online');
    expect(bingProvider.credentials.keys).toEqual([]);
    expect(bingProvider.credentials.read({}, { signedIn: false, getToken: async () => null })).toEqual({});
    expect(bingProvider.units.map((u) => u.id)).toEqual(['translation']);
  });

  it('has no options: none acts on any stage, so its line-up card has no fold', () => {
    expect(bingProvider.settingsStages).toEqual([]);
  });

  it('needs nothing to be ready', async () => {
    expect(await bingProvider.check({}, {}, ctx)).toEqual({ ok: true });
  });

  it('offers Bing languages, each target a pair Bing translates', () => {
    const sources = bingProvider.languages.sources({}).map((o) => o.value);
    expect(sources).toContain('en');
    expect(sources).not.toContain('auto');
    const targets = bingProvider.languages.targets('en', {}).map((o) => o.value);
    expect(targets).toContain('ja');
    expect(targets).not.toContain('en');
  });

  it('never starts whole', () => {
    expect(bingProvider).not.toHaveProperty('start');
  });
});
