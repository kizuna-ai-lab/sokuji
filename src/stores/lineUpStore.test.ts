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
import { registerPresentProviders } from '../lib/plan/present';
import { stubHosts } from '../lib/plan/testing';

// The registry stays out of these tests: every host is offered, as a stub, so a choice composes as it does in the app.
const hosts = stubHosts().providers;
registerPresentProviders(() => hosts);

const PROVIDER_KEY = 'settings.common.provider';
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
  useLineUpStore.setState({ lineUp: null, stored: false, unstoredProvider: null });
});

describe('the line-up store', () => {
  it('migrates once: writes the line-up and nothing else', async () => {
    stored.set(PROVIDER_KEY, 'soniox');
    await useLineUpStore.getState().load();
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 2, stages: soniox });
    expect(setSetting).toHaveBeenCalledTimes(1);
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: soniox });
  });

  it('a stored line-up is read, never migrated again', async () => {
    const openai = { transcription: 'openai', translation: 'openai', speech: 'openai', summarisation: null };
    stored.set(LINEUP_KEY, { version: 2, stages: openai });
    stored.set(PROVIDER_KEY, 'openai');
    await useLineUpStore.getState().load();
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: openai });
    expect(setSetting).not.toHaveBeenCalled();
  });

  // A launch that changes nothing writes nothing: a version-1 line-up is written as version 2 by its next change.
  it('a version-1 line-up its stored provider runs is read as it is, and not written again', async () => {
    const openai = { transcription: 'openai', translation: 'openai', speech: 'openai', summarisation: null };
    stored.set(LINEUP_KEY, { version: 1, stages: openai });
    stored.set(PROVIDER_KEY, 'openai');
    await useLineUpStore.getState().load();
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: openai, unstoredProvider: null });
    expect(setSetting).not.toHaveBeenCalled();
    await useLineUpStore.getState().choose('summarisation', 'notes-x');
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 2, stages: { ...openai, summarisation: 'notes-x' } });
  });

  // Version 1 was written after its provider: a save cut short by a restart leaves the old line-up beside the new
  // provider. The provider is the newer choice: the line-up is worked out from it again, once, and written as
  // version 2.
  it('a version-1 line-up its stored provider does not run is worked out again from the provider, and written as version 2', async () => {
    const local = { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null };
    stored.set(LINEUP_KEY, { version: 1, stages: local });
    stored.set(PROVIDER_KEY, 'soniox');
    await useLineUpStore.getState().load();
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: soniox, unstoredProvider: null });
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 2, stages: soniox });
    expect(stored.get(PROVIDER_KEY)).toBe('soniox');
  });

  it('a version-2 line-up is used as stored, whatever the stored provider says', async () => {
    const local = { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null };
    stored.set(LINEUP_KEY, { version: 2, stages: local });
    stored.set(PROVIDER_KEY, 'soniox');
    await useLineUpStore.getState().load();
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: local, unstoredProvider: null });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('a version-2 line-up no one provider runs is kept as stored', async () => {
    const mixed = { transcription: 'soniox', translation: 'soniox', speech: 'edge', summarisation: null };
    stored.set(LINEUP_KEY, { version: 2, stages: mixed });
    stored.set(PROVIDER_KEY, 'soniox');
    await useLineUpStore.getState().load();
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: mixed });
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('a stored line-up naming a provider this build does not know is neither used nor overwritten', async () => {
    stored.set(LINEUP_KEY, { version: 2, stages: { transcription: 'later_provider', translation: 'later_provider', speech: 'later_provider', summarisation: null } });
    stored.set(PROVIDER_KEY, 'soniox');
    await useLineUpStore.getState().load();
    expect(setSetting).not.toHaveBeenCalled();
    // Shown as today's values, which are what runs.
    expect(useLineUpStore.getState()).toMatchObject({ stored: false, lineUp: soniox, unstoredProvider: 'soniox' });
  });

  it('a stored value of a later version, or one that is not a line-up, is neither used nor overwritten', async () => {
    for (const value of [{ version: 3, stages: soniox }, soniox, 'soniox', { version: 2, stages: { transcription: 'soniox' } }]) {
      stored.set(LINEUP_KEY, value);
      stored.set(PROVIDER_KEY, 'openai');
      useLineUpStore.setState({ lineUp: null, stored: false, unstoredProvider: null });
      await useLineUpStore.getState().load();
      expect(setSetting).not.toHaveBeenCalled();
      expect(useLineUpStore.getState()).toMatchObject({ stored: false, unstoredProvider: 'openai', lineUp: { transcription: 'openai', translation: 'openai', speech: 'openai' } });
    }
  });

  it('with nothing stored and a provider this build does not offer, the first offered provider runs, and the stored id stays', async () => {
    // OpenAI Compatible is retired: no build offers it.
    stored.set(PROVIDER_KEY, 'openai_compatible');
    let release!: () => void;
    setSetting.mockImplementationOnce((key: string, value: unknown) => new Promise((resolve) => {
      release = () => { stored.set(key, value); resolve({ success: true }); };
    }));
    const loading = useLineUpStore.getState().load();
    // Until its line-up is stored, the provider that runs is named apart from the line-up.
    await vi.waitFor(() => expect(useLineUpStore.getState().unstoredProvider).toBe(hosts[0].id));
    expect(useLineUpStore.getState().stored).toBe(false);
    release();
    await loading;
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, unstoredProvider: null, lineUp: { transcription: hosts[0].id } });
    expect(stored.get(PROVIDER_KEY)).toBe('openai_compatible');
  });

  it('a stored id of a provider this build does not offer does not throw, with or without a line-up', async () => {
    stored.set(PROVIDER_KEY, 'not_a_provider');
    await expect(useLineUpStore.getState().load()).resolves.toBeUndefined();
    useLineUpStore.setState({ lineUp: null, stored: false, unstoredProvider: null });
    stored.set(LINEUP_KEY, { version: 1, stages: soniox });
    await expect(useLineUpStore.getState().load()).resolves.toBeUndefined();
  });

  it('the local migration waits for the scan, then writes what today resolves to', async () => {
    let finishScan!: () => void;
    model.scan = new Promise<void>((resolve) => { finishScan = resolve; });
    stored.set(PROVIDER_KEY, 'local_inference');
    useProviderStore.setState({ entries: { local_inference: localEntry } as never });
    await useLineUpStore.getState().load();
    expect(useLineUpStore.getState().stored).toBe(false);
    expect(setSetting).not.toHaveBeenCalled();
    finishScan();
    await vi.waitFor(() => expect(useLineUpStore.getState().stored).toBe(true));
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 2, stages: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null } });
    expect(useLineUpStore.getState().unstoredProvider).toBeNull();
  });

  it('works out the local line-up as a session would, through the AST guard', async () => {
    model.resolved = { translation: 'granite-speech', tts: 'edge-tts' };
    guard.translation = 'bing-translator'; // today's guard drops a mismatched Granite pick back to automatic: Bing
    stored.set(PROVIDER_KEY, 'local_inference');
    useProviderStore.setState({ entries: { local_inference: localEntry } as never });
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
    stored.set(PROVIDER_KEY, 'local_inference');
    useProviderStore.setState({ entries: { local_inference: localEntry } as never });
    await useLineUpStore.getState().load();
    await vi.waitFor(() => expect(useLineUpStore.getState().stored).toBe(true));
    expect(useLineUpStore.getState().lineUp).toEqual({ transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null });
  });

  it('writes nothing when the scan of downloaded models failed', async () => {
    model.initialized = false;
    stored.set(PROVIDER_KEY, 'local_inference');
    useProviderStore.setState({ entries: { local_inference: localEntry } as never });
    await useLineUpStore.getState().load();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(setSetting).not.toHaveBeenCalled();
    expect(useLineUpStore.getState().stored).toBe(false);
  });

  it('the first choice on a line-up that is shown but not stored yet stores it', async () => {
    model.scan = new Promise<void>(() => {});
    stored.set(PROVIDER_KEY, 'local_inference');
    useProviderStore.setState({ entries: { local_inference: localEntry } as never });
    await useLineUpStore.getState().load();
    expect(useLineUpStore.getState()).toMatchObject({ stored: false, unstoredProvider: 'local_inference' });
    expect(await useLineUpStore.getState().choose('speech', 'local_inference')).not.toBeNull();
    const chosen = { transcription: 'local_inference', translation: 'bing', speech: 'local_inference', summarisation: null };
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 2, stages: chosen });
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, unstoredProvider: null, lineUp: chosen });
  });

  it('a first choice whose line-up was not stored leaves the line-up shown and not stored', async () => {
    stored.set(LINEUP_KEY, { version: 3, stages: soniox });
    stored.set(PROVIDER_KEY, 'soniox');
    await useLineUpStore.getState().load();
    setSetting.mockImplementation(async () => ({ success: false }));
    expect(await useLineUpStore.getState().choose('summarisation', 'notes-x')).toBeNull();
    expect(useLineUpStore.getState()).toMatchObject({ stored: false, unstoredProvider: 'soniox', lineUp: soniox });
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 3, stages: soniox });
  });

  it('refuses a choice while no line-up is shown', async () => {
    expect(await useLineUpStore.getState().choose('speech', 'edge')).toBeNull();
    expect(setSetting).not.toHaveBeenCalled();
  });

  it('a choice stores the whole line-up and selects the provider that runs it', async () => {
    useLineUpStore.setState({ lineUp: soniox, stored: true });
    useProviderStore.setState({ selected: 'soniox' });
    await useLineUpStore.getState().choose('speech', 'edge');
    await vi.waitFor(() => expect(stored.get(LINEUP_KEY)).toEqual({ version: 2, stages: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null } }));
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
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 2, stages: useLineUpStore.getState().lineUp });
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
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 2, stages: { ...openaiLive, summarisation: 'notes-x' } });
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
    stored.set(PROVIDER_KEY, 'local_inference');
    useProviderStore.setState({ entries: { local_inference: localEntry } as never });
    await useLineUpStore.getState().load();
    expect(await useLineUpStore.getState().replace({ transcription: 'soniox', translation: 'soniox', speech: 'soniox' })).toBe(true);
    finishScan();
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 2, stages: soniox });
    expect(useLineUpStore.getState().lineUp).toEqual(soniox);
  });
});

// Plan 6 review: a migration write still in flight when the wizard stores its line-up must not end up on top.
describe('replace while the local migration is writing', () => {
  it("the wizard's line-up ends up stored and shown, whatever order the writes resolve in", async () => {
    stored.set(PROVIDER_KEY, 'local_inference');
    useProviderStore.setState({ entries: { local_inference: localEntry } as never });
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
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 2, stages: soniox });
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: soniox });
  });
});

// PR review: the migration of a network provider's line-up yields to the wizard as the local one does.
describe('replace while the migration of a network provider is writing', () => {
  it("the wizard's line-up ends up stored and shown", async () => {
    stored.set(PROVIDER_KEY, 'soniox');
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
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 2, stages: { ...local, summarisation: null } });
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: { ...local, summarisation: null } });
  });
});

// PR review: the start's read of the line-up can return after the wizard stored one; it then changes nothing.
describe("the start's read returning after the wizard's replace", () => {
  it("leaves the wizard's line-up shown and stored", async () => {
    stored.set(PROVIDER_KEY, 'soniox');
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
    expect(stored.get(LINEUP_KEY)).toEqual({ version: 2, stages: { ...local, summarisation: null } });
  });
});

// A line-up of two providers is stored, the app is downgraded to 0.51.0 and upgraded again.
describe('a version-2 line-up read by version 0.51.0', () => {
  const STAGE_NAMES = ['transcription', 'translation', 'speech', 'summarisation'] as const;
  type Stages = Record<(typeof STAGE_NAMES)[number], string | null>;
  /** `isStoredLineUp` as version 0.51.0 has it; `known` stands for its catalog. */
  function isStoredLineUpOf051(value: unknown, known: (id: string) => boolean): value is { version: 1; stages: Stages } {
    if (!value || typeof value !== 'object') return false;
    const v = value as { version?: unknown; stages?: Record<string, unknown> };
    if (v.version !== 1 || !v.stages || typeof v.stages !== 'object') return false;
    return STAGE_NAMES.every((s) => v.stages![s] === null || (typeof v.stages![s] === 'string' && (s === 'summarisation' || known(v.stages![s] as string))));
  }
  /** What `load` of version 0.51.0 does with a stored value and its selected provider: which branch it takes. */
  function loadOf051(value: unknown, selected: string | null, runs: (stages: Stages) => string | null): 'used' | 'shown, never overwritten' | 'nothing' | 'migrated' {
    if (isStoredLineUpOf051(value, () => true)) {
      if (!selected || runs(value.stages) === selected) return 'used';
    } else if (value !== null && value !== undefined) {
      return selected ? 'shown, never overwritten' : 'nothing';
    }
    return selected ? 'migrated' : 'nothing';
  }

  it('is not accepted and not overwritten there, and is intact after the upgrade', async () => {
    const mixed = { transcription: 'soniox', translation: 'soniox', speech: 'edge', summarisation: null };
    useLineUpStore.setState({ lineUp: soniox, stored: true });
    useProviderStore.setState({ selected: 'soniox' });
    // Stored by this version: the line-up as version 2.
    setSetting.mockClear();
    expect(await useLineUpStore.getState().replace(mixed)).toBe(true);
    const written = stored.get(LINEUP_KEY);
    expect(written).toEqual({ version: 2, stages: mixed });

    // The old version: the value is not a line-up to it, whichever provider it selected; it takes the branch that
    // shows its own values and writes nothing (its migration is the only writer at a start, and it is not reached).
    expect(isStoredLineUpOf051(written, () => true)).toBe(false);
    for (const selected of ['soniox', 'local_inference', 'openai']) {
      expect(loadOf051(written, selected, () => null)).toBe('shown, never overwritten');
    }

    // The upgrade: the mix is read back as stored, whatever provider the old version left selected.
    stored.set(PROVIDER_KEY, 'openai');
    useLineUpStore.setState({ lineUp: null, stored: false, unstoredProvider: null });
    useProviderStore.setState({ selected: null });
    setSetting.mockClear();
    await useLineUpStore.getState().load();
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: mixed, unstoredProvider: null });
    expect(setSetting).not.toHaveBeenCalled();
  });
});
