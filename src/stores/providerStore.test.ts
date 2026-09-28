import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AnyProvider, CheckContext, LanguageContext, LanguageOption, LanguagePair, MigrationInputs } from '../lib/provider/types';

const { stored, getSetting, setSetting } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  return {
    stored,
    getSetting: vi.fn(async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def)),
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: { getSettingsService: () => ({ getSetting, setSetting }) },
}));

import { useProviderStore } from './providerStore';

const opt = (value: string): LanguageOption => ({ value, name: value, englishName: value });

interface ProbeSettings { region: 'us' | 'eu'; count: number; on: boolean }
/** Turning `on` stops offering fr, as a model choice can narrow a provider's languages. */
const langs = (s: ProbeSettings) => [opt('en'), opt('ja'), ...(s.on ? [] : [opt('fr')])];

const probe = {
  id: 'probe',
  kind: 'own-key',
  settings: { key: 'probe', defaults: { region: 'us', count: 1, on: false } satisfies ProbeSettings },
  credentials: {
    keys: ['apiKey', 'apiKeyEu'],
    fields: (s: ProbeSettings) => [{ key: s.region === 'eu' ? 'apiKeyEu' : 'apiKey', labelKey: 'k', secret: true }],
    read: () => ({}),
  },
  languages: {
    sources: (s: ProbeSettings) => langs(s),
    targets: (source: string, s: ProbeSettings) => langs(s).filter((o) => o.value !== source),
  },
} as unknown as AnyProvider;

const entry = () => useProviderStore.getState().entries.probe;

beforeEach(() => {
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false });
});

describe('load', () => {
  it("reads each settings field at settings.<key>.<field>, with that field's default", async () => {
    stored.set('settings.probe.count', 7);
    await useProviderStore.getState().load(probe);
    expect(getSetting).toHaveBeenCalledWith('settings.probe.count', 1);
    expect(getSetting).toHaveBeenCalledWith('settings.probe.on', false);
    expect(entry().settings).toEqual({ region: 'us', count: 7, on: false });
  });

  it('runs migrate over what was stored', async () => {
    const migrating = {
      ...probe,
      settings: { ...probe.settings, migrate: (s: Record<string, unknown>) => ({ ...s, count: Number(s.count) * 10 }) },
    } as AnyProvider;
    stored.set('settings.probe.count', 2);
    await useProviderStore.getState().load(migrating);
    expect(entry().settings).toMatchObject({ count: 20 });
  });

  it('reads credentials as strings under their own keys, apart from the settings', async () => {
    stored.set('settings.probe.apiKey', 'sk-1');
    await useProviderStore.getState().load(probe);
    expect(getSetting).toHaveBeenCalledWith('settings.probe.apiKey', '');
    expect(entry().credentials).toEqual({ apiKey: 'sk-1', apiKeyEu: '' });
    expect(entry().settings).not.toHaveProperty('apiKey');
  });

  it('keeps a stored pair the provider offers', async () => {
    stored.set('settings.probe.sourceLanguage', 'ja');
    stored.set('settings.probe.targetLanguage', 'fr');
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'ja', target: 'fr' });
  });

  it('repairs a stored pair the provider does not offer', async () => {
    stored.set('settings.probe.sourceLanguage', 'xx');
    stored.set('settings.probe.targetLanguage', 'en');
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'en', target: 'ja' });
  });

  it('starts from the first source and its first target when nothing is stored', async () => {
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'en', target: 'ja' });
  });

  it('does not overwrite a provider that is already loaded', async () => {
    await useProviderStore.getState().load(probe);
    setSetting.mockImplementationOnce(async () => ({ success: true }));
    useProviderStore.getState().updateSettings(probe, { count: 5 });
    await useProviderStore.getState().load(probe);
    expect(entry().settings).toMatchObject({ count: 5 });
  });

  it('reads each legacy key with no default — absent as undefined — and hands them and the credentials to migrate', async () => {
    const migrate = vi.fn((stored: Record<string, unknown>) => stored);
    const p = {
      ...probe,
      settings: { ...probe.settings, legacyKeys: ['turnDetectionMode', 'on'], migrate },
    } as unknown as AnyProvider;
    stored.set('settings.probe.turnDetectionMode', 'Semantic');
    stored.set('settings.probe.apiKey', 'k1');
    await useProviderStore.getState().load(p);
    expect(getSetting).toHaveBeenCalledWith('settings.probe.turnDetectionMode', undefined);
    expect(migrate).toHaveBeenCalledWith(
      { region: 'us', count: 1, on: false },
      { legacy: { turnDetectionMode: 'Semantic', on: undefined }, credentials: { apiKey: 'k1', apiKeyEu: '' } },
    );
  });

  it('tells a field stored as its default from a field never stored', async () => {
    const migrate = vi.fn((stored: Record<string, unknown>, _inputs: MigrationInputs) => stored);
    const p = { ...probe, settings: { ...probe.settings, legacyKeys: ['on'], migrate } } as unknown as AnyProvider;
    stored.set('settings.probe.on', false);
    await useProviderStore.getState().load(p);
    expect(migrate.mock.calls[0][1]).toMatchObject({ legacy: { on: false } });
  });

  it('reads a legacy key that names a whole storage key at that key, under that name (Stage 2 Gemini, choice 1)', async () => {
    const migrate = vi.fn((s: Record<string, unknown>, _inputs: MigrationInputs) => s);
    const p = { ...probe, settings: { ...probe.settings, legacyKeys: ['settings.common.systemInstructions', 'on'], migrate } } as unknown as AnyProvider;
    stored.set('settings.common.systemInstructions', 'global');
    await useProviderStore.getState().load(p);
    expect(getSetting).toHaveBeenCalledWith('settings.common.systemInstructions', undefined);
    expect(getSetting).not.toHaveBeenCalledWith('settings.probe.settings.common.systemInstructions', undefined);
    expect(migrate.mock.calls[0][1]).toMatchObject({ legacy: { 'settings.common.systemInstructions': 'global', on: undefined } });
    // Read, never written, moved or blanked: load writes nothing, and the global stays where it was.
    expect(setSetting).not.toHaveBeenCalled();
    expect(stored.get('settings.common.systemInstructions')).toBe('global');
  });

  it('rewrites the stored pair before it is normalized, so a renamed code lands on its new spelling', async () => {
    const p = {
      ...probe,
      languages: { ...probe.languages, migratePair: (pair: LanguagePair) => ({ ...pair, source: pair.source === 'vn' ? 'fr' : pair.source }) },
    } as unknown as AnyProvider;
    stored.set('settings.probe.sourceLanguage', 'vn');
    stored.set('settings.probe.targetLanguage', 'en');
    await useProviderStore.getState().load(p);
    expect(entry().pair).toEqual({ source: 'fr', target: 'en' });
  });

  it('falls back to the initial pair for a side migratePair empties', async () => {
    const p = {
      ...probe,
      languages: {
        ...probe.languages,
        migratePair: (pair: LanguagePair) => ({ ...pair, source: '' }),
        initial: () => ({ source: 'ja', target: 'en' }),
      },
    } as unknown as AnyProvider;
    stored.set('settings.probe.sourceLanguage', 'en');
    stored.set('settings.probe.targetLanguage', 'fr');
    await useProviderStore.getState().load(p);
    // The emptied source takes the initial one; the target keeps what was stored, not the initial en.
    expect(entry().pair).toEqual({ source: 'ja', target: 'fr' });
  });

  it("hands migratePair '' for a side nothing stored, and the migrated settings", async () => {
    const migratePair = vi.fn((pair: LanguagePair) => pair);
    const p = { ...probe, languages: { ...probe.languages, migratePair } } as unknown as AnyProvider;
    await useProviderStore.getState().load(p);
    expect(migratePair).toHaveBeenCalledWith({ source: '', target: '' }, { region: 'us', count: 1, on: false });
  });

  describe('initial', () => {
    const withInitial = {
      ...probe,
      languages: { ...probe.languages, initial: () => ({ source: 'ja', target: 'en' }) },
    } as unknown as AnyProvider;

    it("starts from the provider's initial pair when nothing is stored", async () => {
      await useProviderStore.getState().load(withInitial);
      expect(entry().pair).toEqual({ source: 'ja', target: 'en' });
    });

    it('prefers a stored pair to the initial one', async () => {
      stored.set('settings.probe.sourceLanguage', 'en');
      stored.set('settings.probe.targetLanguage', 'fr');
      await useProviderStore.getState().load(withInitial);
      expect(entry().pair).toEqual({ source: 'en', target: 'fr' });
    });

    it('repairs an initial pair the provider does not offer', async () => {
      const withBadInitial = {
        ...probe,
        languages: { ...probe.languages, initial: () => ({ source: 'xx', target: 'en' }) },
      } as unknown as AnyProvider;
      await useProviderStore.getState().load(withBadInitial);
      expect(entry().pair).toEqual({ source: 'en', target: 'ja' });
    });
  });
});

describe('writes', () => {
  it('merges a settings patch and persists each patched field', async () => {
    await useProviderStore.getState().load(probe);
    useProviderStore.getState().updateSettings(probe, { count: 3 });
    expect(entry().settings).toEqual({ region: 'us', count: 3, on: false });
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.probe.count', 3));
  });

  it('moves the pair when new settings stop offering it, and persists only what moved', async () => {
    stored.set('settings.probe.targetLanguage', 'fr');
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'en', target: 'fr' });
    useProviderStore.getState().updateSettings(probe, { on: true });
    expect(entry().pair).toEqual({ source: 'en', target: 'ja' });
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.probe.targetLanguage', 'ja'));
    expect(setSetting).not.toHaveBeenCalledWith('settings.probe.sourceLanguage', expect.anything());
  });

  it('saves a credential under its key without touching the settings', async () => {
    await useProviderStore.getState().load(probe);
    useProviderStore.getState().setCredential(probe, 'apiKeyEu', 'eu-1');
    expect(entry().credentials.apiKeyEu).toBe('eu-1');
    expect(entry().settings).toEqual({ region: 'us', count: 1, on: false });
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.probe.apiKeyEu', 'eu-1'));
  });

  it('saves a new pair', async () => {
    await useProviderStore.getState().load(probe);
    useProviderStore.getState().setPair(probe, { source: 'ja', target: 'en' });
    expect(entry().pair).toEqual({ source: 'ja', target: 'en' });
    await vi.waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith('settings.probe.sourceLanguage', 'ja');
      expect(setSetting).toHaveBeenCalledWith('settings.probe.targetLanguage', 'en');
    });
  });

  it('refuses a credential key the provider does not declare', async () => {
    await useProviderStore.getState().load(probe);
    expect(() => useProviderStore.getState().setCredential(probe, 'count', 'x')).toThrow(
      'Provider "probe" has no credential "count"',
    );
    expect(entry().credentials).toEqual({ apiKey: '', apiKeyEu: '' });
    expect(setSetting).not.toHaveBeenCalledWith('settings.probe.count', 'x');
  });

  it('refuses writes to a provider that is not loaded', () => {
    expect(() => useProviderStore.getState().updateSettings(probe, { count: 2 })).toThrow('Provider "probe" is not loaded');
    expect(() => useProviderStore.getState().setCredential(probe, 'apiKey', 'x')).toThrow('Provider "probe" is not loaded');
    expect(() => useProviderStore.getState().setPair(probe, { source: 'en', target: 'ja' })).toThrow('Provider "probe" is not loaded');
  });

  it('remembers the chosen provider', () => {
    expect(useProviderStore.getState().selected).toBeNull();
    useProviderStore.getState().select('probe');
    expect(useProviderStore.getState().selected).toBe('probe');
  });

  it('persists a pick under the old enum spelling; a load writes nothing', async () => {
    useProviderStore.getState().select('localInference', 'pick');
    expect(useProviderStore.getState().selected).toBe('localInference');
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.common.provider', 'local_inference'));

    setSetting.mockClear();
    useProviderStore.getState().select('fake', 'pick');
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.common.provider', 'fake'));

    setSetting.mockClear();
    useProviderStore.getState().select('localInference');
    useProviderStore.getState().select('localInference', 'load');
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('refuses a locked pick, so it writes nothing either', () => {
    useProviderStore.getState().select('probe');
    useProviderStore.getState().setSelectionLocked(true);
    useProviderStore.getState().select('x', 'pick');
    expect(useProviderStore.getState().selected).toBe('probe');
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.provider', expect.anything());
    useProviderStore.getState().setSelectionLocked(false);
  });

  it('refuses a new choice while the selection is locked, and takes it once unlocked', () => {
    useProviderStore.getState().select('probe');
    useProviderStore.getState().setSelectionLocked(true);
    useProviderStore.getState().select('x');
    expect(useProviderStore.getState().selected).toBe('probe');

    useProviderStore.getState().setSelectionLocked(false);
    useProviderStore.getState().select('x');
    expect(useProviderStore.getState().selected).toBe('x');
  });

  it('notifies subscribers only when the lock changes', () => {
    // `attach()` sets it on every runner state change; an unchanged value must not wake the store's readers.
    const listener = vi.fn();
    const off = useProviderStore.subscribe(listener);
    useProviderStore.getState().setSelectionLocked(true);
    useProviderStore.getState().setSelectionLocked(true);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
});

describe('the language context (Stage 2 Volcengine AST2, choice 1)', () => {
  /** Speaking offers en and ja; text also ko — Doubao AST 2.0's shape. */
  const offered = (context?: LanguageContext) => [opt('en'), opt('ja'), ...(context?.speech ? [] : [opt('ko')])];
  const moody = {
    ...probe,
    id: 'moody',
    speech: 'optional',
    settings: { key: 'moody', defaults: probe.settings.defaults },
    languages: {
      sources: (_s: ProbeSettings, context?: LanguageContext) => offered(context),
      targets: (source: string, _s: ProbeSettings, context?: LanguageContext) => offered(context).filter((o) => o.value !== source),
    },
  } as unknown as AnyProvider;
  const moodyEntry = () => useProviderStore.getState().entries.moody;
  const speaking = { textOnly: false, participantSpeech: false };
  const textOnly = { textOnly: true, participantSpeech: false };
  const pairWrites = () => setSetting.mock.calls.filter(([key]) => /Language$/.test(String(key)));

  beforeEach(() => {
    useProviderStore.setState({ legs: ['speaker'], speech: speaking, readiness: {} });
    stored.set('settings.moody.sourceLanguage', 'ko');
    stored.set('settings.moody.targetLanguage', 'en');
  });

  it("derives the pair a speaking run can start from a text-only one, keeping the user's as stored, writing nothing", async () => {
    await useProviderStore.getState().load(moody);
    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
    expect(moodyEntry().stored).toEqual({ source: 'ko', target: 'en' });
    expect(pairWrites()).toEqual([]);
  });

  it("brings the stored pair back when the run stops speaking, and drops it from the entry: it is the pair again", async () => {
    await useProviderStore.getState().load(moody);
    useProviderStore.getState().setSpeech(textOnly);
    expect(moodyEntry().pair).toEqual({ source: 'ko', target: 'en' });
    expect(moodyEntry()).not.toHaveProperty('stored');
    useProviderStore.getState().setSpeech(speaking);
    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
    // Narrowed away again, the user's pair is kept beside it, so the next text-only run gets it back.
    expect(moodyEntry().stored).toEqual({ source: 'ko', target: 'en' });
    useProviderStore.getState().setSpeech(textOnly);
    expect(moodyEntry().pair).toEqual({ source: 'ko', target: 'en' });
    expect(pairWrites()).toEqual([]);
  });

  it('reads the legs as part of the context: a participant-only run with its switch off does not speak', async () => {
    await useProviderStore.getState().load(moody);
    useProviderStore.getState().setLegs(['participant']);
    expect(moodyEntry().pair).toEqual({ source: 'ko', target: 'en' });
    useProviderStore.getState().setSpeech({ textOnly: false, participantSpeech: true });
    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
  });

  it('derives the same pair whichever lands first, the load or the inputs', async () => {
    useProviderStore.getState().setSpeech(textOnly);
    await useProviderStore.getState().load(moody);
    expect(moodyEntry().pair).toEqual({ source: 'ko', target: 'en' });
    useProviderStore.setState({ entries: {} });
    useProviderStore.getState().setSpeech(speaking);
    await useProviderStore.getState().load(moody);
    // The load derives from the inputs already kept: what a speaking run can start, the user's pair beside it.
    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
    expect(moodyEntry().stored).toEqual({ source: 'ko', target: 'en' });
    useProviderStore.getState().setSpeech(textOnly);
    expect(moodyEntry().pair).toEqual({ source: 'ko', target: 'en' });
  });

  it('keeps a pick as picked — one the context cannot run stays stored for the one that can — and persists it', async () => {
    stored.clear();
    await useProviderStore.getState().load(moody);
    useProviderStore.getState().setPair(moody, { source: 'ko', target: 'ja' });
    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
    expect(moodyEntry().stored).toEqual({ source: 'ko', target: 'ja' });
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.moody.sourceLanguage', 'ko'));
    // A pick the context runs is the pair, and nothing is kept beside it.
    useProviderStore.getState().setPair(moody, { source: 'ja', target: 'en' });
    expect(moodyEntry().pair).toEqual({ source: 'ja', target: 'en' });
    expect(moodyEntry()).not.toHaveProperty('stored');
  });

  it('persists a pick from the stored pair, not the shown one: picking the pair on show replaces the one kept', async () => {
    await useProviderStore.getState().load(moody);
    // Speaking shows en → ja while ko → en is kept; the wizard's Finish applies the shown pair.
    useProviderStore.getState().setPair(moody, { source: 'en', target: 'ja' });
    expect(moodyEntry()).not.toHaveProperty('stored');
    await vi.waitFor(() => {
      expect(stored.get('settings.moody.sourceLanguage')).toBe('en');
      expect(stored.get('settings.moody.targetLanguage')).toBe('ja');
    });
  });

  it("keeps the stored pair across a settings edit, writing only the settings", async () => {
    await useProviderStore.getState().load(moody);
    useProviderStore.getState().updateSettings(moody, { count: 2 });
    expect(moodyEntry().stored).toEqual({ source: 'ko', target: 'en' });
    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.moody.count', 2));
    expect(pairWrites()).toEqual([]);
  });

  it("forgets the readiness of a provider whose pair moved, and only that one's; the same inputs change nothing", async () => {
    await useProviderStore.getState().load(moody);
    await useProviderStore.getState().load(probe);
    const ready = { state: 'ready' as const, models: [] };
    useProviderStore.setState({ readiness: { moody: ready, probe: ready } });
    const entries = useProviderStore.getState().entries;
    // appShape's whole-store listeners call it on every settings, routing or audio change: the same inputs wake no reader.
    const listener = vi.fn();
    const off = useProviderStore.subscribe(listener);
    useProviderStore.getState().setSpeech(speaking);
    off();
    expect(listener).not.toHaveBeenCalled();
    expect(useProviderStore.getState().entries).toBe(entries);
    useProviderStore.getState().setSpeech(textOnly);
    expect(useProviderStore.getState().readiness.moody).toEqual({ state: 'unknown' });
    expect(useProviderStore.getState().readiness.probe).toBe(ready);
    // A provider whose languages ignore the context never carries a stored pair.
    expect(entry()).not.toHaveProperty('stored');
  });
});

describe('refreshReadiness', () => {
  const auth = { signedIn: false, getToken: async () => null };

  it('asks check about the pair, and forgets readiness when the pair changes', async () => {
    const check = vi.fn(async (_k: unknown, _s: unknown, _ctx: CheckContext) => ({ ok: true as const }));
    const p = { ...probe, check };
    await useProviderStore.getState().load(p);
    await useProviderStore.getState().refreshReadiness(p, auth);
    expect(check.mock.calls[0][2]).toMatchObject({ pair: useProviderStore.getState().entries[p.id].pair });
    useProviderStore.getState().setPair(p, { source: 'ja', target: 'en' });
    expect(useProviderStore.getState().readiness[p.id]).toEqual({ state: 'unknown' });
  });

  it("checks the inputs it is given — a run's shape — instead of the live entry", async () => {
    const check = vi.fn(async (_k: unknown, _s: unknown, _ctx: CheckContext) => ({ ok: true as const }));
    const p = { ...probe, check };
    await useProviderStore.getState().load(p);
    const from = { settings: { ...p.settings.defaults, marker: 1 }, credentials: {}, pair: { source: 'en', target: 'ja' }, legs: ['speaker', 'participant'] as const };
    await useProviderStore.getState().refreshReadiness(p, auth, from);
    expect(check.mock.calls[0][1]).toBe(from.settings);
    expect(check.mock.calls[0][2]).toMatchObject({ pair: from.pair, legs: from.legs });
  });
});
