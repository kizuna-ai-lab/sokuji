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
  constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); }
  send(d: any) {
    this.sent.push(d);
    const msg = typeof d === 'string' ? JSON.parse(d) : null;
    if (msg?.type === 'tts_init') queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
      { type: 'ready', id: msg.id, sampleRate: 24000, loadTimeMs: 5,
        device: 'cpu', backend: 'moss_onnx', rtf: 0.44,
        streaming: FakeWS.streaming, clones: FakeWS.streaming }) }));
    if (msg?.type === 'tts_generate') {
      if (FakeWS.streaming) {
        for (let i = 0; i < 3; i++) {
          const pcm = new Float32Array([i / 10, i / 10, i / 10]);
          queueMicrotask(() => this.onmessage?.({ data: pcm.buffer }));
          queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: 'tts_chunk', id: msg.id, seq: i }) }));
        }
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
          { type: 'tts_done', id: msg.id, totalSamples: 9, generationTimeMs: 7 }) }));
      } else {
        const pcm = new Float32Array([0.1, 0.2, 0.3]);
        queueMicrotask(() => this.onmessage?.({ data: pcm.buffer }));
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(
          { type: 'result', id: msg.id, sampleRate: 24000, generationTimeMs: 7, samples: 3 }) }));
      }
    }
  }
  close() {}
}

beforeEach(() => {
  FakeWS.streaming = false;
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
    expect(Array.from(res.samples as Float32Array).map((x) => +x.toFixed(1))).toEqual([0.1, 0.2, 0.3]);
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
});
