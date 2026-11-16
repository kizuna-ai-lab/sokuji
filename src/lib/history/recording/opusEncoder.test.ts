// Opus from the browser's own encoder (WebCodecs), behind the recording track's encoder port.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { opusRecordingSupported, OPUS_CONFIG, webCodecsOpusEncoder } from './opusEncoder';

interface FakeEncoder { config: unknown; output: (chunk: unknown, meta?: unknown) => void; error: (e: unknown) => void; encoded: Array<{ data: Float32Array; timestamp: number }>; closed: boolean }
let encoders: FakeEncoder[];
let supported: boolean;

class FakeAudioData {
  constructor(readonly init: { format: string; sampleRate: number; numberOfFrames: number; numberOfChannels: number; timestamp: number; data: Float32Array }) {}
  close() {}
}
class FakeAudioEncoder implements FakeEncoder {
  config: unknown = null;
  encoded: Array<{ data: Float32Array; timestamp: number }> = [];
  closed = false;
  output: FakeEncoder['output'];
  error: FakeEncoder['error'];
  constructor(init: { output: FakeEncoder['output']; error: FakeEncoder['error'] }) { this.output = init.output; this.error = init.error; encoders.push(this); }
  configure(c: unknown) { this.config = c; }
  encode(d: FakeAudioData) { this.encoded.push({ data: d.init.data, timestamp: d.init.timestamp }); this.encodeQueueSize += 1; }
  async flush() {}
  close() { this.closed = true; }
  encodeQueueSize = 0;
  listeners = new Set<() => void>();
  addEventListener(_type: 'dequeue', f: () => void) { this.listeners.add(f); }
  removeEventListener(_type: 'dequeue', f: () => void) { this.listeners.delete(f); }
  /** The encoder takes one piece off its queue. */
  dequeue() { this.encodeQueueSize -= 1; for (const f of [...this.listeners]) f(); }
  static async isConfigSupported() { return { supported }; }
}
const chunk = (bytes: number[], durationUs: number) => ({ byteLength: bytes.length, duration: durationUs, copyTo: (dest: Uint8Array) => dest.set(bytes) });

beforeEach(() => {
  encoders = [];
  supported = true;
  vi.stubGlobal('AudioEncoder', FakeAudioEncoder);
  vi.stubGlobal('AudioData', FakeAudioData);
});
afterEach(() => vi.unstubAllGlobals());

describe('the Opus encoder', () => {
  it('lets a caller go on once at most one piece waits to be encoded, and on an error', async () => {
    const port = webCodecsOpusEncoder(() => {}, () => {}, () => {});
    const e = encoders[0] as FakeAudioEncoder;
    await port.settle!();
    for (let i = 0; i < 3; i++) port.encode(new Int16Array(240000));
    let settled = false;
    const wait = port.settle!().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    e.dequeue();
    await Promise.resolve();
    expect(settled).toBe(false);
    e.dequeue();
    await wait;
    expect(settled).toBe(true);
    expect(e.listeners.size).toBe(0);

    for (let i = 0; i < 3; i++) port.encode(new Int16Array(240000));
    const onError = port.settle!();
    e.error(new Error('encoder broke'));
    await onError;
  });

  it('asks for 24 kHz mono Opus at 48 kbit/s in 20 ms frames', () => {
    webCodecsOpusEncoder(() => {}, () => {}, () => {});
    expect(encoders[0].config).toEqual(OPUS_CONFIG);
    expect(OPUS_CONFIG).toEqual({ codec: 'opus', sampleRate: 24000, numberOfChannels: 1, bitrate: 48000, opus: { frameDuration: 20000 } });
  });

  it('turns 16-bit samples into floats with running timestamps', () => {
    const port = webCodecsOpusEncoder(() => {}, () => {}, () => {});
    port.encode(new Int16Array([-32768, 0, 16384]));
    port.encode(new Int16Array(2400));
    const [a, b] = encoders[0].encoded;
    expect(Array.from(a.data)).toEqual([-1, 0, 0.5]);
    expect(a.timestamp).toBe(0);
    expect(b.timestamp).toBe(125); // 3 samples at 24 kHz, in microseconds
  });

  it('gives the head once, from the first output that carries it, and each packet with its 48 kHz length', () => {
    const heads: Uint8Array[] = [];
    const packets: Array<[number[], number]> = [];
    webCodecsOpusEncoder((d, s) => packets.push([Array.from(d), s]), (h) => heads.push(h), () => {});
    const head = new Uint8Array([79, 112, 117, 115]).buffer;
    encoders[0].output(chunk([1, 2, 3], 20_000), { decoderConfig: { description: head } });
    encoders[0].output(chunk([4], 20_000), { decoderConfig: { description: head } });
    expect(heads).toHaveLength(1);
    expect(packets).toEqual([[[1, 2, 3], 960], [[4], 960]]);
  });

  it("passes the encoder's error on", () => {
    const errors: unknown[] = [];
    webCodecsOpusEncoder(() => {}, () => {}, (e) => errors.push(e));
    encoders[0].error(new Error('boom'));
    expect(errors).toHaveLength(1);
  });

  it('says whether recording can be encoded here', async () => {
    expect(await opusRecordingSupported()).toBe(true);
    supported = false;
    expect(await opusRecordingSupported()).toBe(false);
    vi.unstubAllGlobals();
    expect(await opusRecordingSupported()).toBe(false);
  });
});
