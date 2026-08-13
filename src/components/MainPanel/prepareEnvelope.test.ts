import { describe, it, expect } from 'vitest';
import { expectationHolds } from './prepareEnvelope';

describe('expectationHolds', () => {
  it('holds when every expected key strictly equals the slice value', () => {
    expect(expectationHolds({ voice: 'cloned-uuid-123' }, { voice: 'cloned-uuid-123' })).toBe(true);
  });

  it('holds when there is no expectation at all', () => {
    expect(expectationHolds(undefined, { voice: 'cloned-uuid-123' })).toBe(true);
  });

  it('holds for an empty expectation object', () => {
    expect(expectationHolds({}, { voice: 'cloned-uuid-123' })).toBe(true);
  });

  it('fails on a one-key mismatch', () => {
    expect(expectationHolds({ voice: 'cloned-uuid-123' }, { voice: 'cloned-uuid-999' })).toBe(false);
  });

  it('fails when the slice is missing the expected key', () => {
    expect(expectationHolds({ voice: 'cloned-uuid-123' }, {})).toBe(false);
  });

  it('fails against a null slice when the expectation names a non-undefined value', () => {
    expect(expectationHolds({ voice: 'cloned-uuid-123' }, null)).toBe(false);
  });

  it('requires every key to match across multiple keys', () => {
    const expectation = { voice: 'cloned-uuid-123', model: 'stt-rt-v3' };
    expect(expectationHolds(expectation, { voice: 'cloned-uuid-123', model: 'stt-rt-v3' })).toBe(true);
    expect(expectationHolds(expectation, { voice: 'cloned-uuid-123', model: 'stt-rt-v2' })).toBe(false);
  });
});
