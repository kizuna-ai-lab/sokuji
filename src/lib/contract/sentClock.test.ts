// From a service's stream time (milliseconds of audio sent on one connection) to the run's clock.
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from './clock';
import { createSentClock } from './sentClock';

const rate = 24000;
const chunk = (ms: number) => (rate * ms) / 1000;

describe('the table from stream time to clock time', () => {
  it('maps stream time to clock time over continuous audio', () => {
    const clock = createVirtualClock(10_000);
    const t = createSentClock(clock);
    for (let i = 0; i < 10; i++) { clock.advance(100); t.sent(chunk(100), rate); }
    expect(t.at(0)).toBe(10_000);
    expect(t.at(250)).toBe(10_250);
    expect(t.at(1000)).toBe(11_000);
  });

  it('keeps stream time still while nothing is sent (mute, key up)', () => {
    const clock = createVirtualClock(0);
    const t = createSentClock(clock);
    clock.advance(1000); t.sent(chunk(1000), rate);
    clock.advance(10_000);
    clock.advance(500); t.sent(chunk(500), rate);
    expect(t.at(900)).toBe(900);
    expect(t.at(1100)).toBe(11_100);
    expect(t.at(1500)).toBe(11_500);
  });

  it('answers the end for a time just past what was sent and nothing further out', () => {
    const clock = createVirtualClock(0);
    const t = createSentClock(clock);
    clock.advance(1000); t.sent(chunk(1000), rate);
    expect(t.at(1300)).toBe(1000);
    expect(t.at(1600)).toBeUndefined();
    expect(t.at(-1)).toBeUndefined();
  });

  it('starts from zero for a new connection', () => {
    const clock = createVirtualClock(0);
    const first = createSentClock(clock);
    clock.advance(5000); first.sent(chunk(5000), rate);
    const second = createSentClock(clock);
    clock.advance(200); second.sent(chunk(200), rate);
    expect(second.at(100)).toBe(5100);
  });
});
