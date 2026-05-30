import { describe, it, expect } from 'vitest';
import { isPassthroughActive } from './audioUtils';

/**
 * isPassthroughActive decides whether the raw-mic passthrough should currently
 * be audible to the outputs (monitor / virtual mic / meeting tab).
 *
 * The critical invariant: muting the mic must silence passthrough too. The
 * mic-mute is a "soft mute" (the recorder keeps running and only the AI-bound
 * tap is gated), so the passthrough path must honor mute independently or the
 * user's voice keeps leaking to participants. This is most visible in
 * Push-to-Translate mode, where passthrough is auto-enabled @ 100% while idle.
 */
describe('isPassthroughActive', () => {
  it('is on during Push-to-Translate idle when not muted', () => {
    expect(
      isPassthroughActive({
        mode: 'Push-to-Translate',
        isRecording: false,
        isMicMuted: false,
        legacyPassthroughEnabled: false,
      })
    ).toBe(true);
  });

  it('is off during Push-to-Translate while holding the key (recording)', () => {
    expect(
      isPassthroughActive({
        mode: 'Push-to-Translate',
        isRecording: true,
        isMicMuted: false,
        legacyPassthroughEnabled: false,
      })
    ).toBe(false);
  });

  it('is off during Push-to-Translate idle when the mic is muted', () => {
    // The bug: previously stayed true here, so a muted mic still leaked voice.
    expect(
      isPassthroughActive({
        mode: 'Push-to-Translate',
        isRecording: false,
        isMicMuted: true,
        legacyPassthroughEnabled: false,
      })
    ).toBe(false);
  });

  it('follows the legacy toggle in non-P2T modes when not muted', () => {
    expect(
      isPassthroughActive({
        mode: 'Normal',
        isRecording: false,
        isMicMuted: false,
        legacyPassthroughEnabled: true,
      })
    ).toBe(true);

    expect(
      isPassthroughActive({
        mode: 'Normal',
        isRecording: false,
        isMicMuted: false,
        legacyPassthroughEnabled: false,
      })
    ).toBe(false);
  });

  it('is off in legacy passthrough modes when the mic is muted', () => {
    expect(
      isPassthroughActive({
        mode: 'Normal',
        isRecording: false,
        isMicMuted: true,
        legacyPassthroughEnabled: true,
      })
    ).toBe(false);
  });
});
