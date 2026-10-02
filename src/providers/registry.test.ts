import { describe, it, expect, afterEach, vi } from 'vitest';
import { isPresent } from '../lib/provider/presence';
import { AUTO, normalizePair } from '../lib/provider/languages';
import type { AnyProvider, AuthContext } from '../lib/provider/types';
import { parseCode } from '../lib/language/code';
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

  it('a release build offers Kizuna Soniox first on every platform, unflagged: the Kizuna umbrella alone decides it (ruling 6)', () => {
    for (const platform of ['electron', 'extension', 'web'] as const) {
      // No provider enabled by name and no tester switch on: nothing but the umbrella can bring it in.
      const offered = presentProviders({ platform, dev: false, enabled: new Set(), kizuna: true, switchOn: () => false });
      expect(offered[0].id, platform).toBe('kizunaai_soniox');
      expect(offered[0].flagged, platform).not.toBe(true);
      const withoutUmbrella = presentProviders({ platform, dev: false, enabled: new Set(), kizuna: false, switchOn: () => false });
      expect(withoutUmbrella.map((p) => p.id), platform).not.toContain('kizunaai_soniox');
    }
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

  it('lets only LocalInference read the pair and the legs in its check, so a pick or an audio-mode switch checks no network provider again', () => {
    expect(PROVIDERS.filter((p) => p.checkReadsDirection).map((p) => p.id)).toEqual(['localInference']);
  });

  it('declares the settings each own-key check reads, so an edit to any other field checks nothing again', () => {
    const ownKey = released.filter((p) => p.kind === 'own-key');
    expect(Object.fromEntries(ownKey.map((p) => [p.id, p.checkReads]))).toEqual({
      gemini: [],
      volcengine_ast2: ['authMode'],
      openai: [],
      openai_translate: [],
      openai_live: [],
      // The region picks the key field (`sonioxKeyField`).
      soniox: ['region'],
      palabraai: ['authMode'],
    });
  });

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
    // Positive control: the fake shows no field at its defaults; the override
    // (`requireKey: true`) is what makes its key field appear, so the check has something to read.
    for (const f of fakeProvider.credentials.fields({ ...FAKE_DEFAULTS, requireKey: true })) check(f);
  });

  it('a credential choice (F4) names a setting whose default it offers, has two options or more, each worded in en, each showing fields among its keys, labelled in en', () => {
    const offenders = (ps: readonly AnyProvider[]) => ps.flatMap((p) => {
      const choice = p.credentials.choice;
      if (!choice) return [];
      const defaults = p.settings.defaults as Record<string, unknown>;
      const out: string[] = [];
      if (!choice.options.some((o) => o.value === defaults[choice.setting])) out.push(`${p.id}: default ${String(defaults[choice.setting])}`);
      if (choice.options.length < 2) out.push(`${p.id}: one option`);
      for (const o of choice.options) {
        if (typeof at(en, o.labelKey) !== 'string') out.push(`${p.id}: ${o.labelKey}`);
        for (const f of p.credentials.fields({ ...defaults, [choice.setting]: o.value })) {
          if (!p.credentials.keys.includes(f.key)) out.push(`${p.id}: ${o.value} shows ${f.key}`);
          if (typeof at(en, f.labelKey) !== 'string') out.push(`${p.id}: ${f.labelKey}`);
        }
      }
      return out;
    });
    expect(offenders(PROVIDERS)).toEqual([]);
    // The control, so the case bites before a registered provider has a choice.
    const bad = { ...fakeProvider, id: 'bad', credentials: { ...fakeProvider.credentials, choice: { setting: 'script', options: [{ value: 'nope', labelKey: 'no.such.key' }] } } } as AnyProvider;
    expect(offenders([bad])).toEqual(['bad: default exchange', 'bad: one option', 'bad: no.such.key']);
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
    // Positive control: the fake shows no field at its defaults; the override
    // (`requireKey: true`) is what makes its key field appear, so the check has an empty field to read.
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

  it("a provider's checkReads names only fields of its settings (Stage 2 OpenAI Realtime, ruling 9)", () => {
    const offenders = (ps: readonly Pick<AnyProvider, 'id' | 'settings' | 'checkReads'>[]) =>
      ps.flatMap((p) => (p.checkReads ?? []).filter((field: string) => !Object.keys(p.settings.defaults as object).includes(field)).map((field: string) => `${p.id}: ${field}`));
    expect(offenders(PROVIDERS)).toEqual([]);
    // The control: a name that is no field.
    expect(offenders([{ id: 'x', settings: { key: 'x', defaults: { a: 1 } }, checkReads: ['a', 'b'] }])).toEqual(['x: b']);
  });

  it("a provider with no reverse of its own offers no target outside its sources, in every settings shape its offer reads and every language context: the plain swap reverses what it offers (Stage 2 Palabra, ruling 9)", () => {
    const opt = (value: string) => ({ value, name: value, englishName: value });
    // Each provider's defaults, and the shapes whose offer differs from theirs, by name: Gemini's offer reads its saved model's family (Stage 2 Gemini/AST2 follow-up, choice 16) — Live Translate's, a 2.5 native-audio dialogue model's, a 3.x Live dialogue model's.
    const SHAPES: Readonly<Record<string, readonly Record<string, unknown>[]>> = {
      gemini: [{ model: 'gemini-3.5-live-translate-preview' }, { model: 'gemini-2.5-flash-native-audio-preview-12-2025' }, { model: 'gemini-3.1-flash-live-preview' }],
    };
    const shapesOf = (p: AnyProvider): unknown[] => [p.settings.defaults, ...(SHAPES[p.id] ?? []).map((patch) => ({ ...(p.settings.defaults as object), ...patch }))];
    const offenders = (ps: readonly AnyProvider[]) => ps.flatMap((p) => {
      if (p.languages.reverse) return [];
      return shapesOf(p).flatMap((s, shape) => [undefined, { speech: true }, { speech: false }].flatMap((context) => {
        const sources = new Set(p.languages.sources(s, context).map((o: { value: string }) => o.value));
        const outside = new Set([...sources].flatMap((source) => p.languages.targets(source, s, context).map((o: { value: string }) => o.value)).filter((t) => !sources.has(t)));
        return [...outside].map((t) => `${p.id}: ${t} (shape ${shape}, speech ${String(context?.speech)})`);
      }));
    });
    expect(offenders(PROVIDERS)).toEqual([]);
    // The declared shapes reach both of Gemini's offers: the list names no stale shape.
    const gemini = PROVIDERS.find((p) => p.id === 'gemini')!;
    expect(new Set(shapesOf(gemini).map((s) => gemini.languages.sources(s).length)).size).toBe(2);
    // The control: a region target none of its sources names, with no reverse of its own — and with one, which states its own answer.
    const regional = { ...fakeProvider, id: 'regional', languages: { sources: () => [opt('en')], targets: () => [opt('en-us')] } } as unknown as AnyProvider;
    expect(offenders([regional])).toEqual(['regional: en-us (shape 0, speech undefined)', 'regional: en-us (shape 0, speech true)', 'regional: en-us (shape 0, speech false)']);
    expect(offenders([{ ...regional, languages: { ...regional.languages, reverse: () => null } } as AnyProvider])).toEqual([]);
  });

  it('an initial pair is one the provider offers', () => {
    const withInitial = PROVIDERS.filter((p) => p.languages.initial !== undefined);
    expect(withInitial.length).toBeGreaterThan(0);
    for (const p of withInitial) {
      const initial = p.languages.initial!(p.settings.defaults);
      expect(normalizePair(p, p.settings.defaults, initial), p.id).toEqual(initial);
    }
  });

  it('offers, in each language context, a target for every source and only languages of its widest offer, and when speaking only what it offers as text (Stage 2 Volcengine AST2, choice 1)', () => {
    /**
     * Where an offer under a context leaves the widest one, or runs dry: the stored pair is kept within the widest (`providerStore`).
     * Where the speaking offer leaves the text one: a run speaks when any leg does, so a text-only speaker
     * in a speaking run takes its pair from the speaking offer — sound only while text offers it too.
     */
    const outside = (ps: readonly AnyProvider[]) => ps.flatMap((p) => {
      const s = p.settings.defaults;
      const widest = new Set(p.languages.sources(s).map((o) => o.value));
      const textSources = new Set(p.languages.sources(s, { speech: false }).map((o) => o.value));
      return [true, false].flatMap((speech) => {
        const sources = p.languages.sources(s, { speech });
        return [
          ...(sources.length > 0 ? [] : [`${p.id}: no source (speech ${speech})`]),
          ...sources.flatMap((source) => {
            const wide = new Set(p.languages.targets(source.value, s).map((o) => o.value));
            const textTargets = new Set(p.languages.targets(source.value, s, { speech: false }).map((o) => o.value));
            const targets = p.languages.targets(source.value, s, { speech });
            return [
              ...(widest.has(source.value) ? [] : [`${p.id}: source ${source.value} (speech ${speech})`]),
              ...(!speech || textSources.has(source.value) ? [] : [`${p.id}: source ${source.value} (speech true, not speech false)`]),
              ...(targets.length > 0 ? [] : [`${p.id}: no target for ${source.value} (speech ${speech})`]),
              ...targets.filter((t) => t.value === AUTO || !wide.has(t.value)).map((t) => `${p.id}: ${source.value} → ${t.value} (speech ${speech})`),
              ...(!speech ? [] : targets.filter((t) => !textTargets.has(t.value)).map((t) => `${p.id}: ${source.value} → ${t.value} (speech true, not speech false)`)),
            ];
          }),
        ];
      });
    });
    expect(outside(PROVIDERS)).toEqual([]);
    // The control, one call every arm is needed for: `growing` grows a source and a target under
    // speech, past its widest offer and its text one; `wider` speaks a source and a target its
    // widest offer holds and its text offer does not; `dry` runs out of targets under speech and
    // of sources under text, so its spoken `en` is not a text source either.
    const opt = (value: string) => ({ value, name: value, englishName: value });
    const growing = { ...fakeProvider, id: 'growing', languages: {
      sources: (_s: unknown, context?: { speech: boolean }) => [opt('en'), ...(context?.speech ? [opt('xx')] : [])],
      targets: (source: string, _s: unknown, context?: { speech: boolean }) => [opt('ja'), ...(context?.speech && source === 'en' ? [opt('yy')] : [])],
    } } as unknown as AnyProvider;
    const wider = { ...fakeProvider, id: 'wider', languages: {
      sources: (_s: unknown, context?: { speech: boolean }) => [opt('en'), ...(context?.speech === false ? [] : [opt('ko')])],
      targets: (source: string, _s: unknown, context?: { speech: boolean }) => [opt('ja'), ...(context?.speech === false || source !== 'en' ? [] : [opt('ko')])],
    } } as unknown as AnyProvider;
    const dry = { ...fakeProvider, id: 'dry', languages: {
      sources: (_s: unknown, context?: { speech: boolean }) => (context?.speech === false ? [] : [opt('en')]),
      targets: (_source: string, _s: unknown, context?: { speech: boolean }) => (context?.speech ? [] : [opt('ja')]),
    } } as unknown as AnyProvider;
    expect(outside([growing, wider, dry])).toEqual([
      'growing: en → yy (speech true)', 'growing: en → yy (speech true, not speech false)',
      'growing: source xx (speech true)', 'growing: source xx (speech true, not speech false)',
      'wider: en → ko (speech true, not speech false)', 'wider: source ko (speech true, not speech false)',
      'dry: source en (speech true, not speech false)', 'dry: no target for en (speech true)', 'dry: no source (speech false)',
    ]);
  });

  it("the release offers its providers in the owner's order", async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    const releaseBuild = await import('./registry');
    // each provider plan adds its id where the owner orders it (spec: "one line in the order test").
    // Kizuna Soniox first, unflagged (Stage 2 Kizuna Soniox, ruling 6): the owner's 2026-09-12
    // product order put the managed provider first; then LocalInference, Gemini (Stage 2 Gemini, ruling 6), Doubao AST 2.0 (Stage 2 Volcengine AST2, ruling 5), OpenAI Realtime (Stage 2 OpenAI Realtime, ruling 18), OpenAI Translate (Stage 2 OpenAI Translate, ruling 11), OpenAI Live (Stage 2 OpenAI Live, ruling 9), Soniox with your own key, and Palabra AI last (Stage 2 Palabra, ruling 14).
    expect(releaseBuild.PROVIDERS.map((p) => p.id)).toEqual(['kizunaai_soniox', 'localInference', 'gemini', 'volcengine_ast2', 'openai', 'openai_translate', 'openai_live', 'soniox', 'palabraai']);
  });

  it('a development build adds exactly the two fakes', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual([...released.map((p) => p.id), 'fake', 'fake_leased']);
  });
});

describe('language codes (unified language codes)', () => {
  const contexts = [undefined, { speech: true }, { speech: false }] as const;
  it.each(PROVIDERS.map((p) => [p.id, p] as const))('%s offers app codes its wire table can send and read back', (_id, p) => {
    const s = p.settings.defaults;
    for (const context of contexts) {
      for (const source of p.languages.sources(s, context)) {
        expect(parseCode(source.value), `${p.id} source ${source.value}`).not.toBeNull();
        expect(Object.keys(source), `${p.id} ${source.value}`).toEqual(['value']);
        const sent = p.languages.wire.toWire(source.value);
        if (p.languages.wire.codes.length > 0) expect(p.languages.wire.fromWire(sent)).toBe(source.value);
        for (const target of p.languages.targets(source.value, s, context)) {
          expect(parseCode(target.value), `${p.id} target ${target.value}`).not.toBeNull();
          expect(() => p.languages.wire.toWire(target.value), `${p.id} target ${target.value}`).not.toThrow();
        }
      }
    }
  });
});
