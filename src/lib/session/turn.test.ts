import { describe, it, expect } from 'vitest';
import { synthPcm } from '../../providers/fake/synth';
import { MIN_VOICED_MS, Turn, isVoiced } from './turn';

const silence = (ms: number) => new Int16Array((24000 * ms) / 1000);

describe('isVoiced', () => {
  it('hears a tone and not silence or nothing', () => {
    expect(isVoiced(synthPcm(100))).toBe(true);
    expect(isVoiced(silence(100))).toBe(false);
    expect(isVoiced(new Int16Array(0))).toBe(false);
  });

  it('draws the line at a mean of 1% of full scale', () => {
    expect(isVoiced(new Int16Array(100).fill(328))).toBe(true);
    expect(isVoiced(new Int16Array(100).fill(327))).toBe(false);
  });
});

describe('Turn', () => {
  it('ends a turn that held enough voice', () => {
    const turn = new Turn(0);
    for (let i = 0; i < MIN_VOICED_MS / 100; i++) turn.add(synthPcm(100));
    expect(turn.close()).toBe('end');
  });

  it('cancels a turn that held too little voice, however long it was held', () => {
    const turn = new Turn(0);
    for (let i = 0; i < 4; i++) turn.add(synthPcm(100));
    for (let i = 0; i < 20; i++) turn.add(silence(100));
    expect(turn.close()).toBe('cancel');
  });

  it('closes once, and counts nothing after', () => {
    const turn = new Turn(7);
    expect(turn.isOpen).toBe(true);
    expect(turn.close()).toBe('cancel');
    turn.add(synthPcm(1000));
    expect(turn.close()).toBeNull();
    expect(turn.isOpen).toBe(false);
    expect(turn.startedAt).toBe(7);
  });
});
