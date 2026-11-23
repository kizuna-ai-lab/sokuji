import { describe, it, expect } from 'vitest';
import { clampTurnDetection, migrateTurnDetection, TURN_DETECTION_DEFAULTS, vadConfigOf } from './turnDetectionSettings';

describe('migrateTurnDetection', () => {
  it('takes each stored localInference value once, to be written under settings.turnDetection', () => {
    const { settings, writes } = migrateTurnDetection({}, { threshold: 0.45, minSilence: 0.8, endOfTurn: 'smart' });
    expect(settings).toEqual({ ...TURN_DETECTION_DEFAULTS, threshold: 0.45, minSilence: 0.8, endOfTurn: 'smart' });
    expect(writes).toEqual({ threshold: 0.45, minSilence: 0.8, endOfTurn: 'smart' });
  });
  it('a value already under settings.turnDetection wins and is not written again', () => {
    expect(migrateTurnDetection({ threshold: 0.5 }, { threshold: 0.45 })).toEqual({ settings: { ...TURN_DETECTION_DEFAULTS, threshold: 0.5 }, writes: {} });
  });
  it('nothing stored: the defaults, nothing written', () => {
    expect(migrateTurnDetection({}, {})).toEqual({ settings: TURN_DETECTION_DEFAULTS, writes: {} });
  });
  it('clamps an out-of-range legacy value and ignores one of the wrong type', () => {
    const { settings, writes } = migrateTurnDetection({}, { threshold: 2, minSpeech: '0.4', endOfTurn: 'fast', maxSpeech: 5 });
    expect(settings).toMatchObject({ threshold: 0.95, minSpeech: 0.4, endOfTurn: 'normal', maxSpeech: 10 });
    expect(writes).toEqual({ threshold: 0.95, maxSpeech: 10 });
  });
  it('a stored value of the wrong type is replaced by the legacy one', () => {
    expect(migrateTurnDetection({ threshold: NaN }, { threshold: 0.45 }).writes).toEqual({ threshold: 0.45 });
  });
});

describe('clampTurnDetection', () => {
  it('reads a negative threshold above the threshold as 0', () => {
    expect(clampTurnDetection({ threshold: 0.3, negativeThreshold: 0.5 })).toEqual({ threshold: 0.3, negativeThreshold: 0 });
    expect(clampTurnDetection({ threshold: 0.5, negativeThreshold: 0.4 }).negativeThreshold).toBe(0.4);
  });
  it('drops non-finite numbers and non-members', () => {
    expect(clampTurnDetection({ threshold: Infinity, minSpeech: 'x', endOfTurn: 'other' })).toEqual({});
  });
});

describe('vadConfigOf', () => {
  it('Smart only when asked for and stored, its check capped at Max Wait − 0.2', () => {
    const td = { ...TURN_DETECTION_DEFAULTS, endOfTurn: 'smart' as const, minSilence: 0.4, smartTurnCheckAfter: 0.5 };
    expect(vadConfigOf(td, true).smartTurn).toEqual({ checkAfter: 0.2, threshold: 0.5 });
    expect(vadConfigOf(td, false).smartTurn).toBeUndefined();
  });
  it('drops Smart when Max Wait leaves it under 0.10 s; the negative threshold only when set', () => {
    expect(vadConfigOf({ ...TURN_DETECTION_DEFAULTS, endOfTurn: 'smart', minSilence: 0.25 }, true)).not.toHaveProperty('smartTurn');
    expect(vadConfigOf(TURN_DETECTION_DEFAULTS, true)).not.toHaveProperty('negativeThreshold');
    expect(vadConfigOf({ ...TURN_DETECTION_DEFAULTS, negativeThreshold: 0.15 }, false).negativeThreshold).toBe(0.15);
  });
});
