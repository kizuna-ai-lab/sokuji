import { describe, it, expect, afterEach, vi } from 'vitest';
import { isPresent } from '../lib/provider/presence';
import { AUTO, normalizePair } from '../lib/provider/languages';
import type { AnyProvider, AuthContext } from '../lib/provider/types';
import en from '../locales/en/translation.json';
import { LEGACY_SLICE_KEYS, storedProviderValue } from '../lib/session/storedSettings';
import { isKizunaAIEnabled } from '../utils/environment';
import { fakeLeasedProvider } from './fake/leased';
import { fakeProvider } from './fake/provider';
import { FAKE_DEFAULTS } from './fake/settings';
import { PROVIDERS, currentPresenceEnv, getProvider, presentProviders } from './registry';

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
    expect(getProvider('fake_leased')).toBe(fakeLeasedProvider);
    for (const platform of ['electron', 'extension', 'web'] as const) {
      const ids = presentProviders({ platform, dev: true, enabled: new Set(), kizuna: true, switchOn: () => false }).map((p) => p.id);
      expect(ids).toContain('fake');
      expect(ids).toContain('fake_leased');
    }
  });

  it('leaves the fake out of release builds', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    const released = await import('./registry');
    expect(released.PROVIDERS.map((p) => p.id)).not.toContain('fake');
    expect(released.PROVIDERS.map((p) => p.id)).not.toContain('fake_leased');
  });

  it("a release build offers no flagged provider and, without the umbrella, no managed one (D24 release check, F6)", () => {
    for (const platform of ['electron', 'extension', 'web'] as const) {
      for (const p of presentProviders({ platform, dev: false, enabled: new Set(), kizuna: false, switchOn: () => false })) {
        expect(p.flagged, p.id).not.toBe(true);
        expect(p.kind, p.id).not.toBe('managed');
      }
    }

    // The control, so the case bites before any flagged or managed provider is registered.
    const control: readonly AnyProvider[] = [fakeProvider, { ...fakeProvider, id: 'm', kind: 'managed' as const }, { ...fakeProvider, id: 'f', flagged: true as const }];
    const env = { platform: 'electron' as const, dev: false, enabled: new Set<string>(), kizuna: false, switchOn: () => false };
    expect(control.filter((p) => isPresent(p, env)).map((p) => p.id)).toEqual(['fake']);
  });

  it('a tester switch sits only on a flagged provider', () => {
    const switchOffenders = (ps: readonly Pick<AnyProvider, 'id' | 'flagged' | 'testerSwitch'>[]) =>
      ps.filter((p) => p.testerSwitch !== undefined && p.flagged !== true).map((p) => p.id);
    expect(switchOffenders(PROVIDERS)).toEqual([]);
    expect(switchOffenders([{ id: 'x', testerSwitch: 'debug:x' }, { id: 'y', flagged: true, testerSwitch: 'debug:y' }])).toEqual(['x']);
  });

  it("the app's presence reads the umbrella and this device's switches", () => {
    const env = currentPresenceEnv();
    expect(env.kizuna).toBe(isKizunaAIEnabled());
    localStorage.setItem('debug:probe-switch', '1');
    expect(env.switchOn('debug:probe-switch')).toBe(true);
    expect(env.switchOn('debug:other')).toBe(false);
    localStorage.removeItem('debug:probe-switch');
  });
});

describe('the invariants every provider meets (F17)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const DEV_ONLY_IDS = ['fake', 'fake_leased'];
  const released = PROVIDERS.filter((p) => !DEV_ONLY_IDS.includes(p.id));
  const at = (tree: unknown, path: string) => path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree);
  const signedOut: AuthContext = { signedIn: false, getToken: async () => null };
  const signedIn: AuthContext = { signedIn: true, getToken: async () => 'token' };

  it("every released id is the old Provider enum's spelling (controller ruling 2)", () => {
    for (const p of released) expect(Object.keys(LEGACY_SLICE_KEYS), p.id).toContain(storedProviderValue(p.id));
  });

  it('a provider that existed before keeps its storage prefix', () => {
    for (const p of released) expect(p.settings.key, p.id).toBe(LEGACY_SLICE_KEYS[storedProviderValue(p.id)]);
  });

  it('every released provider has a name and a description in en, under its locale key', () => {
    // The two fakes are exempt (D24: never localized).
    for (const p of released) {
      const key = p.i18nKey ?? p.id;
      expect(at(en, `providers.${key}.name`), p.id).toEqual(expect.any(String));
      expect(at(en, `providers.${key}.name`), p.id).not.toBe('');
      expect(at(en, `providers.${key}.description`), p.id).toEqual(expect.any(String));
      expect(at(en, `providers.${key}.description`), p.id).not.toBe('');
    }
  });

  it("every credential field's label and placeholder are sentences in en", () => {
    const check = (f: { labelKey: string; placeholderKey?: string }) => {
      expect(at(en, f.labelKey)).toEqual(expect.any(String));
      if (f.placeholderKey !== undefined) expect(at(en, f.placeholderKey)).toEqual(expect.any(String));
    };
    for (const p of PROVIDERS) for (const f of p.credentials.fields(p.settings.defaults)) check(f);
    // Positive control: the fake's own fields are empty at its defaults (requireKey off).
    for (const f of fakeProvider.credentials.fields({ ...FAKE_DEFAULTS, requireKey: true })) check(f);
  });

  it('a managed provider has no credential field and reads from the sign-in', () => {
    const managed = PROVIDERS.filter((p) => p.kind === 'managed');
    // The leased fake makes this non-vacuous.
    expect(managed.length).toBeGreaterThan(0);
    for (const p of managed) {
      expect(p.credentials.keys, p.id).toEqual([]);
      expect(p.credentials.fields(p.settings.defaults), p.id).toEqual([]);
      expect(p.credentials.read({}, signedOut), p.id).toMatchObject({ missing: expect.any(String), code: 'sign_in_required' });
      expect(p.credentials.read({}, signedIn), p.id).not.toHaveProperty('missing');
    }
  });

  it('an own-key provider reads its empty fields as missing', () => {
    const check = (p: AnyProvider, s: unknown) => {
      const fields = p.credentials.fields(s);
      if (fields.length === 0) return;
      const empty = Object.fromEntries(fields.map((f: { key: string }) => [f.key, '']));
      expect(p.credentials.read(empty, signedOut), p.id).toHaveProperty('missing');
    };
    for (const p of PROVIDERS.filter((p) => p.kind === 'own-key')) check(p, p.settings.defaults);
    // Positive control: the fake's default settings show no field at all.
    check(fakeProvider, { ...FAKE_DEFAULTS, requireKey: true });
  });

  it('migrate turns the defaults, stored as they are, into the defaults', () => {
    const withMigrate = PROVIDERS.filter((p) => p.settings.migrate !== undefined);
    expect(withMigrate.length).toBeGreaterThan(0);
    for (const p of withMigrate) {
      const credentials = Object.fromEntries(p.credentials.keys.map((k) => [k, '']));
      expect(p.settings.migrate!(p.settings.defaults, { legacy: {}, credentials }), p.id).toEqual(p.settings.defaults);
    }
  });

  it('an initial pair is one the provider offers', () => {
    const withInitial = PROVIDERS.filter((p) => p.languages.initial !== undefined);
    expect(withInitial.length).toBeGreaterThan(0);
    for (const p of withInitial) {
      const initial = p.languages.initial!(p.settings.defaults);
      expect(normalizePair(p, p.settings.defaults, initial), p.id).toEqual(initial);
    }
  });

  it("the release offers its providers in the owner's order", async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    const released = await import('./registry');
    // each provider plan adds its id where the owner orders it (spec: "one line in the order test")
    expect(released.PROVIDERS.map((p) => p.id)).toEqual(['localInference']);
  });

  it('a development build adds exactly the two fakes', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual([...released.map((p) => p.id), 'fake', 'fake_leased']);
  });
});
