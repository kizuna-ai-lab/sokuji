// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { NativeAsrClient } from './NativeAsrClient';
import { FakeSidecarConnection } from './fakeSidecarConnection';

describe('NativeAsrClient', () => {
  it('init() sends asr_init with device override and returns device + rtf', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeAsrClient(conn);
    const p = c.init('en', 'granite-speech-4.1-2b', 24000, undefined, 'cuda');
    const sent = conn.sent[0];
    expect(sent).toMatchObject({ type: 'asr_init', language: 'en', model: 'granite-speech-4.1-2b', device: 'cuda' });
    conn.emit({ type: 'ready', id: sent.id, loadTimeMs: 2, device: 'cuda', rtf: 0.5 });
    await expect(p).resolves.toMatchObject({ loadTimeMs: 2, device: 'cuda', rtf: 0.5 });
  });

  it('feedAudio() sends the raw buffer as a binary frame', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeAsrClient(conn);
    const samples = new Int16Array(24000);
    c.feedAudio(samples, 24000);
    expect(conn.binarySent).toHaveLength(1);
    expect(conn.binarySent[0]).toBe(samples.buffer);
  });

  it('routes id-less push messages to their callbacks', () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeAsrClient(conn);
    const partials: string[] = []; const finals: string[] = []; let starts = 0;
    c.onPartialResult = (t) => partials.push(t);
    c.onResult = (r) => finals.push(r.text);
    c.onSpeechStart = () => { starts++; };
    conn.emit({ type: 'speech_start' });
    conn.emit({ type: 'partial', text: 'he llo' });
    conn.emit({ type: 'result', text: 'hello world', durationMs: 1000, recognitionTimeMs: 50 });
    expect(starts).toBe(1);
    expect(partials).toEqual(['he llo']);
    expect(finals).toEqual(['hello world']);
  });

  it('flush() resolves on the ok reply and rejects on an error reply', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeAsrClient(conn);
    const okP = c.flush();
    conn.emit({ type: 'ok', id: conn.sent[0].id });
    await expect(okP).resolves.toBeUndefined();
    const errP = c.flush();
    conn.emit({ type: 'error', id: conn.sent[1].id, message: 'flush-boom' });
    await expect(errP).rejects.toThrow('flush-boom');
  });

  it('dispose() rejects a pending flush', async () => {
    const conn = new FakeSidecarConnection();
    const c = new NativeAsrClient(conn);
    const p = c.flush();
    c.dispose();
    await expect(p).rejects.toThrow('native host disconnected');
  });
});
