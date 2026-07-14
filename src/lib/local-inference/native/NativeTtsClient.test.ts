// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { NativeTtsClient } from './NativeTtsClient';
import { FakeSidecarConnection } from './fakeSidecarConnection';

async function initClient(conn: FakeSidecarConnection, streaming: boolean) {
  const c = new NativeTtsClient(conn);
  const p = c.init('moss', 'cpu');
  conn.emit({ type: 'ready', id: conn.sent[0].id, sampleRate: 24000, loadTimeMs: 5, device: 'cpu', backend: 'moss_onnx', rtf: 0.44, streaming, clones: streaming });
  await p;
  return c;
}

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
    conn.emit({ type: 'result', id: genSent.id, sampleRate: 24000, generationTimeMs: 7, samples: 3 });
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
});

describe('NativeTtsClient voice selection', () => {
  it('setReferenceVoice() sends the clip binary before the set_voice control message', async () => {
    const conn = new FakeSidecarConnection();
    const c = await initClient(conn, true);
    const clip = new Float32Array([0.1, 0.2]);
    const p = c.setReferenceVoice(clip, 24000, 'hello');
    expect(conn.binarySent[0]).toBe(clip.buffer);
    const setSent = conn.sent.find((m) => m.type === 'set_voice');
    expect(setSent).toMatchObject({ type: 'set_voice', sampleRate: 24000, refText: 'hello' });
    conn.emit({ type: 'ok', id: setSent.id });
    await expect(p).resolves.toBeUndefined();
  });
});
