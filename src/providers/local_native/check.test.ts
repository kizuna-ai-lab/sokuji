import { describe, expect, it, vi } from 'vitest';
import type { NativeReadinessInput } from '../../lib/local-inference/native/nativeCatalog';
import { fakeNativeModels } from '../../lib/local-inference/native/nativeModels.testing';
import type { CheckContext } from '../../lib/provider/types';
import type { RunStage } from '../../lib/lineup/types';
import { checkLocalNative, NATIVE_READINESS_CODES } from './check';
import { LOCAL_NATIVE_DEFAULTS } from './settings';

const pair = { source: 'ja', target: 'en' };

/** The gate as a fake that keeps every input it is asked with, and answers `answer`. */
function recordingGate(answer: { ready: boolean; reason: string } = { ready: true, reason: 'ready' }) {
  const inputs: NativeReadinessInput[] = [];
  const facts = fakeNativeModels({ ensureSelectionReady: async (read) => { inputs.push(read()); return { ...answer, notes: [] } as never; } });
  return { facts, lastInput: () => inputs[inputs.length - 1] };
}

describe('checkLocalNative', () => {
  it('hands the gate the pair, its own selections, the legs as a mode, and never text-only (#578 ruling 16)', async () => {
    let seen: NativeReadinessInput | undefined;
    const nativeModels = fakeNativeModels({ ensureSelectionReady: async (read) => { seen = read(); return { ready: true, reason: 'ready', notes: [] }; } });
    const selections = { 'ja→en': { asr: { modelId: 'a' }, translation: { modelId: '' }, tts: { modelId: '' } } };
    await expect(checkLocalNative({ ...LOCAL_NATIVE_DEFAULTS, selections }, { pair, legs: ['participant'], nativeModels })).resolves.toEqual({ ok: true });
    expect(seen).toEqual({ selection: { sourceLanguage: 'ja', targetLanguage: 'en' }, selections, mode: 'participant', textOnly: false, needs: { asr: true, translation: true } });
  });

  it('says why by a code for every reason (#578 ruling 5)', async () => {
    for (const [reason, code] of Object.entries(NATIVE_READINESS_CODES)) {
      const nativeModels = fakeNativeModels({ ensureSelectionReady: async () => ({ ready: false, reason: reason as never, notes: [] }) });
      const r = await checkLocalNative(LOCAL_NATIVE_DEFAULTS, { pair, legs: ['speaker'], nativeModels });
      expect(r, reason).toMatchObject({ ok: false, code });
      expect((r as { reason: string }).reason.length, reason).toBeGreaterThan(0);
    }
  });

  it("passes the start's signal to the gate", async () => {
    const ensureSelectionReady = vi.fn(async () => ({ ready: true as const, reason: 'ready' as const, notes: [] }));
    const signal = new AbortController().signal;
    await checkLocalNative(LOCAL_NATIVE_DEFAULTS, { pair, legs: ['speaker'], nativeModels: fakeNativeModels({ ensureSelectionReady }), signal });
    expect(ensureSelectionReady).toHaveBeenCalledWith(expect.any(Function), signal);
  });

  it("throws when not handed this device's native models", async () => {
    await expect(checkLocalNative(LOCAL_NATIVE_DEFAULTS, { pair, legs: ['speaker'] })).rejects.toThrow(/CheckContext\.nativeModels/);
  });

  it.each([
    [undefined, { asr: true, translation: true }],
    [['transcription', 'translation', 'speech'], { asr: true, translation: true }],
    [['transcription'], { asr: true, translation: false }],
    [['translation'], { asr: false, translation: true }],
    [['translation', 'speech'], { asr: false, translation: true }],
    [['speech'], { asr: false, translation: false }],
  ] as Array<[RunStage[] | undefined, { asr: boolean; translation: boolean }]>)('asks the gate for the models its stages need: %j (#578 ruling 20)', async (stages, needs) => {
    const { facts, lastInput } = recordingGate();
    const ctx: CheckContext = { pair, legs: ['speaker'], nativeModels: facts, ...(stages ? { stages } : {}) };
    await checkLocalNative(LOCAL_NATIVE_DEFAULTS, ctx);
    expect(lastInput().needs).toEqual(needs);
  });

  it('a voice alone is held back only by the engine (#578 ruling 20)', async () => {
    const absent = recordingGate({ ready: false, reason: 'engine-absent' });
    await expect(checkLocalNative(LOCAL_NATIVE_DEFAULTS, { pair, legs: ['speaker'], stages: ['speech'], nativeModels: absent.facts }))
      .resolves.toMatchObject({ ok: false, code: 'native_engine_required' });
    // Ready with no recognition or translation model: a voice alone asks for neither.
    const ready = recordingGate();
    await expect(checkLocalNative(LOCAL_NATIVE_DEFAULTS, { pair, legs: ['speaker'], stages: ['speech'], nativeModels: ready.facts })).resolves.toEqual({ ok: true });
    expect(ready.lastInput().needs).toEqual({ asr: false, translation: false });
  });
});
