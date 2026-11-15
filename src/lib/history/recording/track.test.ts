// One leg's recording track: on the record's clock, silence for what was held back, Ogg pages out.
import { describe, it, expect, beforeEach } from 'vitest';
import { createTrack, type OpusEncoderFactory } from './track';

const HEAD = new Uint8Array([79, 112, 117, 115, 72, 101, 97, 100, 1, 1, 156, 0, 192, 93, 0, 0, 0, 0, 0]);
const pcm = (n: number, value = 1000) => new Int16Array(n).fill(value);

/** A stand-in encoder: the head at once, one 3-byte packet per 480 samples (20 ms at 24 kHz); it notes each call. */
let calls: Array<[number, boolean]>;
let failNext: boolean;
const fakeEncoder: OpusEncoderFactory = (onPacket, onHead, onError) => {
  let headSent = false;
  let held = 0;
  return {
    encode(p) {
      if (failNext) { onError(new Error('encoder broke')); return; }
      calls.push([p.length, p.every((v) => v === 0)]);
      if (!headSent) { headSent = true; onHead(HEAD); }
      held += p.length;
      while (held >= 480) { held -= 480; onPacket(new Uint8Array([1, 2, 3]), 960); }
    },
    async flush() { if (held > 0) { held = 0; onPacket(new Uint8Array([4, 5, 6]), 960); } },
    close() {},
  };
};
const track = (startedAt: number) => createTrack({ startedAt, encoder: fakeEncoder, serial: 1 });
const lastPageType = (bytes: Uint8Array) => {
  let at = -1;
  for (let i = bytes.length - 4; i >= 0; i--) if (bytes[i] === 0x4f && bytes[i + 1] === 0x67 && bytes[i + 2] === 0x67 && bytes[i + 3] === 0x53) { at = i; break; }
  return bytes[at + 5];
};

beforeEach(() => { calls = []; failNext = false; });

describe('a recording track', () => {
  it('places the first sample on the record clock', () => {
    const t = track(10_000);
    t.pcm(pcm(2400), 10_600);
    expect(t.offsetMs).toBe(500);
  });

  it('fills a gap longer than 250 ms with silence, so the file stays on the record clock', () => {
    const t = track(0);
    t.pcm(pcm(24_000), 1000);
    t.pcm(pcm(24_000), 6000);
    t.take();
    expect(calls).toEqual([[24_000, false], [24_000, true], [24_000, true], [24_000, true], [24_000, true], [24_000, false]]);
  });

  it('puts the silence before the audio that came after the pause', () => {
    const t = track(0);
    t.pcm(pcm(2400), 100);
    t.pcm(pcm(2400, 7), 5100);
    t.pcm(pcm(2400, 9), 5200);
    t.take();
    expect(calls).toEqual([[2400, false], [24_000, true], [24_000, true], [24_000, true], [24_000, true], [21_600, true], [2400, false], [2400, false]]);
  });

  it('does not take the audio a stall held back, arriving all at once, for a pause', () => {
    const t = track(0);
    for (let at = 100; at <= 1000; at += 100) t.pcm(pcm(2400), at);
    for (let i = 0; i < 10; i++) t.pcm(pcm(2400), 2000);
    t.pcm(pcm(2400), 2100);
    t.pcm(pcm(2400), 2200);
    t.take();
    expect(calls.some(([, zero]) => zero)).toBe(false);
    expect(calls.reduce((n, [len]) => n + len, 0)).toBe(22 * 2400);
  });

  it('writes a long silence a minute at a time, and the audio after it once the silence is written', () => {
    const t = track(0);
    t.pcm(pcm(24_000), 1000);
    t.pcm(pcm(2400, 7), 3_601_100);
    t.pcm(pcm(2400, 9), 3_601_200);
    t.take();
    const zeros = () => calls.filter(([, zero]) => zero).reduce((n, [len]) => n + len, 0);
    expect(zeros()).toBe(60 * 24_000);
    expect(calls.every(([len]) => len <= 24_000)).toBe(true);
    expect(calls[calls.length - 1][1]).toBe(true);
    for (let i = 0; i < 59; i++) t.take();
    expect(zeros()).toBe(3600 * 24_000);
    expect(calls.slice(-2)).toEqual([[2400, false], [2400, false]]);
  });

  it('does not fill a gap of 250 ms or less, and never trims an early chunk', () => {
    const t = track(0);
    t.pcm(pcm(24_000), 1000);
    t.pcm(pcm(24_000), 2200);
    t.pcm(pcm(24_000), 2900);
    expect(calls).toEqual([[24_000, false], [24_000, false], [24_000, false]]);
  });

  it('takes the head pages first, then complete pages with the duration written so far', () => {
    const t = track(0);
    expect(t.take()).toBeNull();
    t.pcm(pcm(24_000), 1000);
    const first = t.take()!;
    expect(first.bytes[5]).toBe(2);
    expect(first.durationMs).toBe(Math.round((48_000 - 156) / 48));
    expect(t.take()).toBeNull();
    t.pcm(pcm(24_000), 2000);
    const second = t.take()!;
    expect(second.bytes[5]).toBe(0);
    expect(second.durationMs).toBe(Math.round((96_000 - 156) / 48));
  });

  it('end flushes the encoder and marks the end of the stream', async () => {
    const t = track(0);
    t.pcm(pcm(24_100), 1004);
    t.take();
    const last = await t.end();
    expect(last.bytes.length).toBeGreaterThan(0);
    expect(lastPageType(last.bytes) & 4).toBe(4);
  });

  it('a failed encoder fails the track: nothing more is encoded or taken', () => {
    const t = track(0);
    t.pcm(pcm(24_000), 1000);
    failNext = true;
    t.pcm(pcm(24_000), 2000);
    expect(t.failed).toBe(true);
    failNext = false;
    t.pcm(pcm(24_000), 3000);
    expect(calls).toHaveLength(1);
    expect(t.take()).toBeNull();
  });
});
