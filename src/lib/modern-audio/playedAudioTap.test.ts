import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ModernAudioPlayer } from './ModernAudioPlayer';

/**
 * createPlayedAudioTap must preserve the rendered timeline, not just the
 * consumed samples: the worklet advances readIndex only while main-ring
 * samples exist, so intermittent TTS (the normal case) would otherwise reach
 * the echo detector with every silence removed — compressing the reference
 * against the wall-clock microphone probe and shifting every apparent lag.
 */

const RATE = 24000;

function makePlayer() {
  const player = new ModernAudioPlayer({ sampleRate: RATE });
  // Stand up the ring without an AudioContext: the tap only touches
  // _indices/_data/_ringCapacity/_workletState.
  const cap = RATE * 4;
  const sab = new SharedArrayBuffer(16 + cap * 4);
  player._indices = new Int32Array(sab, 0, 4);
  player._data = new Float32Array(sab, 16);
  player._ringCapacity = cap;
  Atomics.store(player._indices, 2, cap);
  return player;
}

/** Producer + consumer in one: write `values`, then mark them consumed. */
function playSamples(player: any, values: number[]) {
  const writeIdx = Atomics.load(player._indices as Int32Array, 0);
  for (let i = 0; i < values.length; i++) {
    player._data[(writeIdx + i) % player._ringCapacity] = values[i];
  }
  Atomics.store(player._indices, 0, writeIdx + values.length);
  Atomics.store(player._indices, 1, writeIdx + values.length); // consumed
}

describe('createPlayedAudioTap', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pads un-consumed wall-clock time with silence (starving: silence last)', () => {
    const player = makePlayer();
    player._workletState = 'starving';
    const tap = player.createPlayedAudioTap();
    expect(tap.read().length).toBe(0); // first read only syncs the cursor

    // 100 ms of audio consumed, but 250 ms of wall time passed.
    playSamples(player, new Array(RATE / 10).fill(0.5));
    vi.advanceTimersByTime(250);

    const out = tap.read();
    expect(out.length).toBe(RATE / 4); // 250 ms worth
    expect(out[0]).toBeCloseTo(0.5); // audio first
    expect(out[out.length - 1]).toBe(0); // silence trails
  });

  it('places silence before the audio when the worklet is playing again', () => {
    const player = makePlayer();
    player._workletState = 'playing';
    const tap = player.createPlayedAudioTap();
    tap.read();

    playSamples(player, new Array(RATE / 10).fill(0.5));
    vi.advanceTimersByTime(250);

    const out = tap.read();
    expect(out.length).toBe(RATE / 4);
    expect(out[0]).toBe(0); // the starved stretch preceded the resumption
    expect(out[out.length - 1]).toBeCloseTo(0.5);
  });

  it('emits pure silence across a fully idle interval', () => {
    const player = makePlayer();
    player._workletState = 'starving';
    const tap = player.createPlayedAudioTap();
    tap.read();

    vi.advanceTimersByTime(500);
    const out = tap.read();
    expect(out.length).toBe(RATE / 2);
    expect(out.every((v: number) => v === 0)).toBe(true);
  });

  it('keeps the timeline continuous across audio → gap → audio', () => {
    const player = makePlayer();
    player._workletState = 'starving';
    const tap = player.createPlayedAudioTap();
    tap.read();

    const chunks: Float32Array[] = [];
    playSamples(player, new Array(RATE / 10).fill(0.7)); // 100 ms utterance A
    vi.advanceTimersByTime(250);
    chunks.push(tap.read());
    vi.advanceTimersByTime(250); // 250 ms silence
    chunks.push(tap.read());
    playSamples(player, new Array(RATE / 10).fill(0.9)); // 100 ms utterance B
    vi.advanceTimersByTime(250);
    chunks.push(tap.read());

    const total = chunks.reduce((n, c) => n + c.length, 0);
    expect(total).toBe((RATE * 750) / 1000); // 750 ms of wall time, exactly
  });

  it('re-syncs on a ring restart instead of replaying old audio', () => {
    const player = makePlayer();
    player._workletState = 'starving';
    const tap = player.createPlayedAudioTap();
    tap.read();
    // Advance the cursor past the future reset point, so the restart is
    // actually visible to the tap as cur < lastIndex.
    playSamples(player, new Array(100).fill(0.5));
    vi.advanceTimersByTime(5);
    expect(tap.read().length).toBeGreaterThan(0); // cursor now at 100

    // Ring rebuild: indices restart at 0 while old samples still sit in _data.
    Atomics.store(player._indices as Int32Array, 0, 0);
    Atomics.store(player._indices as Int32Array, 1, 0);
    vi.advanceTimersByTime(100);

    // The reset branch fires: a sync-only empty read, then normal operation
    // with no stale 0.5 samples replayed.
    expect(tap.read().length).toBe(0);
    playSamples(player, new Array(48).fill(0.25));
    vi.advanceTimersByTime(2);
    const next = tap.read();
    expect(next.length).toBeGreaterThan(0);
    expect(next.every((v: number) => v === 0 || Math.abs(v - 0.25) < 1e-6)).toBe(true);
  });

  it('caps consumed audio too, dropping the oldest, when far behind', () => {
    const player = makePlayer();
    player._workletState = 'starving';
    const tap = player.createPlayedAudioTap();
    tap.read();

    // 2 s of audio consumed plus a 40 s stall: neither the consumed span nor
    // the silence padding may push one read past the per-read budget.
    playSamples(player, new Array(RATE * 2).fill(0.3));
    vi.advanceTimersByTime(40_000);
    const out = tap.read();
    expect(out.length).toBeLessThanOrEqual(RATE * 30);
  });

  it('caps a single read after a very long stall', () => {
    const player = makePlayer();
    player._workletState = 'starving';
    const tap = player.createPlayedAudioTap();
    tap.read();

    vi.advanceTimersByTime(120_000); // 2 minutes stalled
    const out = tap.read();
    expect(out.length).toBeLessThanOrEqual(RATE * 30);
  });
});
