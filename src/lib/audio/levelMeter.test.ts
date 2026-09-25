import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { createLevelMeter, LEVEL_BARS, LEVEL_GAIN, LEVEL_STALE_MS } from './levelMeter';

/** `length` samples, every one `value` (a constant-amplitude chunk). */
const constantPcm = (value: number, length = 10): Int16Array => new Int16Array(length).fill(value);
/** A full-scale square wave: RMS is (close to) 1. */
const squarePcm = (length = 10): Int16Array => Int16Array.from({ length }, (_, i) => (i % 2 === 0 ? 32767 : -32767));
const zeros = () => new Array(LEVEL_BARS).fill(0);

describe('createLevelMeter', () => {
  it('reads 32 zeros before any chunk', () => {
    const meter = createLevelMeter(createVirtualClock(0));
    expect([...meter.read()]).toEqual(zeros());
  });

  it('a full-scale square wave chunk reads 1 at the newest bar, 0 elsewhere', () => {
    const meter = createLevelMeter(createVirtualClock(0));
    meter.push(squarePcm());
    const levels = meter.read();
    expect(levels[LEVEL_BARS - 1]).toBe(1);
    expect([...levels.slice(0, LEVEL_BARS - 1)]).toEqual(zeros().slice(1));
  });

  it(`a chunk of amplitude 4096 (RMS 0.125) reads 0.5 with LEVEL_GAIN ${LEVEL_GAIN}`, () => {
    const meter = createLevelMeter(createVirtualClock(0));
    meter.push(constantPcm(4096));
    expect(meter.read()[LEVEL_BARS - 1]).toBeCloseTo(0.5);
  });

  it('keeps 32 bars after 33 chunks, the oldest dropped', () => {
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    for (let i = 1; i <= 33; i++) {
      meter.push(constantPcm(i * 100));
      clock.advance(10);
    }
    const levels = meter.read();
    expect(levels).toHaveLength(LEVEL_BARS);
    // The 33rd chunk is the newest bar; the 1st was dropped, so the oldest
    // bar left is the 2nd chunk's.
    expect(levels[LEVEL_BARS - 1]).toBeCloseTo(Math.min(1, ((33 * 100) / 32768) * LEVEL_GAIN));
    expect(levels[0]).toBeCloseTo(Math.min(1, ((2 * 100) / 32768) * LEVEL_GAIN));
  });

  it(`reads flat once nothing arrived for ${LEVEL_STALE_MS}ms`, () => {
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    meter.push(squarePcm());
    clock.advance(LEVEL_STALE_MS + 1);
    expect([...meter.read()]).toEqual(zeros());
  });

  it('starts fresh from zeros once a chunk arrives after a stale gap', () => {
    const clock = createVirtualClock(0);
    const meter = createLevelMeter(clock);
    meter.push(squarePcm());
    clock.advance(LEVEL_STALE_MS + 1);
    meter.push(constantPcm(4096));
    const levels = meter.read();
    expect(levels[LEVEL_BARS - 1]).toBeCloseTo(0.5);
    expect([...levels.slice(0, LEVEL_BARS - 1)]).toEqual(zeros().slice(1));
  });

  it('reset() clears the bars back to zeros', () => {
    const meter = createLevelMeter(createVirtualClock(0));
    meter.push(squarePcm());
    meter.reset();
    expect([...meter.read()]).toEqual(zeros());
  });

  it('gives a new array on every read, safe for a caller to keep', () => {
    const meter = createLevelMeter(createVirtualClock(0));
    meter.push(constantPcm(4096));
    const first = meter.read();
    const second = meter.read();
    expect(first).not.toBe(second);
    expect([...first]).toEqual([...second]);
  });
});
