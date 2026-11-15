import { describe, it, expect, beforeEach, vi } from 'vitest';

const { stored, getSetting, setSetting, model } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  const model = {
    scan: Promise.resolve() as Promise<void>,
    initialized: true,
    resolved: { translation: 'bing-translator', tts: 'edge-tts' } as { translation: string | null; tts: string | null },
    /** Per direction ('ja>en'), when a test needs the two directions to differ. */
    byDirection: {} as Record<string, { translation: string | null; tts: string | null }>,
  };
  return {
    stored,
    model,
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
vi.mock('./modelStore', () => ({
  useModelStore: {
    getState: () => ({
      initialize: () => model.scan,
      get initialized() { return model.initialized; },
      resolve: (src: string, tgt: string) => {
        const r = model.byDirection[`${src}>${tgt}`] ?? model.resolved;
        return {
          asr: null,
          translation: r.translation ? { modelId: r.translation, source: 'auto' } : null,
          tts: r.tts ? { modelId: r.tts, source: 'auto' } : null,
          notes: [], prunes: [],
        };
      },
    }),
  },
}));

// The AST cross-stage guard, as a session applies it: a test may make it downgrade the translation stage.
const guard = vi.hoisted(() => ({ translation: undefined as string | null | undefined }));
vi.mock('../services/providers/astGuard', () => ({
  guardAstCrossStage: (_s: string, _t: string, _sel: unknown, raw: { translation: unknown }) =>
    guard.translation === undefined ? raw : { ...raw, translation: guard.translation ? { modelId: guard.translation, source: 'auto' } : null },
}));

import { useLineUpStore, LINEUP_KEY, lineUpChangedEvent } from './lineUpStore';
import { useProviderStore } from './providerStore';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null };
const localEntry = { settings: { selections: {} }, credentials: {}, pair: { source: 'ja', target: 'en' } };

beforeEach(() => {
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  // A case may make a write fail or hang: every case starts with writes that land.
  setSetting.mockImplementation(async (key: string, value: unknown) => {
    stored.set(key, value);
    return { success: true };
  });
  model.scan = Promise.resolve();
  model.initialized = true;
  model.byDirection = {};
  guard.translation = undefined;
  model.resolved = { translation: 'bing-translator', tts: 'edge-tts' };
  useProviderStore.setState({ entries: {}, selected: null, selectionLocked: false, intent: undefined });
  useLineUpStore.setState({ lineUp: null, stored: false });
});

describe('the line-up store', () => {
  it('migrates once: writes the line-up and nothing else', async () => {
    useProviderStore.setState({ selected: 'soniox' });
    await useLineUpStore.getState().load();
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 1, stages: soniox });
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: soniox });
  });

  it('a stored line-up is read, never migrated again', async () => {
    const openai = { transcription: 'openai', translation: 'openai', speech: 'openai', summarisation: null };
    stored.set(LINEUP_KEY, { version: 1, stages: openai });
    useProviderStore.setState({ selected: 'openai' });
    await useLineUpStore.getState().load();
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: openai });
    expect(setSetting).not.toHaveBeenCalled();
  });

  // PR review: the provider is stored before the line-up; a save cut short by a restart leaves the old line-up
  // beside the new provider. The provider is the newer choice: the line-up is worked out from it again.
  it('a stored line-up its stored provider does not run is worked out again from the provider', async () => {
    const local = { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null };
    stored.set(LINEUP_KEY, { version: 1, stages: local });
    useProviderStore.setState({ selected: 'soniox' });
    await useLineUpStore.getState().load();
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: soniox });
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 1, stages: soniox });
    expect(useProviderStore.getState().selected).toBe('soniox');
  });

  it('a stored line-up naming a provider this build does not know is neither used nor overwritten', async () => {
    stored.set(LINEUP_KEY, { version: 1, stages: { transcription: 'later_provider', translation: 'later_provider', speech: 'later_provider', summarisation: null } });
    useProviderStore.setState({ selected: 'soniox' });
    await useLineUpStore.getState().load();
    expect(setSetting).not.toHaveBeenCalled();
    expect(useLineUpStore.getState().stored).toBe(false);
  });

  it('the local migration waits for the scan, then writes what today resolves to', async () => {
    let finishScan!: () => void;
    model.scan = new Promise<void>((resolve) => { finishScan = resolve; });
    useProviderStore.setState({ selected: 'local_inference', entries: { local_inference: localEntry } as never });
    await useLineUpStore.getState().load();
    expect(useLineUpStore.getState().stored).toBe(false);
    expect(setSetting).not.toHaveBeenCalled();
    finishScan();
    await vi.waitFor(() => expect(useLineUpStore.getState().stored).toBe(true));
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 1, stages: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null } });
  });

  it('works out the local line-up as a session would, through the AST guard', async () => {
    model.resolved = { translation: 'granite-speech', tts: 'edge-tts' };
    guard.translation = 'bing-translator'; // today's guard drops a mismatched Granite pick back to automatic: Bing
    useProviderStore.setState({ selected: 'local_inference', entries: { local_inference: localEntry } as never });
    await useLineUpStore.getState().load();
    await vi.waitFor(() => expect(useLineUpStore.getState().stored).toBe(true));
    expect(useLineUpStore.getState().lineUp).toMatchObject({ translation: 'bing' });
  });

  it('keeps Bing and Edge when either direction uses them today (owner, 2026-11-15)', async () => {
    // Supertonic has no Chinese: the English voice is the local model, the Chinese one is Edge today.
    model.byDirection = {
      'ja>en': { translation: 'hy-mt15-1.8b-translation', tts: 'supertonic-3' },
      'en>ja': { translation: 'bing-translator', tts: 'edge-tts' },
    };
    useProviderStore.setState({ selected: 'local_inference', entries: { local_inference: localEntry } as never });
    await useLineUpStore.getState().load();
    await vi.waitFor(() => expect(useLineUpStore.getState().stored).toBe(true));
    expect(useLineUpStore.getState().lineUp).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null });
  });

  it('writes nothing when the scan of downloaded models failed', async () => {
    model.initialized = false;
    useProviderStore.setState({ selected: 'local_inference', entries: { local_inference: localEntry } as never });
    await useLineUpStore.getState().load();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setSetting).not.toHaveBeenCalled();
    expect(useLineUpStore.getState().stored).toBe(false);
  });

  it('refuses a choice before the migration has written', async () => {
    model.scan = new Promise<void>(() => {});
    useProviderStore.setState({ selected: 'local_inference', entries: { local_inference: localEntry } as never });
    await useLineUpStore.getState().load();
    expect(await useLineUpStore.getState().choose('speech', 'local_inference')).toBeNull();
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('a choice stores the whole line-up and selects the provider that runs it', async () => {
    useLineUpStore.setState({ lineUp: soniox, stored: true });
    useProviderStore.setState({ selected: 'soniox' });
    await useLineUpStore.getState().choose('speech', 'edge');
    await vi.waitFor(() => expect(stored.get(LINEUP_KEY)).toEqual({ version: 1, stages: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null } }));
    expect(useProviderStore.getState().selected).toBe('local_inference');
    await vi.waitFor(() => expect(stored.get('settings.common.provider')).toBe('local_inference'));
  });

  // PR review: a choice whose line-up did not land is not a choice; the provider stays where it was.
  it('a choice whose line-up was not stored is undone, provider included', async () => {
    useLineUpStore.setState({ lineUp: soniox, stored: true });
    useProviderStore.setState({ selected: 'soniox' });
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      if (key === LINEUP_KEY) return { success: false };
      stored.set(key, value);
      return { success: true };
    });
    expect(await useLineUpStore.getState().choose('speech', 'edge')).toBeNull();
    expect(useLineUpStore.getState().lineUp).toEqual(soniox);
    expect(useProviderStore.getState().selected).toBe('soniox');
  });

  // PR review: a run starting while the line-up is being saved must already find the new provider selected.
  it('selects the provider that runs the new line-up before saving it', async () => {
    useLineUpStore.setState({ lineUp: soniox, stored: true });
    useProviderStore.setState({ selected: 'soniox' });
    let release!: () => void;
    setSetting.mockImplementation((key: string, value: unknown) => {
      if (key !== LINEUP_KEY) { stored.set(key, value); return Promise.resolve({ success: true }); }
      return new Promise((resolve) => { release = () => { stored.set(key, value); resolve({ success: true }); }; });
    });
    const choosing = useLineUpStore.getState().choose('speech', 'edge');
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(useProviderStore.getState().selected).toBe('local_inference');
    release();
    expect(await choosing).not.toBeNull();
  });

  // PR review: a run that starts while the line-up is being saved locks the provider; a failed save is undone
  // once the run ends, line-up and provider together, and until then both stay what the run started with.
  it('a choice not stored while a run started is undone when the run ends, provider included', async () => {
    useLineUpStore.setState({ lineUp: soniox, stored: true });
    useProviderStore.setState({ selected: 'soniox' });
    let fail!: () => void;
    setSetting.mockImplementation((key: string, value: unknown) => {
      if (key !== LINEUP_KEY) { stored.set(key, value); return Promise.resolve({ success: true }); }
      return new Promise((resolve) => { fail = () => resolve({ success: false }); });
    });
    const choosing = useLineUpStore.getState().choose('speech', 'edge');
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    useProviderStore.getState().setSelectionLocked(true);
    fail();
    expect(await choosing).toBeNull();
    // The run goes on with what it started with.
    expect(useProviderStore.getState().selected).toBe('local_inference');
    expect(useLineUpStore.getState().lineUp).toMatchObject({ speech: 'edge' });
    useProviderStore.getState().setSelectionLocked(false);
    expect(useLineUpStore.getState().lineUp).toEqual(soniox);
    expect(useProviderStore.getState().selected).toBe('soniox');
  });

  // PR review: a second choice made while the first is being saved waits for it, so each undo puts back what it replaced.
  it('two choices in a row whose saves both fail leave the line-up and the provider as they were', async () => {
    useLineUpStore.setState({ lineUp: soniox, stored: true });
    useProviderStore.setState({ selected: 'soniox' });
    setSetting.mockImplementation(async (key: string, value: unknown) => {
      if (key === LINEUP_KEY) return { success: false };
      stored.set(key, value);
      return { success: true };
    });
    const first = useLineUpStore.getState().choose('speech', 'edge');
    const second = useLineUpStore.getState().choose('transcription', 'openai');
    expect(await first).toBeNull();
    expect(await second).toBeNull();
    expect(useLineUpStore.getState().lineUp).toEqual(soniox);
    expect(useProviderStore.getState().selected).toBe('soniox');
  });

  it('a second choice is made on top of the first once the first is saved', async () => {
    useLineUpStore.setState({ lineUp: soniox, stored: true });
    useProviderStore.setState({ selected: 'soniox' });
    const first = useLineUpStore.getState().choose('speech', 'edge');
    const second = useLineUpStore.getState().choose('translation', 'local_inference');
    expect(await first).not.toBeNull();
    expect(await second).not.toBeNull();
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 1, stages: useLineUpStore.getState().lineUp });
    expect(useLineUpStore.getState().lineUp).toMatchObject({ translation: 'local_inference', speech: 'edge' });
  });

  it('does not change during a run', async () => {
    useLineUpStore.setState({ lineUp: soniox, stored: true });
    useProviderStore.setState({ selected: 'soniox', selectionLocked: true });
    expect(await useLineUpStore.getState().choose('speech', 'edge')).toBeNull();
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('reports a change per stage, never content', () => {
    expect(lineUpChangedEvent('speech', soniox, { lineUp: { ...soniox, speech: 'edge' }, moved: ['transcription', 'translation'] }))
      .toEqual({ stage: 'speech', from: 'soniox', to: 'edge', moved: ['transcription', 'translation'], during_session: false });
  });
});

// Plan 6, Task 4: the setup wizard stores a whole line-up at Finish.
describe('replace (the setup wizard)', () => {
  const openaiLive = { transcription: 'openai_live', translation: 'openai_live', speech: 'openai_live' };

  it('stores the stages, keeps the stored notes choice, and marks the line-up stored', async () => {
    stored.set(LINEUP_KEY, { version: 1, stages: { ...soniox, summarisation: 'notes-x' } });
    useLineUpStore.setState({ lineUp: null, stored: false });
    expect(await useLineUpStore.getState().replace(openaiLive)).toBe(true);
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 1, stages: { ...openaiLive, summarisation: 'notes-x' } });
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: { ...openaiLive, summarisation: 'notes-x' } });
  });

  it('is refused during a run, and writes nothing', async () => {
    useProviderStore.setState({ selectionLocked: true });
    try {
      expect(await useLineUpStore.getState().replace(openaiLive)).toBe(false);
      expect(setSetting).not.toHaveBeenCalled();
    } finally {
      useProviderStore.setState({ selectionLocked: false });
    }
  });

  it('says so when the write did not land', async () => {
    setSetting.mockImplementationOnce(async () => ({ success: false }));
    expect(await useLineUpStore.getState().replace(openaiLive)).toBe(false);
    expect(useLineUpStore.getState().stored).toBe(false);
  });

  it('a wizard line-up stays when the local migration finishes later', async () => {
    let finishScan!: () => void;
    model.scan = new Promise<void>((resolve) => { finishScan = resolve; });
    useProviderStore.setState({ selected: 'local_inference', entries: { local_inference: localEntry } as never });
    useLineUpStore.setState({ lineUp: null, stored: false });
    await useLineUpStore.getState().load();
    expect(await useLineUpStore.getState().replace({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' })).toBe(true);
    finishScan();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 1, stages: soniox });
    expect(useLineUpStore.getState().lineUp).toEqual(soniox);
  });
});

// Plan 6 review: a migration write still in flight when the wizard stores its line-up must not end up on top.
describe('replace while the local migration is writing', () => {
  it("the wizard's line-up ends up stored and shown, whatever order the writes resolve in", async () => {
    useProviderStore.setState({ selected: 'local_inference', entries: { local_inference: localEntry } as never, selectionLocked: false });
    useLineUpStore.setState({ lineUp: null, stored: false });
    let releaseMigration!: () => void;
    setSetting.mockImplementationOnce((key: string, value: unknown) => new Promise((resolve) => {
      releaseMigration = () => { stored.set(key, value); resolve({ success: true }); };
    }));
    await useLineUpStore.getState().load();
    await new Promise((resolve) => { setTimeout(resolve, 0); }); // the scan has ended; the migration's write is held
    expect(typeof releaseMigration).toBe('function');
    const replacing = useLineUpStore.getState().replace({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' });
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    releaseMigration();
    expect(await replacing).toBe(true);
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 1, stages: soniox });
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: soniox });
  });
});

// PR review: the migration of a network provider's line-up yields to the wizard as the local one does.
describe('replace while the migration of a network provider is writing', () => {
  it("the wizard's line-up ends up stored and shown", async () => {
    useProviderStore.setState({ selected: 'soniox', selectionLocked: false });
    useLineUpStore.setState({ lineUp: null, stored: false });
    let releaseMigration!: () => void;
    setSetting.mockImplementationOnce((key: string, value: unknown) => new Promise((resolve) => {
      releaseMigration = () => { stored.set(key, value); resolve({ success: true }); };
    }));
    const loading = useLineUpStore.getState().load();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(typeof releaseMigration).toBe('function');
    const local = { transcription: 'local_inference', translation: 'bing', speech: 'edge' };
    const replacing = useLineUpStore.getState().replace(local);
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    releaseMigration();
    await loading;
    expect(await replacing).toBe(true);
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 1, stages: { ...local, summarisation: null } });
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: { ...local, summarisation: null } });
  });
});

// PR review: the start's read of the line-up can return after the wizard stored one; it then changes nothing.
describe("the start's read returning after the wizard's replace", () => {
  it("leaves the wizard's line-up shown and stored", async () => {
    useProviderStore.setState({ selected: 'soniox', selectionLocked: false });
    useLineUpStore.setState({ lineUp: null, stored: false });
    const older = { version: 1, stages: { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null } };
    stored.set(LINEUP_KEY, older);
    let releaseRead!: () => void;
    getSetting.mockImplementationOnce((_key: string, _def: unknown) => new Promise((resolve) => { releaseRead = () => resolve(older); }));
    const loading = useLineUpStore.getState().load();
    const local = { transcription: 'local_inference', translation: 'bing', speech: 'edge' };
    expect(await useLineUpStore.getState().replace(local)).toBe(true);
    releaseRead();
    await loading;
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: { ...local, summarisation: null } });
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 1, stages: { ...local, summarisation: null } });
  });
});
