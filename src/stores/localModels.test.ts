import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ALL_LOCAL_STAGES } from '../lib/lineup/localStages';
import type { DirectionResult } from '../lib/local-inference/selection/types';

// Prefixed "mock" so Vitest hoists these alongside the vi.mock factory below.
let mockInitialized = true;
let mockFeatures: string[] = [];
const mockInitialize = vi.fn(async () => { mockInitialized = true; });
const mockResolve = vi.fn((): DirectionResult => ({ asr: null, translation: null, tts: null, notes: [], prunes: [] }));
const mockOff = vi.fn();
type Selector = (s: { modelStatuses: unknown }) => unknown;
let recordedSelector: Selector | undefined;
let recordedListener: (() => void) | undefined;

vi.mock('./modelStore', () => ({
  useModelStore: {
    getState: () => ({
      get initialized() { return mockInitialized; },
      initialize: mockInitialize,
      resolve: mockResolve,
      get deviceFeatures() { return mockFeatures; },
    }),
    // Records what the port subscribes with: the test reads the selector and fires the listener itself.
    subscribe: (selector: Selector, listener: () => void) => {
      recordedSelector = selector;
      recordedListener = listener;
      return mockOff;
    },
  },
}));

import { localModels } from './localModels';

beforeEach(() => {
  mockInitialized = true;
  mockFeatures = [];
  mockInitialize.mockClear();
  mockResolve.mockClear();
  mockOff.mockClear();
  recordedSelector = undefined;
  recordedListener = undefined;
});

describe('localModels', () => {
  it("scanned: starts the model store's first scan when it has not run, and none once it has", async () => {
    mockInitialized = false;
    await localModels.scanned();
    await localModels.scanned();
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  // Moved from check.test.ts ('rejects with the abort reason when the signal fires before initialization resolves').
  it('scanned: rejects with the abort reason when the signal fires before the scan settles', async () => {
    mockInitialized = false;
    let releaseInit: () => void = () => {};
    mockInitialize.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseInit = () => { mockInitialized = true; resolve(); };
    }));
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const promise = localModels.scanned(controller.signal);
    controller.abort(reason);
    await expect(promise).rejects.toBe(reason);
    releaseInit();
    // The scan the abort left still settles, and the next ask starts none.
    await expect(mockInitialize.mock.results[0].value).resolves.toBeUndefined();
    await expect(localModels.scanned()).resolves.toBeUndefined();
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it('resolve and deviceFeatures read the model store when asked', () => {
    localModels.resolve('ja', 'en', {}, ALL_LOCAL_STAGES);
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', {}, ALL_LOCAL_STAGES);
    mockFeatures = ['shader-f16'];
    expect(localModels.deviceFeatures()).toEqual(['shader-f16']);
  });

  it("watch: calls back when the models' statuses change, and returns the unsubscribe", () => {
    const onChange = vi.fn();
    expect(localModels.watch(onChange)).toBe(mockOff);
    recordedListener!();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(recordedSelector!({ modelStatuses: 'statuses' })).toBe('statuses');
  });
});
