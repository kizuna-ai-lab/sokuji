import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DirectionResult } from '../../lib/local-inference/selection/types';

/** One direction's table entry: an id per stage, or absent/null for "does not resolve". */
type TableEntry = { asr?: string | null; translation?: string | null; tts?: string | null };
type Table = Record<string, TableEntry>;

// Prefixed "mock" so Vitest hoists these alongside the vi.mock factory below
// (see ModelManagementSection.test.tsx for the same convention).
let mockInitialized = true;
let mockTable: Table = {};
const mockInitialize = vi.fn(async () => { mockInitialized = true; });
const mockApplyPrunes = vi.fn(async () => {});
const mockResolve = vi.fn((src: string, tgt: string, _selections: unknown): DirectionResult => {
  const entry = mockTable[`${src}>${tgt}`];
  const stage = (id: string | null | undefined) => (id ? { modelId: id, source: 'explicit' as const } : null);
  return {
    asr: stage(entry?.asr),
    translation: stage(entry?.translation),
    tts: stage(entry?.tts),
    notes: [],
    prunes: [],
  };
});

vi.mock('../../stores/modelStore', () => ({
  useModelStore: {
    getState: () => ({
      get initialized() { return mockInitialized; },
      initialize: mockInitialize,
      resolve: mockResolve,
      applyPrunes: mockApplyPrunes,
    }),
  },
}));

import { checkLocalInference } from './check';
import { LOCAL_INFERENCE_DEFAULTS } from './settings';

/** Sets what `resolve(src, tgt, …)` answers, keyed `${src}>${tgt}`. */
function resolved(table: Table): void {
  mockTable = table;
}

/** Every call this test observed to a modelStore setter. */
function modelStoreWrites(): unknown[] {
  return mockApplyPrunes.mock.calls;
}

const defaults = LOCAL_INFERENCE_DEFAULTS;

beforeEach(() => {
  mockInitialized = true;
  mockTable = {};
  mockInitialize.mockClear();
  mockApplyPrunes.mockClear();
  mockResolve.mockClear();
});

describe('checkLocalInference', () => {
  it('is ready when the speaker direction has ASR and translation, whatever TTS', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: null } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toEqual({ ok: true });
  });

  it('names what the speaker direction lacks', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toMatchObject({ ok: false });
  });

  it('asks the participant direction only when the participant leg runs alone', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' }, 'en>ja': { asr: null, translation: null } });
    expect((await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'] })).ok).toBe(true);
    expect((await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['participant'] })).ok).toBe(false);
  });

  it('writes nothing', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] });
    expect(modelStoreWrites()).toEqual([]);
  });

  it('initializes the model store first when not yet initialized', async () => {
    mockInitialized = false;
    resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] });
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it('rejects with the abort reason when the signal fires before initialization resolves', async () => {
    mockInitialized = false;
    let releaseInit: () => void = () => {};
    mockInitialize.mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseInit = () => { mockInitialized = true; resolve(); };
    }));
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const promise = checkLocalInference(
      defaults,
      { pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal: controller.signal },
    );
    controller.abort(reason);
    await expect(promise).rejects.toBe(reason);
    releaseInit();
  });
});
