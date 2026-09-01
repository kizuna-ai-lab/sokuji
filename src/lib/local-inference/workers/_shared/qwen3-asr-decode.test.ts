import { describe, expect, it, vi } from 'vitest';
import { argmax, f16ToF32, f32ToF16, greedyDecode, type DecodeDeps, type RunnableSession, type RunnableTensor } from './qwen3-asr-decode';

const HIDDEN = 4;
const VOCAB = 10;
const EOS = 9;

function logitsFor(tokenId: number): RunnableTensor {
  const data = new Float32Array(VOCAB);
  data[tokenId] = 5;
  return { data, dims: [1, 1, VOCAB], type: 'float32' };
}

function kv(tag: string) {
  const mk = () => ({ data: new Float32Array(1), dims: [28, 1, 8, 1, 128], type: 'float32', dispose: vi.fn(), tag });
  return { keys: mk(), values: mk() };
}

function makeDeps(sequence: number[], embType = 'float32') {
  const initRun = vi.fn(async () => {
    const k = kv('init');
    return { logits: logitsFor(sequence[0]), present_keys: k.keys, present_values: k.values };
  });
  let stepIdx = 0;
  const stepRun = vi.fn(async () => {
    stepIdx++;
    const k = kv(`step${stepIdx}`);
    return { logits: logitsFor(sequence[stepIdx]), present_keys: k.keys, present_values: k.values };
  });
  const init: RunnableSession = { run: initRun, inputTypes: { input_embeds: embType, position_ids: 'int64' } };
  const step: RunnableSession = { run: stepRun, inputTypes: { input_embeds: embType, position_ids: 'int64', past_keys: embType, past_values: embType } };
  const makeTensor = vi.fn((type: string, data: Float32Array | Uint16Array | BigInt64Array, dims: number[]) => ({ type, data, dims }));
  const embedRow = vi.fn((id: number) => Float32Array.from({ length: HIDDEN }, () => id));
  const deps: DecodeDeps = { init, step, makeTensor, embedRow };
  return { deps, initRun, stepRun, makeTensor, embedRow };
}

describe('greedyDecode', () => {
  it('prefills once, steps until eos, and returns the generated ids including eos', async () => {
    const { deps, initRun, stepRun, embedRow } = makeDeps([7, 8, EOS]);
    const r = await greedyDecode(deps, new Float32Array(3 * HIDDEN), 3, HIDDEN, new Set([EOS]), 32);
    expect(r.ids).toEqual([7, 8, EOS]);
    expect(r.steps).toBe(2);
    expect(initRun).toHaveBeenCalledTimes(1);
    expect(stepRun).toHaveBeenCalledTimes(2);
    expect(embedRow.mock.calls.map((c) => c[0])).toEqual([7, 8]);
  });

  it('feeds consecutive position ids continuing after the prompt', async () => {
    const { deps, initRun, stepRun } = makeDeps([1, 2, EOS]);
    await greedyDecode(deps, new Float32Array(5 * HIDDEN), 5, HIDDEN, new Set([EOS]), 32);
    const initPos = (initRun.mock.results[0].value && (initRun.mock.calls[0] as unknown[])[0]) as { position_ids: { data: BigInt64Array; dims: number[] } };
    expect(Array.from(initPos.position_ids.data)).toEqual([0n, 1n, 2n, 3n, 4n]);
    expect(initPos.position_ids.dims).toEqual([1, 5]);
    const stepPos = stepRun.mock.calls.map((c) => Array.from(((c as unknown[])[0] as { position_ids: { data: BigInt64Array } }).position_ids.data));
    expect(stepPos).toEqual([[5n], [6n]]);
  });

  it('passes the previous KV back and disposes every superseded pair, then the last one', async () => {
    const { deps, stepRun } = makeDeps([1, 2, 3, EOS]);
    await greedyDecode(deps, new Float32Array(HIDDEN), 1, HIDDEN, new Set([EOS]), 32);
    type Kv = { tag: string; dispose: ReturnType<typeof vi.fn> };
    const feeds = stepRun.mock.calls.map((c) => (c as unknown[])[0] as { past_keys: Kv; past_values: Kv });
    expect(feeds.map((f) => f.past_keys.tag)).toEqual(['init', 'step1', 'step2']);
    for (const f of feeds) {
      expect(f.past_keys.dispose).toHaveBeenCalledTimes(1);
      expect(f.past_values.dispose).toHaveBeenCalledTimes(1);
    }
    const last = (await stepRun.mock.results[2].value) as { present_keys: Kv; present_values: Kv };
    expect(last.present_keys.dispose).toHaveBeenCalledTimes(1);
    expect(last.present_values.dispose).toHaveBeenCalledTimes(1);
  });

  it('stops at maxTokens without eos', async () => {
    const { deps } = makeDeps([1, 2, 3, 4, 5, 6]);
    const r = await greedyDecode(deps, new Float32Array(HIDDEN), 1, HIDDEN, new Set([EOS]), 3);
    expect(r.ids).toEqual([1, 2, 3]);
  });

  it('routes float16 sessions through the half-precision converter', async () => {
    const { deps, makeTensor } = makeDeps([EOS], 'float16');
    await greedyDecode(deps, new Float32Array([0.5, -1, 2, 0]), 1, HIDDEN, new Set([EOS]), 8);
    const call = makeTensor.mock.calls.find((c) => c[0] === 'float16');
    expect(call).toBeDefined();
    expect(call![1]).toBeInstanceOf(Uint16Array);
    expect(Array.from(f16ToF32(call![1] as Uint16Array))).toEqual([0.5, -1, 2, 0]);
  });
});

describe('float16 helpers and argmax', () => {
  it('round-trips representable values', () => {
    const src = new Float32Array([0, 1, -1, 0.5, 65504, 1e-4, -3.25]);
    const back = f16ToF32(f32ToF16(src));
    for (let i = 0; i < src.length; i++) expect(back[i]).toBeCloseTo(src[i], src[i] > 1000 ? -2 : 3);
  });
  it('argmax returns the first maximum', () => {
    expect(argmax([1, 3, 3, 2])).toBe(1);
    expect(argmax(new Float32Array([-2, -1]))).toBe(1);
  });
});
