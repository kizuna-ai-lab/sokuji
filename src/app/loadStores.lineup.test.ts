import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { stored, setSetting, model } = vi.hoisted(() => {
  const stored = new Map<string, unknown>();
  const model = { scan: Promise.resolve() as Promise<void>, resolve: vi.fn() };
  return {
    stored,
    model,
    setSetting: vi.fn(async (key: string, value: unknown) => {
      stored.set(key, value);
      return { success: true };
    }),
  };
});
vi.mock('../services/ServiceFactory', () => ({
  ServiceFactory: {
    getSettingsService: () => ({
      getSetting: async (key: string, def: unknown) => (stored.has(key) ? stored.get(key) : def),
      setSetting,
    }),
  },
}));
// Nothing downloaded: today's list resolves translation to Bing and speech to Edge.
vi.mock('../stores/modelStore', () => ({
  useModelStore: {
    getState: () => ({ initialize: () => model.scan, initialized: true, resolve: model.resolve }),
    subscribe: () => () => {},
  },
}));

import { useLineUpStore, storedLocalStages, LINEUP_KEY } from '../stores/lineUpStore';
import { useProviderStore } from '../stores/providerStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { loadSessionStores } from './loadStores';

const providersBefore = useProviderStore.getState();

beforeEach(() => {
  stored.clear();
  setSetting.mockClear();
  model.resolve.mockReset();
  model.resolve.mockImplementation(() => ({
    asr: null, translation: { modelId: 'bing-translator', source: 'auto' }, tts: { modelId: 'edge-tts', source: 'auto' }, notes: [], prunes: [],
  }));
  useProviderStore.setState({ entries: {}, intent: undefined, readiness: {}, selected: null });
  useLineUpStore.setState({ lineUp: null, stored: false });
  useSegmentationStore.setState({ refresh: vi.fn(async () => {}) });
});

afterEach(() => {
  useProviderStore.setState(providersBefore, true);
});

describe('the first start of the new version, free provider, nothing downloaded', () => {
  it('writes the line-up once after the scan, and a session before it resolves as today', async () => {
    stored.set('settings.common.provider', 'local_inference');
    let finishScan!: () => void;
    model.scan = new Promise<void>((resolve) => { finishScan = resolve; });

    await loadSessionStores();
    expect(stored.has(LINEUP_KEY)).toBe(false);
    expect(storedLocalStages()).toBeNull(); // the local provider resolves with today's list until the line-up is written

    finishScan();
    await vi.waitFor(() => expect(stored.get(LINEUP_KEY)).toEqual({ version: 1, stages: { transcription: 'local_inference', translation: 'bing', speech: 'edge', summarisation: null } }));
    expect(storedLocalStages()).toEqual({ translation: 'bing', speech: 'edge' });

    setSetting.mockClear();
    useLineUpStore.setState({ lineUp: null, stored: false });
    model.scan = Promise.resolve();
    await loadSessionStores();
    expect(setSetting).not.toHaveBeenCalledWith(LINEUP_KEY, expect.anything());
  });
});
