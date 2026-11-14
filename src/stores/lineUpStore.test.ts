import { describe, it, expect, beforeEach, vi } from 'vitest';

const { stored, getSetting, setSetting, model } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  const model = {
    scan: Promise.resolve() as Promise<void>,
    resolved: { translation: 'bing-translator', tts: 'edge-tts' } as { translation: string | null; tts: string | null },
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
      resolve: () => ({
        asr: null,
        translation: model.resolved.translation ? { modelId: model.resolved.translation, source: 'auto' } : null,
        tts: model.resolved.tts ? { modelId: model.resolved.tts, source: 'auto' } : null,
        notes: [], prunes: [],
      }),
    }),
  },
}));

import { useLineUpStore, LINEUP_KEY, lineUpChangedEvent } from './lineUpStore';
import { useProviderStore } from './providerStore';

const soniox = { transcription: 'soniox', translation: 'soniox', speech: 'soniox', summarisation: null };
const localEntry = { settings: { selections: {} }, credentials: {}, pair: { source: 'ja', target: 'en' } };

beforeEach(() => {
  stored.clear();
  getSetting.mockClear();
  setSetting.mockClear();
  model.scan = Promise.resolve();
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
    useProviderStore.setState({ selected: 'soniox' });
    await useLineUpStore.getState().load();
    expect(useLineUpStore.getState()).toMatchObject({ stored: true, lineUp: openai });
    expect(setSetting).not.toHaveBeenCalled();
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
