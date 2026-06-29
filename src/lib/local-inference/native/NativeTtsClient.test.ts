// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeTtsClient } from './NativeTtsClient';

class FakeWS {
  static last: FakeWS;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: any }) => void) | null = null;
  onerror: (() => void) | null = null;
  binaryType = 'arraybuffer';
  sent: any[] = [];
  // when true, tts_generate replies with a 3-chunk stream + tts_done; else one-shot result
  static streaming = false;
  // when set, tts_generate replies with an error instead of result/done
  static errorMessage: string | null = null;
  // when true, tts_generate response is deferred (must call FakeWS.last.flushDeferred() to send it)
  static deferResponse = false;
  private deferredBinary: any = null;
  private deferredResponse: any = null;

  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }

  flushDeferred() {
    if (this.deferredBinary) {
      this.onmessage?.(this.deferredBinary);
      this.deferredBinary = null;
    }
    if (this.deferredResponse) {
      this.onmessage?.(this.deferredResponse);
      this.deferredResponse = null;
    }
  }

  send(d: any) {
    this.sent.push(d);
    const msg = typeof d === 'string' ? JSON.parse(d) : null;
    if (msg?.type === 'tts_init') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
      { type: 'ready', id: msg.id, sampleRate: 24000, loadTimeMs: 5,
        device: 'cpu', backend: 'moss_onnx', rtf: 0.44,
        streaming: FakeWS.streaming, clones: FakeWS.streaming }) }));
    if (msg?.type === 'tts_generate') {
      if (FakeWS.errorMessage) {
        const errorResp = { data: JSON.stringify({ type: 'error', id: msg.id, message: FakeWS.errorMessage }) };
        if (FakeWS.deferResponse) {
          this.deferredResponse = errorResp;
        } else {
          queueMicrotask(() => this.onmessage?.(errorResp));
        }
      } else if (FakeWS.streaming) {
        // Sidecar emits Int16 PCM — each chunk is a small Int16Array buffer.
        for (let i = 0; i < 3; i++) {
          const val = Math.round((i / 10) * 32767);
          const pcm = new Int16Array([val, val, val]);
          queueMicrotask(() => this.onmessage?.({ data: pcm.buffer }));
          queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'tts_chunk', id: msg.id, seq: i }) }));
        }
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
          { type: 'tts_done', id: msg.id, totalSamples: 9, generationTimeMs: 7 }) }));
      } else {
        // Sidecar emits Int16 PCM: ≈ [0.1, 0.2, 0.3] × 32767 = [3277, 6554, 9831]
        const pcm = new Int16Array([3277, 6554, 9831]);
        const resultResp = { data: pcm.buffer };
        const metaResp = { data: JSON.stringify(
          { type: 'result', id: msg.id, sampleRate: 24000, generationTimeMs: 7, samples: 3 }) };
        if (FakeWS.deferResponse) {
          this.deferredBinary = resultResp;
          this.deferredResponse = metaResp;
        } else {
          queueMicrotask(() => this.onmessage?.(resultResp));
          queueMicrotask(() => this.onmessage?.(metaResp));
        }
      }
    }
  }
  close() {}
}

beforeEach(() => {
  FakeWS.streaming = false;
  FakeWS.errorMessage = null;
  FakeWS.deferResponse = false;
  (globalThis as any).WebSocket = FakeWS as any;
  (globalThis as any).window = { electron: { invoke: vi.fn().mockResolvedValue({ ok: true, port: 9 }) } };
});

describe('NativeTtsClient', () => {
  it('inits via tts_init and returns the full ready fields', async () => {
    const c = new NativeTtsClient();
    const r = await c.init('moss-tts-nano');
    expect(JSON.parse(FakeWS.last.sent[0]).type).toBe('tts_init');
    expect(r).toMatchObject({ sampleRate: 24000, loadTimeMs: 5, device: 'cpu', rtf: 0.44, streaming: false, clones: false });
  });

  it('one-shot generate sends tts_generate and returns binary PCM', async () => {
    const c = new NativeTtsClient();
    await c.init();
    const res = await c.generate('hi');
    expect(JSON.parse(FakeWS.last.sent.find((s) => typeof s === 'string' && JSON.parse(s).type === 'tts_generate')).type).toBe('tts_generate');
    expect(res.sampleRate).toBe(24000);
    // Int16 wire → decoded Float32 ≈ [0.1, 0.2, 0.3] within int16 quantization tolerance (~0.001)
    const samples = Array.from(res.samples as Float32Array);
    expect(samples[0]).toBeCloseTo(0.1, 2);
    expect(samples[1]).toBeCloseTo(0.2, 2);
    expect(samples[2]).toBeCloseTo(0.3, 2);
  });

  it('streaming generate delivers chunks via onChunk and resolves on tts_done', async () => {
    FakeWS.streaming = true;
    const c = new NativeTtsClient();
    await c.init();
    const chunks: number[] = [];
    const res = await c.generate('hi', 1.0, (pcm, seq) => chunks.push(seq) && void pcm);
    expect(chunks).toEqual([0, 1, 2]);
    expect(res.generationTimeMs).toBe(7);
  });

  it('cancel sends tts_cancel for the in-flight generation', async () => {
    FakeWS.streaming = true;
    const c = new NativeTtsClient();
    await c.init();
    const p = c.generate('hi', 1.0, () => {});
    c.cancel();
    await p;
    expect(FakeWS.last.sent.some((s) => typeof s === 'string' && JSON.parse(s).type === 'tts_cancel')).toBe(true);
  });

  it('one-shot cancel sends tts_cancel for the in-flight id', async () => {
    FakeWS.deferResponse = true;
    const c = new NativeTtsClient();
    await c.init();
    const p = c.generate('hi');
    c.cancel();
    FakeWS.last.flushDeferred();
    await p;
    const cancelMsg = FakeWS.last.sent.find((s) => typeof s === 'string' && JSON.parse(s).type === 'tts_cancel');
    expect(cancelMsg).toBeDefined();
    const generateMsg = FakeWS.last.sent.find((s) => typeof s === 'string' && JSON.parse(s).type === 'tts_generate');
    const generateId = JSON.parse(generateMsg).id;
    const cancelId = JSON.parse(cancelMsg).id;
    expect(cancelId).toBe(generateId);
    expect(cancelId).toBeGreaterThan(0);
  });

  it('a server error message rejects the pending generate (no hang)', async () => {
    FakeWS.errorMessage = 'boom';
    const c = new NativeTtsClient();
    await c.init();
    await expect(c.generate('hi')).rejects.toThrow('boom');
  });
});
