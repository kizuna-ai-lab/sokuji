import { describe, it, expect } from 'vitest';
import {
  clampTurnDetection,
  LEGACY_TURN_DETECTION_FIELDS,
  migrateTurnDetection,
  TURN_DETECTION_DEFAULTS,
  vadConfigOf,
} from './turnDetectionSettings';

describe('pinned values', () => {
  it('the defaults are the spec table', () => {
    expect(TURN_DETECTION_DEFAULTS).toEqual({
      threshold: 0.3, negativeThreshold: 0, minSilence: 1.4, minSpeech: 0.4, prePad: 0.8, maxSpeech: 30,
      endOfTurn: 'normal', smartTurnCheckAfter: 0.3, smartTurnThreshold: 0.5,
    });
  });
  it('the legacy keys are the nine old names', () => {
    expect(LEGACY_TURN_DETECTION_FIELDS).toEqual({
      threshold: 'vadThreshold', negativeThreshold: 'vadNegativeThreshold', minSilence: 'vadMinSilenceDuration',
      minSpeech: 'vadMinSpeechDuration', prePad: 'vadPreSpeechPadDuration', maxSpeech: 'vadMaxSpeechDuration',
      endOfTurn: 'vadEndOfTurn', smartTurnCheckAfter: 'smartTurnCheckAfter', smartTurnThreshold: 'smartTurnThreshold',
    });
  });
});

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

describe('silence threshold above the speech threshold (I1)', () => {
  it('legacy {thr .3, neg .4} writes neg clamped to .3 and runs as base did', () => {
    const { settings, writes } = migrateTurnDetection({}, { threshold: 0.3, negativeThreshold: 0.4 });
    expect(writes).toEqual({ threshold: 0.3, negativeThreshold: 0.3 });
    expect(settings).toMatchObject({ threshold: 0.3, negativeThreshold: 0.3 });
    const vad = vadConfigOf(settings, false);
    expect(vad.threshold).toBe(0.3);
    expect(vad.negativeThreshold).toBe(0.3);
  });
  it('judged against the stored threshold when it wins over the legacy one', () => {
    const { settings, writes } = migrateTurnDetection({ threshold: 0.5 }, { threshold: 0.2, negativeThreshold: 0.4 });
    expect(writes).toEqual({ negativeThreshold: 0.4 });
    expect(settings).toMatchObject({ threshold: 0.5, negativeThreshold: 0.4 });
  });
  it('stored threshold .5 with legacy neg .4 and no legacy threshold keeps .4', () => {
    expect(migrateTurnDetection({ threshold: 0.5 }, { negativeThreshold: 0.4 }).settings.negativeThreshold).toBe(0.4);
  });
  it('legacy neg alone is judged against the default threshold', () => {
    expect(migrateTurnDetection({}, { negativeThreshold: 0.4 }).writes).toEqual({ negativeThreshold: 0.3 });
  });
  it('vadConfigOf sends min(neg, threshold); 0 stays Auto', () => {
    expect(vadConfigOf({ ...TURN_DETECTION_DEFAULTS, threshold: 0.3, negativeThreshold: 0.4 }, false).negativeThreshold).toBe(0.3);
    expect(vadConfigOf({ ...TURN_DETECTION_DEFAULTS, threshold: 0.5, negativeThreshold: 0.4 }, false).negativeThreshold).toBe(0.4);
  });
});

describe('clampTurnDetection', () => {
  it('keeps a negative threshold above the threshold (it is applied as min of the two)', () => {
    expect(clampTurnDetection({ threshold: 0.3, negativeThreshold: 0.5 })).toEqual({ threshold: 0.3, negativeThreshold: 0.5 });
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
