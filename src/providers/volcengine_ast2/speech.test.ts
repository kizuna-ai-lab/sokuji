import { describe, it, expect, vi } from 'vitest';
import { flush } from '../../lib/contract/testing/drive';
import { recordEvents } from '../../lib/contract/events';
import { Ast2Speech, type OggDecoder } from './speech';

/** A decoder whose answers the test releases one by one: a clip's pcm has one sample per byte. */
function heldDecoder() {
  const waiting: Array<{ clip: Uint8Array; release(): void; fail(error: Error): void }> = [];
  const decode: OggDecoder = (clip) => new Promise((resolve, reject) => {
    waiting.push({ clip, release: () => resolve(new Int16Array(clip.length).fill(clip[0])), fail: reject });
  });
  return { decode, waiting };
}

const setup = (decode: OggDecoder) => {
  const { events, log } = recordEvents();
  return { speech: new Ast2Speech(decode, events), log, audio: () => log.filter((e) => e.kind === 'audio').map((e) => e.payload as { pcm: Int16Array; ref?: number }) };
};

describe("Doubao's spoken sentences (ruling 10)", () => {
  it('decodes the chunks of one sentence as one clip, emitted rangeless on the ref locked at its start', async () => {
    const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
    const { speech, audio } = setup(decode);
    speech.sentenceStart(2);
    speech.chunk(new Uint8Array([1, 1]));
    speech.chunk(new Uint8Array([2, 2, 2]));
    expect(speech.flush()).toEqual({ chunks: 2, bytes: 5 });
    await flush();
    expect(Array.from(decode.mock.calls[0][0])).toEqual([1, 1, 2, 2, 2]);
    expect(audio()).toEqual([{ pcm: new Int16Array(5), ref: 2 }]);
    expect(audio()[0]).not.toHaveProperty('range');
  });

  it("copies each chunk: the codec's data is a view into a buffer it reuses", async () => {
    const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
    const { speech } = setup(decode);
    const buffer = new Uint8Array([9, 9, 9, 9]);
    speech.sentenceStart(1);
    speech.chunk(buffer.subarray(0, 2));
    buffer.fill(0);
    speech.flush();
    await flush();
    expect(Array.from(decode.mock.calls[0][0])).toEqual([9, 9]);
  });

  it('keeps the first sentence on its own ref when the next one starts during its decode, and keeps the order', async () => {
    const { decode, waiting } = heldDecoder();
    const { speech, audio } = setup(decode);
    speech.sentenceStart(2);
    speech.chunk(new Uint8Array([2]));
    speech.flush();
    speech.sentenceStart(4);
    speech.chunk(new Uint8Array([4, 4]));
    speech.flush();
    await flush();
    // One decode at a time: the second waits for the first.
    expect(waiting).toHaveLength(1);
    waiting[0].release();
    await flush();
    expect(waiting).toHaveLength(2);
    waiting[1].release();
    await flush();
    expect(audio().map((a) => a.ref)).toEqual([2, 4]);
  });

  it('flushes a sentence left unended when the next one starts, on its own ref', async () => {
    const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
    const { speech, audio } = setup(decode);
    speech.sentenceStart(1);
    speech.chunk(new Uint8Array([1]));
    speech.sentenceStart(3);
    speech.chunk(new Uint8Array([3, 3]));
    speech.flush();
    await flush();
    expect(audio().map((a) => [a.ref, a.pcm.length])).toEqual([[1, 1], [3, 2]]);
  });

  it('plays a sentence with no translation yet with no ref, and decodes nothing for an empty one', async () => {
    const decode = vi.fn(async (clip: Uint8Array) => new Int16Array(clip.length));
    const { speech, audio } = setup(decode);
    speech.sentenceStart(undefined);
    speech.chunk(new Uint8Array([1]));
    speech.flush();
    expect(speech.flush()).toEqual({ chunks: 0, bytes: 0 });
    await flush();
    expect(decode).toHaveBeenCalledTimes(1);
    expect(audio()).toEqual([{ pcm: new Int16Array(1) }]);
  });

  it("says tts_degraded when a clip will not decode, and goes on with the next (reason 'tts_decode')", async () => {
    const { decode, waiting } = heldDecoder();
    const { speech, log, audio } = setup(decode);
    speech.sentenceStart(1);
    speech.chunk(new Uint8Array([1]));
    speech.flush();
    speech.sentenceStart(3);
    speech.chunk(new Uint8Array([3]));
    speech.flush();
    await flush();
    waiting[0].fail(new Error('EncodingError'));
    await flush();
    waiting[1].release();
    await flush();
    const degraded = log.filter((e) => e.kind === 'degraded').map((e) => e.payload as { code: string; reason?: string; message: string });
    expect(degraded).toEqual([{ code: 'tts_degraded', reason: 'tts_decode', message: 'A spoken sentence from Doubao could not be decoded: EncodingError', cause: expect.any(Error) }]);
    expect(audio().map((a) => a.ref)).toEqual([3]);
  });

  it('emits nothing after stop, a decode still running included', async () => {
    const { decode, waiting } = heldDecoder();
    const { speech, log } = setup(decode);
    speech.sentenceStart(1);
    speech.chunk(new Uint8Array([1]));
    speech.flush();
    await flush();
    // The clip is decoding when the session stops.
    speech.chunk(new Uint8Array([2]));
    speech.stop();
    await flush();
    waiting[0].release();
    await flush();
    expect(log).toEqual([]);
    expect(speech.flush()).toEqual({ chunks: 0, bytes: 0 });
  });

  it('says nothing after stop when a decode still running fails', async () => {
    const { decode, waiting } = heldDecoder();
    const { speech, log } = setup(decode);
    speech.sentenceStart(1);
    speech.chunk(new Uint8Array([1]));
    speech.flush();
    await flush();
    // The clip is decoding when the session stops.
    speech.stop();
    waiting[0].fail(new Error('EncodingError'));
    await flush();
    expect(log).toEqual([]);
  });

  it('decodes no clip once stopped: neither one still waiting nor one fed after', async () => {
    const { decode, waiting } = heldDecoder();
    const { speech, log } = setup(decode);
    speech.sentenceStart(1);
    speech.chunk(new Uint8Array([1]));
    speech.flush();
    speech.sentenceStart(3);
    speech.chunk(new Uint8Array([3]));
    speech.flush();
    await flush();
    // The first is decoding; the second waits behind it.
    expect(waiting).toHaveLength(1);
    speech.stop();
    speech.sentenceStart(5);
    speech.chunk(new Uint8Array([5]));
    expect(speech.flush()).toEqual({ chunks: 0, bytes: 0 });
    waiting[0].release();
    await flush();
    expect(waiting.map((w) => Array.from(w.clip))).toEqual([[1]]);
    expect(log).toEqual([]);
  });
});
