// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NativeTtsClient } from './NativeTtsClient';
import { FakeSidecarConnection } from './SidecarConnection.fake';

async function initClient(conn: FakeSidecarConnection, streaming: boolean) {
  const c = new NativeTtsClient(conn);
  const p = c.init('moss', 'cpu');
  conn.emit({ type: 'ready', id: conn.sent[0].id, sampleRate: 24000, loadTimeMs: 5, device: 'cpu', backend: 'moss_onnx', rtf: 0.44, streaming, clones: streaming });
  await p;
  return c;
}

describe('NativeTtsClient init', () => {
  it('sends variant with tts_init when provided', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTtsClient(conn);
    const p = c.init('qwen3-tts-1.7b', 'auto', 'en', 'bf16');
    expect(conn.sent[0]).toMatchObject({ type: 'tts_init', model: 'qwen3-tts-1.7b', variant: 'bf16' });
    conn.emit({ type: 'ready', id: conn.sent[0].id, sampleRate: 24000, loadTimeMs: 5, device: 'cpu', backend: 'qwen3_tts_onnx', rtf: 0.3, streaming: false, clones: false });
    await p;
  });

  it('omits variant when not provided (undefined, not a missing-key surprise)', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTtsClient(conn);
    const p = c.init('moss', 'cpu');
    expect(conn.sent[0]).toMatchObject({ type: 'tts_init', model: 'moss', device: 'cpu', variant: undefined });
    conn.emit({ type: 'ready', id: conn.sent[0].id, sampleRate: 24000, loadTimeMs: 5, device: 'cpu', backend: 'moss_onnx', rtf: 0.44, streaming: false, clones: false });
    await p;
  });
});

describe('NativeTtsClient one-shot', () => {
  it('generate() pairs the buffered binary with the result reply', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initClient(conn, false);
    const genP = c.generate('hi', 1.0);
    const genSent = conn.sent.find((m) => m.type === 'tts_generate');
    expect(genSent).toBeTruthy();
    // Sidecar sends the PCM binary frame BEFORE the result meta.
    const pcm = new Int16Array([16384, 16384, 16384]);
    conn.emitBinary(pcm.buffer);
    conn.emit({ type: 'tts_generate_result', id: genSent.id, sampleRate: 24000, generationTimeMs: 7, samples: 3 });
    const res = await genP;
    expect(res.sampleRate).toBe(24000);
    expect(res.generationTimeMs).toBe(7);
    expect(res.samples.length).toBe(3);
    expect(res.samples[0]).toBeCloseTo(0.5, 2);
  });
});

describe('NativeTtsClient streaming', () => {
  it('generate() emits each chunk and resolves on tts_done', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initClient(conn, true);
    const chunks: number[] = [];
    const genP = c.generate('hi', 1.0, (pcm, seq) => { chunks.push(seq); void pcm; });
    const genSent = conn.sent.find((m) => m.type === 'tts_generate');
    const id = genSent.id;
    for (let i = 0; i < 3; i++) {
      conn.emitBinary(new Int16Array([i, i, i]).buffer);
      conn.emit({ type: 'tts_chunk', id, seq: i });
    }
    conn.emit({ type: 'tts_done', id, totalSamples: 9, generationTimeMs: 20 });
    const res = await genP;
    expect(chunks).toEqual([0, 1, 2]);
    expect(res.generationTimeMs).toBe(20);
  });

  it('streaming generate() rejects if the socket closes mid-stream', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initClient(conn, true);
    const genP = c.generate('hi', 1.0, () => {});
    conn.emitClose();
    await expect(genP).rejects.toThrow('native host disconnected');
  });

  it('a correlated (id-carrying) error rejects the stream without also firing onError', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initClient(conn, true);
    let onErrorCalls = 0;
    c.onError = () => { onErrorCalls++; };
    const genP = c.generate('hi', 1.0, () => {});
    const id = conn.sent.find((m) => m.type === 'tts_generate').id;
    conn.emit({ type: 'error', id, message: 'boom' });
    await expect(genP).rejects.toThrow('boom');
    expect(onErrorCalls).toBe(0);   // the caller surfaces it via the rejection
  });

  it('an id-less push error fires onError', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initClient(conn, true);
    const errs: string[] = [];
    c.onError = (e) => errs.push(e);
    conn.emit({ type: 'error', message: 'engine crashed' });
    expect(errs).toEqual(['engine crashed']);
  });

  it('streaming generate() returns the sample rate from init, not a hardcoded value', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTtsClient(conn);
    const initP = c.init('moss', 'cpu');
    conn.emit({ type: 'ready', id: conn.sent[0].id, sampleRate: 16000, loadTimeMs: 5, device: 'cpu', backend: 'moss_onnx', rtf: 0.44, streaming: true, clones: true });
    await initP;
    const genP = c.generate('hi', 1.0, () => {});
    const id = conn.sent.find((m) => m.type === 'tts_generate').id;
    conn.emit({ type: 'tts_done', id, totalSamples: 0, generationTimeMs: 3 });
    const res = await genP;
    expect(res.sampleRate).toBe(16000);
  });
});

describe('NativeTtsClient voice selection', () => {
  it('setReferenceVoice() sends the clip binary before the set_voice control message', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initClient(conn, true);
    const clip = new Float32Array([0.1, 0.2]);
    const p = c.setReferenceVoice(clip, 24000, 'hello');
    expect(conn.binarySent[0]).toBe(clip);
    const setSent = conn.sent.find((m) => m.type === 'set_voice');
    expect(setSent).toMatchObject({ type: 'set_voice', sampleRate: 24000, refText: 'hello' });
    conn.emit({ type: 'ok', id: setSent.id });
    await expect(p).resolves.toBeUndefined();
  });

});

describe('NativeTtsClient no longer has the style/speaker voice senders', () => {
  it('setSpeaker and setStyleVoice are gone (native_tts has no equivalent)', () => {
    const c = new NativeTtsClient(new FakeSidecarConnection());
    expect((c as unknown as Record<string, unknown>).setSpeaker).toBeUndefined();
    expect((c as unknown as Record<string, unknown>).setStyleVoice).toBeUndefined();
  });
});

describe('NativeTtsClient ready.family', () => {
  it('init() surfaces the ready reply\'s family on TtsReady', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTtsClient(conn);
    const p = c.init('moss-tts-nano', 'cpu');
    conn.emit({ type: 'ready', id: conn.sent[0].id, sampleRate: 24000, loadTimeMs: 5, device: 'cpu',
      backend: 'native_tts', family: 'moss_tts_nano', streaming: true, clones: true });
    const ready = await p;
    expect(ready.family).toBe('moss_tts_nano');
  });

  it('omits family when the sidecar reply does not carry one', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeTtsClient(conn);
    const p = c.init('moss', 'cpu');
    conn.emit({ type: 'ready', id: conn.sent[0].id, sampleRate: 24000, loadTimeMs: 5, device: 'cpu',
      backend: 'moss_onnx', streaming: false, clones: false });
    const ready = await p;
    expect(ready.family).toBeUndefined();
  });
});

/** Same as initClient but with the model's measured RTF chosen by the caller:
 *  the synthesis budget is derived from it. `rtf: undefined` = a sidecar that
 *  reported none. */
async function initWithRtf(conn: FakeSidecarConnection, rtf: number | undefined, streaming = false) {
  const c = new NativeTtsClient(conn);
  const p = c.init('slow-family', 'cpu');
  conn.emit({ type: 'ready', id: conn.sent[0].id, sampleRate: 24000, loadTimeMs: 5, device: 'cpu', backend: 'native_tts', rtf, streaming, clones: false });
  await p;
  return c;
}

// The renderer used to give every synthesis the connection's flat 30s. That
// held while every family ran near real time; index_tts2 measured 7.87x on
// GB10's CPU lane, so a sentence half again as long as the 44-character test
// one outlived the timeout -- and timing out does not stop the work, since
// offline synthesis in the sidecar cannot be interrupted.
describe('NativeTtsClient synthesis budget', () => {
  const budgetOf = (conn: FakeSidecarConnection) => conn.requestOpts[conn.requestOpts.length - 1]?.timeoutMs;

  it('scales the one-shot timeout with the text length and the model RTF', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initWithRtf(conn, 7.87);
    const text = 'x'.repeat(240);                    // ~20s of speech at 12 chars/s
    void c.generate(text);
    // 20s x 7.87 x 2 safety = 314.8s, over the 300s ceiling.
    expect(budgetOf(conn)).toBe(300_000);
    const shorter = 'y'.repeat(120);                 // ~10s of speech -> 157.4s
    void c.generate(shorter);
    expect(budgetOf(conn)).toBe(157_400);
  });

  it('never shortens a timeout: a fast model still gets the old 30s floor', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initWithRtf(conn, 0.1);          // 10x faster than real time
    void c.generate('A short sentence.');
    expect(budgetOf(conn)).toBe(30_000);
  });

  it('budgets an unreported RTF like the slowest family measured, not like a fast one', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initWithRtf(conn, undefined);
    void c.generate('z'.repeat(120));                // ~10s x assumed 8 x 2 = 160s
    expect(budgetOf(conn)).toBe(160_000);
  });

  it('a streaming family waits out the first chunk on the same budget, then tightens', async () => {
    vi.useFakeTimers();
    try {
      const conn = new FakeSidecarConnection();
      const c = await initWithRtf(conn, 2.81, true);  // voxcpm2's measured CPU RTF
      const chunks: number[] = [];
      const genP = c.generate('w'.repeat(120), 1.0, (pcm) => chunks.push(pcm.length));
      const genSent = conn.sent.find((m: any) => m.type === 'tts_generate');
      // 40s in: past the old flat 30s inactivity timer, still inside the budget.
      await vi.advanceTimersByTimeAsync(40_000);
      conn.emit({ type: 'tts_chunk', id: genSent.id, seq: 0, samples: 2 } as never);
      conn.emit({ type: 'tts_done', id: genSent.id, generationTimeMs: 40_000 } as never);
      await expect(genP).resolves.toMatchObject({ sampleRate: 24000 });
    } finally {
      vi.useRealTimers();
    }
  });
});
