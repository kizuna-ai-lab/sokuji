import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AnyProvider, CheckContext, LanguageContext, LanguageOption, MigrationInputs } from '../lib/provider/types';

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

import { identityWire } from '../lib/language/wire';
import { useProviderStore, PAIR_FIELDS } from './providerStore';

const opt = (value: string): LanguageOption => ({ value });

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
    wire: identityWire(),
  },
} as unknown as AnyProvider;

/** Offers en and de only: a pair the probe keeps, it cannot. */
const narrow = {
  ...probe,
  id: 'narrow',
  settings: { key: 'narrow', defaults: { region: 'us', count: 1, on: false } },
  languages: {
    sources: () => [opt('en'), opt('de')],
    targets: (source: string) => [opt('en'), opt('de')].filter((o) => o.value !== source),
    wire: probe.languages.wire,
  },
} as unknown as AnyProvider;

const entry = () => useProviderStore.getState().entries.probe;

beforeEach(() => {
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, intent: undefined });
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

  it('reads the one pair at settings.common.*, and shows it where the provider offers it', async () => {
    stored.set('settings.common.sourceLanguage', 'ja');
    stored.set('settings.common.targetLanguage', 'en');
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'ja', target: 'en' });
    expect(getSetting).not.toHaveBeenCalledWith('settings.probe.sourceLanguage', expect.anything());
  });

  it("starts from the provider's initial, then its first options, when nothing was picked", async () => {
    await useProviderStore.getState().load(probe);
    expect(entry().pair).toEqual({ source: 'en', target: 'ja' });
    expect(useProviderStore.getState().intent).toBeNull();
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
      stored.set('settings.common.sourceLanguage', 'en');
      stored.set('settings.common.targetLanguage', 'fr');
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
      expect(setSetting).toHaveBeenCalledWith('settings.common.sourceLanguage', 'ja');
      expect(setSetting).toHaveBeenCalledWith('settings.common.targetLanguage', 'en');
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
    // Its check reads the pair, so a pair the context moves forgets its answer.
    checkReadsDirection: true,
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
    stored.set('settings.common.sourceLanguage', 'ko');
    stored.set('settings.common.targetLanguage', 'en');
  });
  const intent = () => useProviderStore.getState().intent;

  it("derives the pair a speaking run can start from a text-only one, keeping the user's as stored, writing nothing", async () => {
    await useProviderStore.getState().load(moody);
    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
    expect(intent()).toEqual({ source: 'ko', target: 'en' });
    expect(pairWrites()).toEqual([]);
  });

  it("brings the stored pair back when the run stops speaking, and drops it from the entry: it is the pair again", async () => {
    await useProviderStore.getState().load(moody);
    useProviderStore.getState().setSpeech(textOnly);
    expect(moodyEntry().pair).toEqual({ source: 'ko', target: 'en' });
    expect(intent()).toEqual({ source: 'ko', target: 'en' });
    useProviderStore.getState().setSpeech(speaking);
    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
    // Narrowed away again, the user's pair is kept beside it, so the next text-only run gets it back.
    expect(intent()).toEqual({ source: 'ko', target: 'en' });
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
    expect(intent()).toEqual({ source: 'ko', target: 'en' });
    useProviderStore.getState().setSpeech(textOnly);
    expect(moodyEntry().pair).toEqual({ source: 'ko', target: 'en' });
  });

  it('keeps a pick as picked — one the context cannot run stays stored for the one that can — and persists it', async () => {
    stored.clear();
    await useProviderStore.getState().load(moody);
    useProviderStore.getState().setPair(moody, { source: 'ko', target: 'ja' });
    expect(moodyEntry().pair).toEqual({ source: 'en', target: 'ja' });
    expect(intent()).toEqual({ source: 'ko', target: 'ja' });
    await vi.waitFor(() => expect(setSetting).toHaveBeenCalledWith('settings.common.sourceLanguage', 'ko'));
    // A pick the context runs is the pair, and nothing is kept beside it.
    useProviderStore.getState().setPair(moody, { source: 'ja', target: 'en' });
    expect(moodyEntry().pair).toEqual({ source: 'ja', target: 'en' });
    expect(intent()).toEqual({ source: 'ja', target: 'en' });
  });

  it('persists a pick from the stored pair, not the shown one: picking the pair on show replaces the one kept', async () => {
    await useProviderStore.getState().load(moody);
    // Speaking shows en → ja while ko → en is kept; the wizard's Finish applies the shown pair.
    useProviderStore.getState().setPair(moody, { source: 'en', target: 'ja' });
    expect(intent()).toEqual({ source: 'en', target: 'ja' });
    await vi.waitFor(() => {
      expect(stored.get('settings.common.sourceLanguage')).toBe('en');
      expect(stored.get('settings.common.targetLanguage')).toBe('ja');
    });
  });

  it("keeps the stored pair across a settings edit, writing only the settings", async () => {
    await useProviderStore.getState().load(moody);
    useProviderStore.getState().updateSettings(moody, { count: 2 });
    expect(intent()).toEqual({ source: 'ko', target: 'en' });
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
  });

  it('keeps the readiness of a provider whose check does not read the pair when the context moves its pair', async () => {
    const plain = { ...moody, checkReadsDirection: undefined } as unknown as AnyProvider;
    await useProviderStore.getState().load(plain);
    const ready = { state: 'ready' as const, models: [] };
    useProviderStore.setState({ readiness: { moody: ready } });
    useProviderStore.getState().setSpeech(speaking);
    const before = moodyEntry().pair;
    useProviderStore.getState().setSpeech(textOnly);
    expect(moodyEntry().pair).not.toEqual(before);
    expect(useProviderStore.getState().readiness.moody).toBe(ready);
  });
});

describe('the global pair (unified language codes)', () => {
  const pairOf = (id: string) => useProviderStore.getState().entries[id].pair;

  it('keeps the pair across providers; a side one lacks takes its first option and nothing is written', async () => {
    stored.set('settings.common.sourceLanguage', 'ja');
    stored.set('settings.common.targetLanguage', 'fr');
    await useProviderStore.getState().load(probe);
    await useProviderStore.getState().load(narrow);
    setSetting.mockClear();
    expect(pairOf('probe')).toEqual({ source: 'ja', target: 'fr' });
    expect(pairOf('narrow')).toEqual({ source: 'en', target: 'de' });
    useProviderStore.getState().select('narrow', 'pick');
    useProviderStore.getState().select('probe', 'pick');
    expect(pairOf('probe')).toEqual({ source: 'ja', target: 'fr' });
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.sourceLanguage', expect.anything());
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.targetLanguage', expect.anything());
  });

  it('writes a pick, both sides as shown, and every loaded provider follows it, forgetting the readiness of one whose check reads the pair', async () => {
    stored.set('settings.common.sourceLanguage', 'ja');
    stored.set('settings.common.targetLanguage', 'fr');
    await useProviderStore.getState().load({ ...probe, checkReadsDirection: true } as unknown as AnyProvider);
    await useProviderStore.getState().load(narrow);
    expect(pairOf('probe')).toEqual({ source: 'ja', target: 'fr' });
    useProviderStore.setState({ readiness: { ...useProviderStore.getState().readiness, probe: { state: 'ready', models: [] } } });
    useProviderStore.getState().setPair(narrow, { source: 'de', target: 'en' });
    expect(stored.get('settings.common.sourceLanguage')).toBe('de');
    expect(stored.get('settings.common.targetLanguage')).toBe('en');
    expect(pairOf('probe')).toEqual({ source: 'en', target: 'ja' });
    expect(useProviderStore.getState().readiness.probe).toEqual({ state: 'unknown' });
  });

  it('writes no pair when a settings edit narrows the offer, and brings it back when the edit is undone', async () => {
    stored.set('settings.common.sourceLanguage', 'ja');
    stored.set('settings.common.targetLanguage', 'fr');
    await useProviderStore.getState().load(probe);
    setSetting.mockClear();
    useProviderStore.getState().updateSettings(probe, { on: true });
    expect(pairOf('probe')).toEqual({ source: 'ja', target: 'en' });
    expect(setSetting).not.toHaveBeenCalledWith('settings.common.targetLanguage', expect.anything());
    useProviderStore.getState().updateSettings(probe, { on: false });
    expect(pairOf('probe')).toEqual({ source: 'ja', target: 'fr' });
  });

  it('shows a stored code no provider offers as the first options, and keeps it stored', async () => {
    stored.set('settings.common.sourceLanguage', 'zh+en');
    stored.set('settings.common.targetLanguage', 'zh+en');
    await useProviderStore.getState().load(narrow);
    expect(pairOf('narrow')).toEqual({ source: 'en', target: 'de' });
    expect(useProviderStore.getState().intent).toEqual({ source: 'zh+en', target: 'zh+en' });
  });
});

describe('refreshReadiness', () => {
  const auth = { signedIn: false, getToken: async () => null };

  it('asks check about the pair, and forgets readiness when the pair changes, for a check that reads it', async () => {
    const check = vi.fn(async (_k: unknown, _s: unknown, _ctx: CheckContext) => ({ ok: true as const }));
    const p = { ...probe, check, checkReadsDirection: true } as unknown as AnyProvider;
    await useProviderStore.getState().load(p);
    await useProviderStore.getState().refreshReadiness(p, auth);
    expect(check.mock.calls[0][2]).toMatchObject({ pair: useProviderStore.getState().entries[p.id].pair });
    useProviderStore.getState().setPair(p, { source: 'ja', target: 'en' });
    expect(useProviderStore.getState().readiness[p.id]).toEqual({ state: 'unknown' });
  });

  it('keeps readiness through a pick, and checks nothing again, for a check that does not read the pair', async () => {
    const check = vi.fn(async (_k: unknown, _s: unknown, _ctx: CheckContext) => ({ ok: true as const }));
    const p = { ...probe, check };
    await useProviderStore.getState().load(p);
    await useProviderStore.getState().refreshReadiness(p, auth);
    const ready = useProviderStore.getState().readiness[p.id];
    useProviderStore.getState().setPair(p, { source: 'ja', target: 'en' });
    expect(useProviderStore.getState().readiness[p.id]).toBe(ready);
    await useProviderStore.getState().refreshReadiness(p, auth);
    expect(check).toHaveBeenCalledTimes(1);
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

describe('flush', () => {
  const landNow = async (key: string, value: unknown) => {
    stored.set(key, value);
    return { success: true };
  };
  // The store keeps what did not land across tests (beforeEach resets its
  // state, not its write ledger): put storage back and drain it.
  afterEach(async () => {
    setSetting.mockImplementation(landNow);
    await useProviderStore.getState().flush();
  });

  /** Holds every write until released; `ok: false` refuses it as a full quota would. */
  const holdWrites = () => {
    const held: Array<{ key: string; release: (ok: boolean) => void }> = [];
    setSetting.mockImplementation((key: string, value: unknown) => new Promise<{ success: boolean; error?: string }>((resolve) => {
      held.push({ key, release: (ok) => {
        if (ok) stored.set(key, value);
        resolve(ok ? { success: true } : { success: false, error: 'QuotaExceededError' });
      } });
    }));
    return held;
  };

  it('resolves true at once when nothing is being written', async () => {
    await expect(useProviderStore.getState().flush()).resolves.toBe(true);
  });

  it('waits for every write the store started, and resolves true once all landed', async () => {
    await useProviderStore.getState().load(probe);
    const held = holdWrites();
    useProviderStore.getState().setCredential(probe, 'apiKey', 'k-1');
    useProviderStore.getState().setCredential(probe, 'apiKeyEu', 'k-2');
    let answer: boolean | undefined;
    const flushed = useProviderStore.getState().flush().then((ok) => { answer = ok; });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    const early = answer;
    // Released before any assertion: a held write would hold the drain in afterEach.
    for (const write of held.splice(0)) write.release(true);
    await flushed;
    expect(early).toBeUndefined();
    expect(answer).toBe(true);
    expect(stored.get('settings.probe.apiKey')).toBe('k-1');
    expect(stored.get('settings.probe.apiKeyEu')).toBe('k-2');
  });

  it('resolves false when a write did not land, and writes that value again on the next flush', async () => {
    await useProviderStore.getState().load(probe);
    setSetting.mockImplementationOnce(async () => ({ success: false, error: 'QuotaExceededError' }));
    useProviderStore.getState().setCredential(probe, 'apiKey', 'k-1');
    await expect(useProviderStore.getState().flush()).resolves.toBe(false);
    expect(stored.has('settings.probe.apiKey')).toBe(false);
    // Storage is back: the value the user left is written, nothing else.
    await expect(useProviderStore.getState().flush()).resolves.toBe(true);
    expect(stored.get('settings.probe.apiKey')).toBe('k-1');
  });

  it('resolves false again when the value written again is refused again', async () => {
    await useProviderStore.getState().load(probe);
    // Storage refuses every write until afterEach puts it back.
    setSetting.mockImplementation(async () => ({ success: false, error: 'QuotaExceededError' }));
    useProviderStore.getState().setCredential(probe, 'apiKey', 'k-1');
    await expect(useProviderStore.getState().flush()).resolves.toBe(false);
    await expect(useProviderStore.getState().flush()).resolves.toBe(false);
    expect(stored.has('settings.probe.apiKey')).toBe(false);
  });

  it('never writes again a value a newer write of the same key replaced', async () => {
    await useProviderStore.getState().load(probe);
    setSetting.mockImplementationOnce(async () => ({ success: false, error: 'QuotaExceededError' }));
    useProviderStore.getState().setCredential(probe, 'apiKey', 'old');
    await useProviderStore.getState().flush();
    useProviderStore.getState().setCredential(probe, 'apiKey', 'new');
    setSetting.mockClear();
    await expect(useProviderStore.getState().flush()).resolves.toBe(true);
    expect(setSetting).not.toHaveBeenCalledWith('settings.probe.apiKey', 'old');
    expect(stored.get('settings.probe.apiKey')).toBe('new');
  });

  it('never writes again a value whose write failed after a newer write of its key began', async () => {
    await useProviderStore.getState().load(probe);
    const held = holdWrites();
    useProviderStore.getState().setCredential(probe, 'apiKey', 'old');
    useProviderStore.getState().setCredential(probe, 'apiKey', 'new');
    held[1].release(true); // the newer write lands first
    held[0].release(false); // then the older one fails
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    setSetting.mockImplementation(landNow);
    setSetting.mockClear();
    await expect(useProviderStore.getState().flush()).resolves.toBe(true);
    expect(setSetting).not.toHaveBeenCalled();
    expect(stored.get('settings.probe.apiKey')).toBe('new');
  });

  it("flush(p) answers for p's own settings and the selection only: another provider's refused value does not fail it", async () => {
    const other = { ...probe, id: 'other', settings: { ...probe.settings, key: 'other' } } as unknown as AnyProvider;
    await useProviderStore.getState().load(probe);
    await useProviderStore.getState().load(other);
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      if (key.startsWith('settings.other.')) return { success: false, error: 'QuotaExceededError' };
      stored.set(key, value);
      return { success: true };
    });
    useProviderStore.getState().setCredential(other, 'apiKey', 'too-long');
    useProviderStore.getState().setCredential(probe, 'apiKey', 'k-1');
    await useProviderStore.getState().flush();
    setSetting.mockClear();
    await expect(useProviderStore.getState().flush(probe)).resolves.toBe(true);
    // The other provider's value is neither written again nor answered for…
    expect(setSetting).not.toHaveBeenCalledWith('settings.other.apiKey', expect.anything());
    expect(stored.get('settings.probe.apiKey')).toBe('k-1');
    // …but a flush of every key still sees it.
    await expect(useProviderStore.getState().flush()).resolves.toBe(false);
  });

  it('flush(p, PAIR_FIELDS) answers for the two global keys: a refused pick fails it', async () => {
    await useProviderStore.getState().load(probe);
    setSetting.mockImplementation(async () => ({ success: false, error: 'QuotaExceededError' }));
    useProviderStore.getState().setPair(probe, { source: 'ja', target: 'en' });
    await expect(useProviderStore.getState().flush(probe, PAIR_FIELDS)).resolves.toBe(false);
    await expect(useProviderStore.getState().flush(probe, ['apiKey'])).resolves.toBe(true);
  });

  it("flush(p, fields) answers for those fields and the selection only: p's other refused value does not fail it", async () => {
    await useProviderStore.getState().load(probe);
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      if (key === 'settings.probe.count') return { success: false, error: 'QuotaExceededError' };
      stored.set(key, value);
      return { success: true };
    });
    useProviderStore.getState().updateSettings(probe, { count: 9 });
    useProviderStore.getState().setCredential(probe, 'apiKey', 'k-1');
    await useProviderStore.getState().flush();
    setSetting.mockClear();
    await expect(useProviderStore.getState().flush(probe, ['apiKey'])).resolves.toBe(true);
    // The field this caller did not write is neither written again nor answered for…
    expect(setSetting).not.toHaveBeenCalledWith('settings.probe.count', expect.anything());
    // …but a flush of all of p's keys still sees it.
    await expect(useProviderStore.getState().flush(probe)).resolves.toBe(false);
  });
});
