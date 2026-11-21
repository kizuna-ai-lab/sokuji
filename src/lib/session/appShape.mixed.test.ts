// A stored line-up of two providers, read through the stores: the fake for transcription and translation, the
// fake voice for speech. The catalog holds the fakes only in the E2E build, so the build mode is stubbed and every
// module loaded again, as the fake voice's own catalog tests do.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (_key: string, def: unknown) => def,
      setSetting: async () => ({ success: true }),
    }),
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** The stores and their readers as the E2E build has them. */
async function e2eBuild() {
  vi.stubEnv('MODE', 'e2e');
  vi.resetModules();
  const [{ useLineUpStore }, { useProviderStore }, { planFromStores }, { readShapeFromStores, liveGate }, { fakeProvider }, { fakeVoiceProvider }] = await Promise.all([
    import('../../stores/lineUpStore'),
    import('../../stores/providerStore'),
    import('../plan/fromStores'),
    import('./appShape'),
    import('../../providers/fake/provider'),
    import('../../providers/fake/voice'),
  ]);
  return { useLineUpStore, useProviderStore, planFromStores, readShapeFromStores, liveGate, fakeProvider, fakeVoiceProvider };
}

describe('a stored line-up of two providers, through the stores', () => {
  const mixed = { transcription: 'fake', translation: 'fake', speech: 'fake_voice', summarisation: null };
  const auth = { signedIn: false, getToken: async () => null };

  it('composes to a plan of two units, and the run freezes it', async () => {
    const b = await e2eBuild();
    b.useLineUpStore.setState({ lineUp: mixed, stored: true, unstoredProvider: null });
    // Loading until both providers of the plan have their entries.
    expect(b.planFromStores()).toEqual({ state: 'loading' });
    await b.useProviderStore.getState().load(b.fakeProvider);
    expect(b.planFromStores()).toEqual({ state: 'loading' });
    await b.useProviderStore.getState().load(b.fakeVoiceProvider);

    const found = b.planFromStores();
    if (found.state !== 'ready') throw new Error(`expected a ready plan, got ${found.state}`);
    expect(found.plan.units.map((u) => [u.provider.id, u.unit.id, u.stages])).toEqual([
      ['fake', 'whole', ['transcription', 'translation']],
      ['fake_voice', 'voice', ['speech']],
    ]);
    expect(found.plan.byStage.speech.unit.startSpeech).toBeDefined();
    expect(Object.keys(found.accounts)).toEqual(['fake', 'fake_voice']);
    expect(b.planFromStores()).toBe(found);

    const shape = b.readShapeFromStores(auth);
    if (!shape) throw new Error('expected a shape');
    expect(shape.plan).toBe(found.plan);
    const entries = b.useProviderStore.getState().entries;
    expect(shape.accounts).toEqual({
      fake: { settings: entries.fake.settings, credentials: entries.fake.credentials },
      fake_voice: { settings: entries.fake_voice.settings, credentials: entries.fake_voice.credentials },
    });
    expect(shape.lineUp).toEqual({ transcription: 'fake', translation: 'fake', speech: 'fake_voice' });
    expect(shape.lineUpStored).toBe(true);
    expect(shape.pair).toEqual(entries.fake.pair);
    expect(b.liveGate()).toBeNull();
  });

  it('the fake voice alone on every stage is refused: it only speaks', async () => {
    const b = await e2eBuild();
    b.useLineUpStore.setState({ lineUp: { ...mixed, transcription: 'fake_voice' }, stored: true, unstoredProvider: null });
    await b.useProviderStore.getState().load(b.fakeProvider);
    await b.useProviderStore.getState().load(b.fakeVoiceProvider);
    expect(b.planFromStores()).toEqual({ state: 'refused', refusal: { refused: 'lineup_incomplete', stage: 'transcription' } });
    expect(b.readShapeFromStores(auth)).toBeNull();
    expect(b.liveGate()).toMatchObject({ code: 'lineup_incomplete' });
  });
});
