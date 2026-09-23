import { describe, it, expect, afterEach, vi } from 'vitest';
import { AUTO } from '../lib/provider/languages';
import { fakeProvider } from './fake/provider';
import { PROVIDERS, getProvider, presentProviders } from './registry';

/** The keys the language pair persists under, beside every provider's settings. */
const PAIR_KEYS = ['sourceLanguage', 'targetLanguage'];

describe('the registry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('has unique ids and unique settings keys', () => {
    const ids = PROVIDERS.map((p) => p.id);
    const keys = PROVIDERS.map((p) => p.settings.key);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps settings fields, credential keys and the language pair apart, since all share one storage prefix', () => {
    for (const p of PROVIDERS) {
      const fields = Object.keys(p.settings.defaults as object);
      for (const key of PAIR_KEYS) expect(fields, p.id).not.toContain(key);
      for (const key of p.credentials.keys) {
        expect(fields, p.id).not.toContain(key);
        expect(PAIR_KEYS, p.id).not.toContain(key);
      }
    }
  });

  it('lists every credential field its default settings show among its credential keys', () => {
    for (const p of PROVIDERS) {
      for (const field of p.credentials.fields(p.settings.defaults)) expect(p.credentials.keys, p.id).toContain(field.key);
    }
  });

  it('offers a source, a target for every source, and never AUTO as a target', () => {
    for (const p of PROVIDERS) {
      const s = p.settings.defaults;
      const sources = p.languages.sources(s);
      expect(sources.length, p.id).toBeGreaterThan(0);
      for (const source of sources) {
        const targets = p.languages.targets(source.value, s);
        expect(targets.length, `${p.id} ${source.value}`).toBeGreaterThan(0);
        expect(targets.map((t) => t.value), `${p.id} ${source.value}`).not.toContain(AUTO);
      }
    }
  });

  it('offers at least one turn mode', () => {
    for (const p of PROVIDERS) expect(p.turns(p.settings.defaults).length, p.id).toBeGreaterThan(0);
  });

  it('includes the fake in development builds, on every platform', () => {
    expect(getProvider('fake')).toBe(fakeProvider);
    for (const platform of ['electron', 'extension', 'web'] as const) {
      expect(presentProviders({ platform, dev: true, enabled: new Set() }).map((p) => p.id)).toContain('fake');
    }
  });

  it('leaves the fake out of release builds', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    const released = await import('./registry');
    expect(released.PROVIDERS.map((p) => p.id)).not.toContain('fake');
  });
});
