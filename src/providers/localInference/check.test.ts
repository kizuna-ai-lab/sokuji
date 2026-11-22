import { describe, it, expect, vi, beforeEach } from 'vitest';
import { directionKey, type DirectionResult, type Selections } from '../../lib/local-inference/selection/types';

/** One direction's table entry: an id per stage, or absent/null for "does not
 *  resolve". `autoTranslation` is what the translation stage resolves to once
 *  that direction's stored translation selection is auto (`''`) — what the AST
 *  cross-stage guard's re-resolution asks for. */
type TableEntry = { asr?: string | null; translation?: string | null; tts?: string | null; autoTranslation?: string | null };
type Table = Record<string, TableEntry>;

// Prefixed "mock" so Vitest hoists these alongside the vi.mock factory below
// (see ModelManagementSection.test.tsx for the same convention).
let mockInitialized = true;
let mockTable: Table = {};
const mockInitialize = vi.fn(async () => { mockInitialized = true; });
const mockApplyPrunes = vi.fn(async () => {});
const mockOff = vi.fn();
const mockSubscribe = vi.fn((_selector: (s: { modelStatuses: unknown }) => unknown, _listener: () => void) => mockOff);
type MockStages = { translation: 'bing' | 'local' | null; speech: 'edge' | 'local' | null; transcription?: 'local' | null } | null;
// As the engine resolves with a line-up's local stages (`resolveWasmDirection`): nothing resolves for recognition
// or translation while another provider translates (but recognition where this device transcribes alone), and Bing
// translates where the line-up gives it translation.
const mockResolve = vi.fn((src: string, tgt: string, selections: Selections, stages?: MockStages): DirectionResult => {
  const entry = mockTable[`${src}>${tgt}`];
  const stage = (id: string | null | undefined) => (id ? { modelId: id, source: 'explicit' as const } : null);
  const translationAuto = selections[directionKey(src, tgt)]?.translation.modelId === '';
  const elsewhere = stages != null && stages.translation === null;
  const translation = stages?.translation === 'bing' ? 'bing-translator' : translationAuto ? entry?.autoTranslation : entry?.translation;
  return {
    asr: stage(elsewhere && stages?.transcription !== 'local' ? null : entry?.asr),
    translation: stage(elsewhere ? null : translation),
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
    // Deferred through a wrapper (not a direct reference): this property is
    // evaluated eagerly when the factory object is built, before `mockSubscribe`
    // (declared below, after the hoisted `vi.mock` call) is assigned — a direct
    // reference here would throw a TDZ ReferenceError at import time.
    subscribe: (selector: (s: { modelStatuses: unknown }) => unknown, listener: () => void) => mockSubscribe(selector, listener),
  },
}));

let mockStages: MockStages = null;
vi.mock('../../stores/lineUpStore', () => ({ storedLocalStages: () => mockStages }));
import { checkLocalInference, watchLocalInferenceReadiness } from './check';
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
  mockSubscribe.mockClear();
  mockOff.mockClear();
});

describe('checkLocalInference', () => {
  it('is ready when the speaker direction has ASR and translation, whatever TTS', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: null } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toEqual({ ok: true });
  });

  it('names what the speaker direction lacks', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toEqual({
      ok: false,
      reason: 'Required models are not available for the selected language pair.',
      code: 'local_models_missing',
    });
  });

  it('with both legs, also requires the reverse direction\'s ASR, and names that direction when it lacks one', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' }, 'en>ja': { asr: null, translation: 't2' } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'] })).toEqual({
      ok: false,
      reason: 'Required models are not available for the reverse language pair.',
      code: 'no_asr',
      params: { source: 'en' },
    });
  });

  it('with both legs, is ready when the reverse direction has ASR but no translation: it runs transcription-only', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' }, 'en>ja': { asr: 'a2', translation: null } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'] })).toEqual({ ok: true });
  });

  it('with both legs, names the speaker direction first when both lack models', async () => {
    resolved({ 'ja>en': { asr: null, translation: null }, 'en>ja': { asr: null, translation: null } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'] })).toEqual({
      ok: false,
      reason: 'Required models are not available for the selected language pair.',
      code: 'local_models_missing',
    });
  });

  it('with the speaker leg alone, never asks the reverse direction', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' }, 'en>ja': { asr: null, translation: null } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toEqual({ ok: true });
    expect(mockResolve.mock.calls.map(([src, tgt]) => `${src}>${tgt}`)).toEqual(['ja>en']);
  });

  it('with the participant leg alone, requires the reverse direction\'s ASR and translation', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' }, 'en>ja': { asr: 'a2', translation: null } });
    expect((await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['participant'] })).ok).toBe(false);
  });

  // 'granite-speech' is the real manifest's AST-capable model (this file
  // leaves modelManifest unmocked). Raw, this direction has a translation;
  // guarded, the explicit pick falls back to auto, which has none here — the
  // verdict follows the guarded resolution, as `build` would.
  it('judges readiness on the AST-guarded resolution: an explicit Granite Speech translation pick that does not match the resolved ASR falls back to auto', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 'granite-speech', autoTranslation: null } });
    const selections: Selections = {
      [directionKey('ja', 'en')]: { asr: { modelId: '' }, translation: { modelId: 'granite-speech' }, tts: { modelId: '' } },
    };
    expect(await checkLocalInference({ ...defaults, selections }, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toEqual({
      ok: false,
      reason: 'Required models are not available for the selected language pair.',
      code: 'local_models_missing',
    });
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

describe('watchLocalInferenceReadiness', () => {
  it('subscribes to the model store, calling onChange when the recorded listener fires', () => {
    const onChange = vi.fn();
    const off = watchLocalInferenceReadiness(onChange);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    const [selector, listener] = mockSubscribe.mock.calls[0] as [(s: { modelStatuses: unknown }) => unknown, () => void];
    expect(selector({ modelStatuses: { a: 'downloaded' } })).toEqual({ a: 'downloaded' });
    listener();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(off).toBe(mockOff);
  });
});

describe('the stored line-up in the readiness check', () => {
  it('passes its local stages to the resolver', async () => {
    mockStages = { translation: 'local', speech: 'edge' };
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: null } });
    await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] });
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: 'local', speech: 'edge' });
    mockStages = null;
  });

  it('is ready with no recognition and no translation model while the line-up gives it speech alone', async () => {
    resolved({});
    for (const speech of ['edge', 'local'] as const) {
      mockStages = { translation: null, speech };
      mockResolve.mockClear();
      expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'] })).toEqual({ ok: true });
      // Nothing is asked of the models: a speech model that is missing is said when the session starts.
      expect(mockResolve).not.toHaveBeenCalled();
    }
    mockStages = null;
  });

  it('still asks for its recognition and translation models while another provider only speaks', async () => {
    mockStages = { translation: 'local', speech: null };
    resolved({});
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toMatchObject({ ok: false, code: 'local_models_missing' });
    mockStages = null;
  });

  it('reads the stages it is told it serves before the stored line-up: speech alone is ready with no model at all', async () => {
    mockStages = null;
    resolved({});
    mockResolve.mockClear();
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'], stages: ['speech'] })).toEqual({ ok: true });
    // Not even a speech model is asked for: one that is missing is said when the session starts.
    expect(mockResolve).not.toHaveBeenCalled();
  });

  // The plan a start checks is the one it froze: the stored line-up may have moved since, or none may be stored.
  it('told it transcribes and translates, it resolves those stages with its models, whatever the stored line-up says', async () => {
    const ctx = {
      pair: { source: 'ja', target: 'en' }, legs: ['speaker'],
      stages: ['transcription', 'translation'], stageIds: { transcription: 'local_inference', translation: 'local_inference' },
    } as const;
    for (const storedStages of [{ translation: null, speech: 'edge' }, { translation: 'bing', speech: 'edge' }, null] as const) {
      mockStages = storedStages;
      resolved({});
      expect(await checkLocalInference(defaults, ctx)).toMatchObject({ ok: false, code: 'local_models_missing' });
      resolved({ 'ja>en': { asr: 'a', translation: 't', tts: null } });
      mockResolve.mockClear();
      expect(await checkLocalInference(defaults, ctx)).toEqual({ ok: true });
      expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: 'local', speech: null });
    }
    mockStages = null;
  });

  it('told the plan gives translation to Bing, it asks for a recognition model alone', async () => {
    mockStages = { translation: 'local', speech: 'local' };
    const ctx = {
      pair: { source: 'ja', target: 'en' }, legs: ['speaker'],
      stages: ['transcription', 'translation'], stageIds: { transcription: 'local_inference', translation: 'bing' },
    } as const;
    resolved({ 'ja>en': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, ctx)).toEqual({ ok: true });
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: 'bing', speech: null });
    mockStages = null;
  });

  it('told its stages without their ids, it resolves each with a model on this machine', async () => {
    mockStages = { translation: 'bing', speech: 'edge' };
    resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'], stages: ['transcription', 'translation'] });
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: 'local', speech: null });
    mockStages = null;
  });
});

describe('readiness when this device translates what another provider transcribes', () => {
  const told = (translation: 'bing' | 'local_inference', legs: readonly ('speaker' | 'participant')[] = ['speaker'], pair = { source: 'ja', target: 'en' }) => ({
    pair, legs, stages: ['translation'], stageIds: { translation },
  }) as const;

  it('asks for the translation model of the direction and for no recognition model', async () => {
    resolved({ 'ja>en': { asr: null, translation: 't' } });
    expect(await checkLocalInference(defaults, told('local_inference'))).toEqual({ ok: true });
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: 'local', speech: null, transcription: null });
  });

  it('a recognition model is not enough: without the translation model it is not ready, in the code of models that are missing', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, told('local_inference'))).toMatchObject({ ok: false, code: 'local_models_missing' });
  });

  it('with both legs, each direction needs its translation: no leg runs transcription-only here', async () => {
    resolved({ 'ja>en': { translation: 't' }, 'en>ja': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, told('local_inference', ['speaker', 'participant']))).toMatchObject({ ok: false, code: 'local_models_missing', reason: expect.stringContaining('reverse') });
    resolved({ 'ja>en': { translation: 't' }, 'en>ja': { translation: 'u' } });
    expect(await checkLocalInference(defaults, told('local_inference', ['speaker', 'participant']))).toEqual({ ok: true });
  });

  it('with the participant leg alone, only the reverse direction is asked for', async () => {
    resolved({ 'en>ja': { translation: 'u' } });
    expect(await checkLocalInference(defaults, told('local_inference', ['participant']))).toEqual({ ok: true });
    resolved({ 'ja>en': { translation: 't' } });
    expect(await checkLocalInference(defaults, told('local_inference', ['participant']))).toMatchObject({ ok: false, code: 'local_models_missing', reason: expect.stringContaining('selected') });
  });

  it('Bing needs no download, and no model of this machine at all', async () => {
    resolved({});
    expect(await checkLocalInference(defaults, told('bing'))).toEqual({ ok: true });
    expect(await checkLocalInference(defaults, told('bing', ['speaker', 'participant']))).toEqual({ ok: true });
  });

  it('Bing is not ready for a pair it does not take, even where a model of this machine would translate it', async () => {
    resolved({ 'la>en': { translation: 't' }, 'en>la': { translation: 'u' } });
    expect(await checkLocalInference(defaults, told('bing', ['speaker'], { source: 'la', target: 'en' }))).toMatchObject({ ok: false, code: 'local_models_missing' });
    expect(await checkLocalInference(defaults, told('local_inference', ['speaker'], { source: 'la', target: 'en' }))).toEqual({ ok: true });
  });

  it('with translation and speech on this device and transcription elsewhere, speech still never gates', async () => {
    resolved({ 'ja>en': { translation: 't', tts: null } });
    const ctx = { pair: { source: 'ja', target: 'en' }, legs: ['speaker'], stages: ['translation', 'speech'], stageIds: { translation: 'local_inference', speech: 'local_inference' } } as const;
    expect(await checkLocalInference(defaults, ctx)).toEqual({ ok: true });
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: 'local', speech: 'local', transcription: null });
  });

  it('told no stages, a stored line-up that gives it translation alone is read the same way', async () => {
    mockStages = { translation: 'local', speech: null, transcription: null } as MockStages;
    resolved({ 'ja>en': { asr: null, translation: 't' } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toEqual({ ok: true });
    resolved({ 'ja>en': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toMatchObject({ ok: false, code: 'local_models_missing' });
    mockStages = null;
  });
});

describe('readiness when this device transcribes what another provider translates', () => {
  const told = (legs: readonly ('speaker' | 'participant')[] = ['speaker'], speech = false): Parameters<typeof checkLocalInference>[1] => ({
    pair: { source: 'ja', target: 'en' }, legs,
    stages: speech ? ['transcription', 'speech'] : ['transcription'],
    stageIds: speech ? { transcription: 'local_inference', speech: 'local_inference' } : { transcription: 'local_inference' },
  });

  it('asks for the recognition model of the direction and for no translation model', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, told())).toEqual({ ok: true });
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: null, speech: null, transcription: 'local' });
  });

  it('a translation model is not enough: without the recognition model it is not ready, naming the language no model recognises', async () => {
    resolved({ 'ja>en': { asr: null, translation: 't' } });
    expect(await checkLocalInference(defaults, told())).toMatchObject({ ok: false, code: 'no_asr', params: { source: 'ja' } });
  });

  it('with both legs, each direction needs its recognition, and the reverse one is named by its own source', async () => {
    resolved({ 'ja>en': { asr: 'a' }, 'en>ja': { asr: null, translation: 'u' } });
    expect(await checkLocalInference(defaults, told(['speaker', 'participant']))).toEqual({
      ok: false, code: 'no_asr', params: { source: 'en' }, reason: expect.stringContaining('reverse'),
    });
    resolved({ 'ja>en': { asr: null }, 'en>ja': { asr: null } });
    expect(await checkLocalInference(defaults, told(['speaker', 'participant']))).toMatchObject({ ok: false, code: 'no_asr', params: { source: 'ja' } });
    resolved({ 'ja>en': { asr: 'a' }, 'en>ja': { asr: 'b' } });
    expect(await checkLocalInference(defaults, told(['speaker', 'participant']))).toEqual({ ok: true });
  });

  it('with the participant leg alone, only the reverse direction is asked for', async () => {
    resolved({ 'en>ja': { asr: 'b' } });
    expect(await checkLocalInference(defaults, told(['participant']))).toEqual({ ok: true });
    expect(mockResolve).not.toHaveBeenCalledWith('ja', 'en', expect.anything(), expect.anything());
    resolved({ 'ja>en': { asr: 'a' } });
    expect(await checkLocalInference(defaults, told(['participant']))).toMatchObject({ ok: false, code: 'no_asr', params: { source: 'en' } });
  });

  it('with transcription and speech on this device and translation elsewhere, speech still never gates', async () => {
    resolved({ 'ja>en': { asr: 'a', tts: null } });
    expect(await checkLocalInference(defaults, told(['speaker'], true))).toEqual({ ok: true });
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: null, speech: 'local', transcription: 'local' });
  });

  it('told no stages, a stored line-up that gives it transcription alone is read the same way', async () => {
    mockStages = { translation: null, speech: 'edge', transcription: 'local' };
    resolved({ 'ja>en': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toEqual({ ok: true });
    resolved({ 'ja>en': { asr: null, translation: 't' } });
    expect(await checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).toMatchObject({ ok: false, code: 'no_asr' });
    mockStages = null;
  });
});
