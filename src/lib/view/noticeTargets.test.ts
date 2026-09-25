import { describe, it, expect } from 'vitest';
import { NOTICE_TARGETS, settingsTargetForCode } from './noticeTargets';
import { NOTICE_WORDS } from './noticeText';

describe('settingsTargetForCode', () => {
  it('sends a missing microphone to the microphone section', () => {
    expect(settingsTargetForCode('no_microphone')).toBe('microphone');
  });

  it('sends every provider-readiness code to the provider section', () => {
    for (const code of ['local_models_missing', 'no_asr', 'credentials_missing', 'no_provider', 'memory_exceeded', 'gpu_out_of_memory']) {
      expect(settingsTargetForCode(code)).toBe('provider');
    }
  });

  it('sends an unsupported turn mode to the turn-detection section', () => {
    expect(settingsTargetForCode('turn_mode_unsupported')).toBe('turn-detection');
  });

  it("sends an unsupported participant pair to the languages section", () => {
    expect(settingsTargetForCode('participant_unsupported')).toBe('languages');
  });

  it('has no target for a code with no fix in Settings, or no code at all', () => {
    expect(settingsTargetForCode('start_failed')).toBeNull();
    expect(settingsTargetForCode('loopback_denied')).toBeNull();
    expect(settingsTargetForCode(undefined)).toBeNull();
  });

  it('has words for every code it targets — an action never sits beside an unworded notice', () => {
    for (const code of Object.keys(NOTICE_TARGETS)) {
      expect(NOTICE_WORDS[code], code).toBeDefined();
    }
  });
});
