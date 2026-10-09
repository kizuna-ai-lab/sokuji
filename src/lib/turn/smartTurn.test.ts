import { describe, it, expect } from 'vitest';
import {
  SMART_TURN_CHECK_AFTER_RANGE,
  SMART_TURN_MAX_WAIT_MIN,
  SMART_TURN_WORKER_TYPES,
  effectiveCheckAfter,
  supportsSmartTurn,
} from './smartTurn';

describe('supportsSmartTurn', () => {
  it.each(SMART_TURN_WORKER_TYPES)('runs the gate in %s', (asrWorkerType) => {
    expect(supportsSmartTurn({ asrWorkerType })).toBe(true);
  });

  it.each(['sherpa-onnx', 'voxtral-webgpu', undefined])('leaves %s alone', (asrWorkerType) => {
    expect(supportsSmartTurn({ asrWorkerType })).toBe(false);
  });

  it('leaves a missing entry alone', () => {
    expect(supportsSmartTurn(undefined)).toBe(false);
  });
});

describe('effectiveCheckAfter', () => {
  it('keeps a value well under Max Wait', () => {
    expect(effectiveCheckAfter(0.3, 1.4)).toBe(0.3);
  });

  it('holds it 0.2 s under Max Wait', () => {
    expect(effectiveCheckAfter(0.5, 0.5)).toBeCloseTo(0.3, 10);
  });

  it('goes down to 0.10 s', () => {
    expect(effectiveCheckAfter(0.3, 0.3)).toBeCloseTo(0.1, 10);
  });

  it('drops Smart under 0.10 s', () => {
    expect(effectiveCheckAfter(0.3, 0.25)).toBeNull();
    expect(effectiveCheckAfter(0.3, 0.05)).toBeNull();
  });
});

describe('SMART_TURN_MAX_WAIT_MIN', () => {
  it('is the lowest Max Wait that still leaves Turn Check After its minimum', () => {
    expect(effectiveCheckAfter(SMART_TURN_CHECK_AFTER_RANGE.max, SMART_TURN_MAX_WAIT_MIN)).toBeCloseTo(SMART_TURN_CHECK_AFTER_RANGE.min, 10);
    // One step of the Max Wait slider lower.
    expect(effectiveCheckAfter(SMART_TURN_CHECK_AFTER_RANGE.max, SMART_TURN_MAX_WAIT_MIN - 0.05)).toBeNull();
  });
});
