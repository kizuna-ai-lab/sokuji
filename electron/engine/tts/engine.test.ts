// @vitest-environment node
/** The TTS engine (ported from sidecar/tests/test_tts_engine.py): init through the resolver, voices, one-shot and streaming output. */
import '../test/env';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Plan } from '../planner';
import type { OnChunk } from './backend';
import { dspSeams, restoreDspSeams } from './dsp';
import { TtsEngine, engineSeams, restoreEngineSeams, type TtsBackendLike } from './engine';

const linear = (pcm: Float32Array, _ch: number, from: number, to: number) => {
  const n = Math.round(pcm.length * to / from);
  return Float32Array.from({ length: n }, (_, i) => pcm[Math.min(pcm.length - 1, Math.floor(i * from / to))]);
};
const plan = (backend: string, ttsFamily = '') => ({ backend, tier: 'cpu', device: 'cpu', computeType: 'fp32', artifact: 'repo', rank: 1, config: { ttsFamily } } as unknown as Plan);
const samplesOf = (pcm: Uint8Array) => pcm.length / 2;

/** Python's _FakeOneShot: 16 kHz, one second of ones. */
const oneShot = (over: Partial<TtsBackendLike> = {}): TtsBackendLike & Record<string, any> => ({
  STREAMING: false, CLONES: false, language: null, builtin: null, unloaded: false,
  setLanguage(this: any, l: string) { this.language = l; },
  setBuiltinVoice(this: any, n: string) { this.builtin = n; },
  listBuiltinVoices: () => ['Ava', 'Bella'],
  generate: async (): Promise<[Float32Array, number, number]> => [new Float32Array(16000).fill(1), 16000, 50],
  unload(this: any) { this.unloaded = true; },
  ...over,
});

/** Python's _FakeStream: 24 kHz, three chunks of 8000 ones. */
const stream = (over: Partial<TtsBackendLike> = {}): TtsBackendLike & Record<string, any> => ({
  STREAMING: true, CLONES: true, voice: null, cancels: 0,
  setVoice(this: any, a: Float32Array, sr: number, refText?: string) { this.voice = [a.length, sr, refText]; },
  setBuiltinVoice() {},
  cancel(this: any) { this.cancels++; },
  generate: async (): Promise<[Float32Array, number, number]> => [new Float32Array(24000).fill(1), 24000, 30],
  generateStream: async (_t: string, _s: number, signal: AbortSignal | undefined, onChunk: OnChunk) => {
    for (let i = 0; i < 3; i++) if (!signal?.aborted) onChunk(new Float32Array(8000).fill(1), 24000, 1);
  },
  unload() {},
  ...over,
});

const stub = (backend: TtsBackendLike, p = plan('fake')) => {
  engineSeams.resolveTts = async () => [p];
  engineSeams.loadMeasured = async () => [backend, p, null, null];
  engineSeams.measureRtfTts = async () => 0.1;
};
const collect = () => {
  const sent: Array<[Record<string, any>, Uint8Array | null | undefined]> = [];
  return { sent, send: async (m: Record<string, any>, b?: Uint8Array | null) => { sent.push([m, b]); } };
};

beforeEach(() => { dspSeams.resample = linear; });
afterEach(() => {
  restoreEngineSeams();
  restoreDspSeams();
});

describe('init', () => {
  it('records the plan and always speaks 24 kHz', async () => {
    stub(oneShot(), plan('fake_oneshot'));
    const eng = new TtsEngine();
    await eng.init('piper-en-amy');
    expect([eng.sampleRate, eng.streaming, eng.clones, eng.resolved!.backend, eng.modelId, eng.isLoaded]).toEqual([24000, false, false, 'fake_oneshot', 'piper-en-amy', true]);
    expect(eng.resolved!.rtf).toBe(0.1);
  });

  it("reports the plan's family, and none when it has none", async () => {
    stub(oneShot(), plan('fake', 'moss_tts_nano'));
    const eng = new TtsEngine();
    await eng.init('moss-tts-nano');
    expect(eng.resolved!.family).toBe('moss_tts_nano');
    stub(oneShot(), plan('fake'));
    await eng.init('piper-en-amy');
    expect('family' in eng.resolved!).toBe(false);
  });

  it('hands the language to the backend; close clears the model', async () => {
    const b = oneShot();
    stub(b);
    const eng = new TtsEngine();
    await eng.init('piper-en-amy', 'auto', 'ja');
    expect(b.language).toBe('ja');
    await eng.close();
    expect([eng.modelId, eng.isLoaded, b.unloaded]).toEqual([null, false, true]);
  });
});

describe('voices', () => {
  it('a clip passes its reference text, empty when none was given', async () => {
    const b = stream();
    stub(b);
    const eng = new TtsEngine();
    await eng.init('moss-tts-nano');
    await eng.setVoice(new Float32Array(2400), 24000);
    expect(b.voice).toEqual([2400, 24000, '']);
    await eng.setVoice(new Float32Array(2400), 24000, 'hello');
    expect(b.voice).toEqual([2400, 24000, 'hello']);
  });

  it('a built-in voice and the listing pass through; a backend without a listing lists none', async () => {
    const b = oneShot();
    stub(b);
    const eng = new TtsEngine();
    await eng.init('piper-en-amy');
    await eng.setBuiltinVoice('Ava');
    expect(b.builtin).toBe('Ava');
    expect(await eng.listBuiltinVoices()).toEqual(['Ava', 'Bella']);
    stub(stream());
    await eng.init('moss-tts-nano');
    expect(await eng.listBuiltinVoices()).toEqual([]);
  });

  it('cancelActive reaches the backend; with nothing loaded it does nothing', async () => {
    const eng = new TtsEngine();
    eng.cancelActive();
    const b = stream();
    stub(b);
    await eng.init('moss-tts-nano');
    eng.cancelActive();
    expect(b.cancels).toBe(1);
  });
});

describe('one-shot output', () => {
  it('is 24 kHz PCM, resampled from the rate the synth actually returned', async () => {
    stub(oneShot({ generate: async () => [new Float32Array(16000).fill(1), 16000, 50] }));
    const eng = new TtsEngine();
    await eng.init('piper-en-amy');
    const [pcm, ms] = await eng.generate('hello');
    expect([Math.abs(samplesOf(pcm) - 24000) <= 2, ms]).toEqual([true, 50]);
  });

  it('a stereo synth is downmixed end to end', async () => {
    const lr = new Float32Array(48000);
    for (let i = 0; i < 24000; i++) { lr[2 * i] = 1; lr[2 * i + 1] = -1; }
    stub(oneShot({ generate: async () => [lr, 24000, 42, 2] }));
    const eng = new TtsEngine();
    await eng.init('moss-tts-nano');
    const [pcm, ms] = await eng.generate('hello');
    const s = new Int16Array(pcm.buffer);
    expect([ms, s.length, Math.max(...s), Math.min(...s)]).toEqual([42, 24000, 0, 0]);
  });
});

describe('streaming output', () => {
  it('chunks, then done with the total', async () => {
    stub(stream());
    const eng = new TtsEngine();
    await eng.init('moss-tts-nano');
    const { sent, send } = collect();
    await eng.generateStream('hi', 1, send, undefined, 'm1');
    expect(sent.map(([m]) => m.type)).toEqual(['tts_chunk', 'tts_chunk', 'tts_chunk', 'tts_done']);
    expect(sent.slice(0, 3).map(([m]) => m.seq)).toEqual([0, 1, 2]);
    expect(sent.slice(0, 3).every(([, b]) => b instanceof Uint8Array && b.length === 16000)).toBe(true);
    expect(sent[3][0]).toMatchObject({ id: 'm1', totalSamples: 24000 });
  });

  it('resamples each chunk at its own rate', async () => {
    stub(stream({ generateStream: async (_t, _s, _sig, onChunk) => { onChunk(new Float32Array(8000).fill(1), 16000, 1); } }));
    const eng = new TtsEngine();
    await eng.init('moss-tts-nano');
    const { sent, send } = collect();
    await eng.generateStream('hi', 1, send, undefined, 'm1');
    expect(Math.abs(sent[0][1]!.length / 2 - 12000)).toBeLessThanOrEqual(2);
  });

  it('an aborted stream sends no chunks, and still closes with tts_done', async () => {
    stub(stream());
    const eng = new TtsEngine();
    await eng.init('moss-tts-nano');
    const { sent, send } = collect();
    const controller = new AbortController();
    controller.abort();
    await eng.generateStream('hi', 1, send, controller.signal, 'm2');
    expect(sent.map(([m]) => m.type)).toEqual(['tts_done']);
  });

  it('an abort while sends are queued stops the chunks still waiting', async () => {
    stub(stream({ generateStream: async (_t, _s, _sig, onChunk) => { for (let i = 0; i < 3; i++) onChunk(new Float32Array(8000).fill(1), 24000, 1); } }));
    const eng = new TtsEngine();
    await eng.init('moss-tts-nano');
    const controller = new AbortController();
    const sent: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const send = async (m: Record<string, any>) => { sent.push(m.type); if (sent.length === 1) { controller.abort(); await gate; } };
    const done = eng.generateStream('hi', 1, send, controller.signal, 'q');
    await new Promise((r) => setTimeout(r, 10));
    release();
    await done;
    expect(sent.filter((t) => t === 'tts_chunk')).toHaveLength(1);
  });

  it('a synthesis failure sends an error, not tts_done', async () => {
    stub(stream({ generateStream: async (_t, _s, _sig, onChunk) => { onChunk(new Float32Array(8000).fill(1), 24000, 1); throw new Error('decoder blew up'); } }));
    const eng = new TtsEngine();
    await eng.init('moss-tts-nano');
    const { sent, send } = collect();
    await eng.generateStream('hi', 1, send, undefined, 'm3');
    expect(sent.map(([m]) => m.type)).toEqual(['tts_chunk', 'error']);
    expect(sent[1][0]).toEqual({ type: 'error', id: 'm3', message: 'decoder blew up' });
  });
});
