import { describe, it, expect, vi, beforeEach } from 'vitest';
import { directionKey, type DirectionResult, type Selections } from '../../lib/local-inference/selection/types';
import { fakeLocalModels } from '../../lib/local-inference/selection/localModels.testing';
import type { CheckContext } from '../../lib/provider/types';
import { checkLocalInference } from './check';
import { LOCAL_INFERENCE_DEFAULTS } from './settings';

/** One direction's table entry: an id per stage, or absent/null for "does not
 *  resolve". `autoTranslation` is what the translation stage resolves to once
 *  that direction's stored translation selection is auto (`''`) — what the AST
 *  cross-stage guard's re-resolution asks for. */
type TableEntry = { asr?: string | null; translation?: string | null; tts?: string | null; autoTranslation?: string | null };
type Table = Record<string, TableEntry>;

let mockTable: Table = {};
type MockStages = { translation: 'local' | null; speech: 'local' | null; transcription?: 'local' | null } | null;
// As the engine resolves with a line-up's local stages (`resolveWasmDirection`): nothing resolves for recognition
// or translation while another provider translates (but recognition where this device transcribes alone).
const mockResolve = vi.fn((src: string, tgt: string, selections: Selections, stages?: MockStages): DirectionResult => {
  const entry = mockTable[`${src}>${tgt}`];
  const stage = (id: string | null | undefined) => (id ? { modelId: id, source: 'explicit' as const } : null);
  const translationAuto = selections[directionKey(src, tgt)]?.translation.modelId === '';
  const elsewhere = stages != null && stages.translation === null;
  const translation = translationAuto ? entry?.autoTranslation : entry?.translation;
  return {
    asr: stage(elsewhere && stages?.transcription !== 'local' ? null : entry?.asr),
    translation: stage(elsewhere ? null : translation),
    tts: stage(entry?.tts),
    notes: [],
    prunes: [],
  };
});

/** Sets what `resolve(src, tgt, …)` answers, keyed `${src}>${tgt}`. */
function resolved(table: Table): void {
  mockTable = table;
}

/** What a check is handed: `ctx`, with this device's models, scanned and resolved by `mockResolve`. */
function withModels(ctx: CheckContext): CheckContext {
  return { ...ctx, localModels: fakeLocalModels({ resolve: mockResolve }) };
}

const defaults = LOCAL_INFERENCE_DEFAULTS;

beforeEach(() => {
  mockTable = {};
  mockResolve.mockClear();
});

describe('checkLocalInference', () => {
  it("waits for this device's models to be scanned, with the start's signal, before it resolves anything", async () => {
    let release!: () => void;
    const scanned = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const signal = new AbortController().signal;
    resolved({ 'ja>en': { asr: 'a', translation: 't' } });
    const answer = checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'], signal, localModels: fakeLocalModels({ scanned, resolve: mockResolve }) });
    await Promise.resolve();
    expect(scanned).toHaveBeenCalledWith(signal);
    expect(mockResolve).not.toHaveBeenCalled();
    release();
    await expect(answer).resolves.toEqual({ ok: true });
  });

  it('rejects with what the scan rejects with: a start cancelled while it waits', async () => {
    const reason = new Error('cancelled');
    await expect(checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'], localModels: fakeLocalModels({ scanned: () => Promise.reject(reason) }) })).rejects.toBe(reason);
  });

  it("throws when it is asked without this device's models", async () => {
    await expect(checkLocalInference(defaults, { pair: { source: 'ja', target: 'en' }, legs: ['speaker'] })).rejects.toThrow(/CheckContext\.localModels/);
  });

  it('is ready when the speaker direction has ASR and translation, whatever TTS', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: null } });
    expect(await checkLocalInference(defaults, withModels({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'] }))).toEqual({ ok: true });
  });

  it('names what the speaker direction lacks', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, withModels({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'] }))).toEqual({
      ok: false,
      reason: 'Required models are not available for the selected language pair.',
      code: 'local_models_missing',
    });
  });

  it('with both legs, also requires the reverse direction\'s ASR, and names that direction when it lacks one', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' }, 'en>ja': { asr: null, translation: 't2' } });
    expect(await checkLocalInference(defaults, withModels({ pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'] }))).toEqual({
      ok: false,
      reason: 'Required models are not available for the reverse language pair.',
      code: 'no_asr',
      params: { source: 'en' },
    });
  });

  it('with both legs, is ready when the reverse direction has ASR but no translation: it runs transcription-only', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' }, 'en>ja': { asr: 'a2', translation: null } });
    expect(await checkLocalInference(defaults, withModels({ pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'] }))).toEqual({ ok: true });
  });

  it('with both legs, names the speaker direction first when both lack models', async () => {
    resolved({ 'ja>en': { asr: null, translation: null }, 'en>ja': { asr: null, translation: null } });
    expect(await checkLocalInference(defaults, withModels({ pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'] }))).toEqual({
      ok: false,
      reason: 'Required models are not available for the selected language pair.',
      code: 'local_models_missing',
    });
  });

  it('with the speaker leg alone, never asks the reverse direction', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' }, 'en>ja': { asr: null, translation: null } });
    expect(await checkLocalInference(defaults, withModels({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'] }))).toEqual({ ok: true });
    expect(mockResolve.mock.calls.map(([src, tgt]) => `${src}>${tgt}`)).toEqual(['ja>en']);
  });

  it('with the participant leg alone, requires the reverse direction\'s ASR and translation', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't' }, 'en>ja': { asr: 'a2', translation: null } });
    expect((await checkLocalInference(defaults, withModels({ pair: { source: 'ja', target: 'en' }, legs: ['participant'] }))).ok).toBe(false);
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
    expect(await checkLocalInference({ ...defaults, selections }, withModels({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'] }))).toEqual({
      ok: false,
      reason: 'Required models are not available for the selected language pair.',
      code: 'local_models_missing',
    });
  });

});

describe('the stages the readiness check resolves under', () => {
  it('told no stages, it serves every stage of its own: this machine\'s models, and never a null that keeps Bing and Edge among the choices', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: null } });
    await checkLocalInference(defaults, withModels({ pair: { source: 'ja', target: 'en' }, legs: ['speaker'] }));
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: 'local', speech: 'local' });
    expect(mockResolve).not.toHaveBeenCalledWith('ja', 'en', expect.anything(), null);
  });

  it('told it only speaks, it is ready with no recognition and no translation model, and nothing is asked of the models', async () => {
    resolved({});
    mockResolve.mockClear();
    expect(await checkLocalInference(defaults, withModels({ pair: { source: 'ja', target: 'en' }, legs: ['speaker', 'participant'], stages: ['speech'] }))).toEqual({ ok: true });
    // Not even a speech model is asked for: one that is missing is said when the session starts.
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('told it transcribes and translates, it resolves those stages with its models', async () => {
    const ctx = { pair: { source: 'ja', target: 'en' }, legs: ['speaker'], stages: ['transcription', 'translation'] } as const;
    resolved({});
    expect(await checkLocalInference(defaults, withModels(ctx))).toMatchObject({ ok: false, code: 'local_models_missing' });
    resolved({ 'ja>en': { asr: 'a', translation: 't', tts: null } });
    mockResolve.mockClear();
    expect(await checkLocalInference(defaults, withModels(ctx))).toEqual({ ok: true });
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: 'local', speech: null });
  });
});

describe('readiness when this device translates what another provider transcribes', () => {
  const told = (legs: readonly ('speaker' | 'participant')[] = ['speaker'], pair = { source: 'ja', target: 'en' }) => ({
    pair, legs, stages: ['translation'],
  }) as const;

  it('asks for the translation model of the direction and for no recognition model', async () => {
    resolved({ 'ja>en': { asr: null, translation: 't' } });
    expect(await checkLocalInference(defaults, withModels(told()))).toEqual({ ok: true });
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: 'local', speech: null, transcription: null });
  });

  it('a recognition model is not enough: without the translation model it is not ready, in the code of models that are missing', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, withModels(told()))).toMatchObject({ ok: false, code: 'local_models_missing' });
  });

  it('with both legs, each direction needs its translation: no leg runs transcription-only here', async () => {
    resolved({ 'ja>en': { translation: 't' }, 'en>ja': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, withModels(told(['speaker', 'participant'])))).toMatchObject({ ok: false, code: 'local_models_missing', reason: expect.stringContaining('reverse') });
    resolved({ 'ja>en': { translation: 't' }, 'en>ja': { translation: 'u' } });
    expect(await checkLocalInference(defaults, withModels(told(['speaker', 'participant'])))).toEqual({ ok: true });
  });

  it('with the participant leg alone, only the reverse direction is asked for', async () => {
    resolved({ 'en>ja': { translation: 'u' } });
    expect(await checkLocalInference(defaults, withModels(told(['participant'])))).toEqual({ ok: true });
    resolved({ 'ja>en': { translation: 't' } });
    expect(await checkLocalInference(defaults, withModels(told(['participant'])))).toMatchObject({ ok: false, code: 'local_models_missing', reason: expect.stringContaining('selected') });
  });

  it('with translation and speech on this device and transcription elsewhere, speech still never gates', async () => {
    resolved({ 'ja>en': { translation: 't', tts: null } });
    const ctx = { pair: { source: 'ja', target: 'en' }, legs: ['speaker'], stages: ['translation', 'speech'] } as const;
    expect(await checkLocalInference(defaults, withModels(ctx))).toEqual({ ok: true });
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: 'local', speech: 'local', transcription: null });
  });

});

describe('readiness when this device transcribes what another provider translates', () => {
  const told = (legs: readonly ('speaker' | 'participant')[] = ['speaker'], speech = false): Parameters<typeof checkLocalInference>[1] => ({
    pair: { source: 'ja', target: 'en' }, legs,
    stages: speech ? ['transcription', 'speech'] : ['transcription'],
  });

  it('asks for the recognition model of the direction and for no translation model', async () => {
    resolved({ 'ja>en': { asr: 'a', translation: null } });
    expect(await checkLocalInference(defaults, withModels(told()))).toEqual({ ok: true });
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: null, speech: null, transcription: 'local' });
  });

  it('a translation model is not enough: without the recognition model it is not ready, naming the language no model recognises', async () => {
    resolved({ 'ja>en': { asr: null, translation: 't' } });
    expect(await checkLocalInference(defaults, withModels(told()))).toMatchObject({ ok: false, code: 'no_asr', params: { source: 'ja' } });
  });

  it('with both legs, each direction needs its recognition, and the reverse one is named by its own source', async () => {
    resolved({ 'ja>en': { asr: 'a' }, 'en>ja': { asr: null, translation: 'u' } });
    expect(await checkLocalInference(defaults, withModels(told(['speaker', 'participant'])))).toEqual({
      ok: false, code: 'no_asr', params: { source: 'en' }, reason: expect.stringContaining('reverse'),
    });
    resolved({ 'ja>en': { asr: null }, 'en>ja': { asr: null } });
    expect(await checkLocalInference(defaults, withModels(told(['speaker', 'participant'])))).toMatchObject({ ok: false, code: 'no_asr', params: { source: 'ja' } });
    resolved({ 'ja>en': { asr: 'a' }, 'en>ja': { asr: 'b' } });
    expect(await checkLocalInference(defaults, withModels(told(['speaker', 'participant'])))).toEqual({ ok: true });
  });

  it('with the participant leg alone, only the reverse direction is asked for', async () => {
    resolved({ 'en>ja': { asr: 'b' } });
    expect(await checkLocalInference(defaults, withModels(told(['participant'])))).toEqual({ ok: true });
    expect(mockResolve).not.toHaveBeenCalledWith('ja', 'en', expect.anything(), expect.anything());
    resolved({ 'ja>en': { asr: 'a' } });
    expect(await checkLocalInference(defaults, withModels(told(['participant'])))).toMatchObject({ ok: false, code: 'no_asr', params: { source: 'en' } });
  });

  it('with transcription and speech on this device and translation elsewhere, speech still never gates', async () => {
    resolved({ 'ja>en': { asr: 'a', tts: null } });
    expect(await checkLocalInference(defaults, withModels(told(['speaker'], true)))).toEqual({ ok: true });
    expect(mockResolve).toHaveBeenCalledWith('ja', 'en', expect.anything(), { translation: null, speech: 'local', transcription: 'local' });
  });
});
