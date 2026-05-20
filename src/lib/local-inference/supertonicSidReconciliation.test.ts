import { describe, expect, it } from 'vitest';
import {
  applySupertonicReadyToSettings,
  type SupertonicReadyVoice,
} from './supertonicSidReconciliation';

const sarah: SupertonicReadyVoice = { sid: 0, name: 'Sarah', source: 'preset' };
const robert: SupertonicReadyVoice = { sid: 7, name: 'Robert', source: 'preset' };

describe('applySupertonicReadyToSettings', () => {
  it('keeps the current sid when present in voices', () => {
    const r = applySupertonicReadyToSettings({
      currentSid: 7, defaultSid: 7, voices: [sarah, robert],
    });
    expect(r.nextSid).toBe(7);
    expect(r.wasReset).toBe(false);
  });

  it('resets to defaultSid when current sid is missing', () => {
    const r = applySupertonicReadyToSettings({
      currentSid: 99, defaultSid: 7, voices: [robert],
    });
    expect(r.nextSid).toBe(7);
    expect(r.wasReset).toBe(true);
  });

  it('returns null nextSid when both current and default are missing', () => {
    const r = applySupertonicReadyToSettings({
      currentSid: 5, defaultSid: 7, voices: [sarah],
    });
    expect(r.nextSid).toBeNull();
    expect(r.wasReset).toBe(true);
  });

  it('handles empty voices array', () => {
    const r = applySupertonicReadyToSettings({
      currentSid: 7, defaultSid: 7, voices: [],
    });
    expect(r.nextSid).toBeNull();
    expect(r.wasReset).toBe(true);
  });
});
