import { describe, expect, it } from 'vitest';
import { actionForCode, actionLabel } from './noticeActions';

describe('actionForCode', () => {
  it('sends a NOTICE_TARGETS code to its Settings section', () => {
    expect(actionForCode('credentials_missing')).toEqual({ kind: 'settings', target: 'provider' });
    expect(actionForCode('no_microphone')).toEqual({ kind: 'settings', target: 'microphone' });
  });
  // Spec §2 / Ruling 10: the run continues on another voice, and the voice picker is the provider section's.
  it('sends the voice-preparation warnings to the provider section', () => {
    expect(actionForCode('voice_fallback')).toEqual({ kind: 'settings', target: 'provider' });
    for (const code of ['voice_clip_missing', 'voice_pool_busy', 'voice_build_failed', 'voice_unavailable']) {
      expect(actionForCode(code), code).toEqual({ kind: 'settings', target: 'provider' });
    }
  });
  it('sends the balance codes to Top up', () => {
    expect(actionForCode('balance_below_floor')).toEqual({ kind: 'top-up' });
    expect(actionForCode('insufficient_balance')).toEqual({ kind: 'top-up' });
  });
  it('sends a signed-out managed provider to Sign in', () => {
    expect(actionForCode('sign_in_required')).toEqual({ kind: 'sign-in' });
  });
  it('sends loopback_denied to the Screen Recording pane', () => {
    expect(actionForCode('loopback_denied')).toEqual({ kind: 'system-settings', pane: 'screen-recording' });
  });
  it('sends a Windows microphone that would not open to where it is fixed (spec 2026-10-13 §3)', () => {
    // Held by another application: close it, or choose another microphone right away.
    expect(actionForCode('mic_in_use')).toEqual({ kind: 'settings', target: 'microphone' });
    expect(actionForCode('mic_blocked')).toEqual({ kind: 'windows-settings', page: 'microphone-privacy' });
    expect(actionForCode('mic_unreadable')).toEqual({ kind: 'settings', target: 'microphone' });
  });
  it("sends local inference's text-only warnings to the TTS slot of the leg each names (#619)", () => {
    expect(actionForCode('speaker_tts_missing')).toEqual({ kind: 'engine-slot', leg: 'speaker', stage: 'tts' });
    expect(actionForCode('participant_tts_missing')).toEqual({ kind: 'engine-slot', leg: 'participant', stage: 'tts' });
    expect(actionForCode('participant_tts_over_budget')).toEqual({ kind: 'engine-slot', leg: 'participant', stage: 'tts' });
  });
  it('gives the reasons a run ended no action: the status line carries the fix (spec §2)', () => {
    for (const code of ['budget_exhausted', 'segment_ended', 'leg_closed', 'source_ended', 'connection_lost', 'leg_failed']) {
      expect(actionForCode(code), code).toBeNull();
    }
    expect(actionForCode(undefined)).toBeNull();
  });
});

describe('actionLabel', () => {
  it('names each action by an existing catalog key', () => {
    expect(actionLabel({ kind: 'settings', target: 'provider' })).toEqual({ key: 'settings.title', fallback: 'Settings' });
    expect(actionLabel({ kind: 'top-up' })).toEqual({ key: 'common.topUp', fallback: 'Top up' });
    expect(actionLabel({ kind: 'sign-in' })).toEqual({ key: 'common.signIn', fallback: 'Sign In' });
    expect(actionLabel({ kind: 'system-settings', pane: 'screen-recording' })).toEqual({ key: 'audioPanel.openSystemSettings', fallback: 'Open System Settings' });
    expect(actionLabel({ kind: 'show-in-folder', dir: '/tmp' })).toEqual({ key: 'mainPanel.export.autoSave.showInFolder', fallback: 'Show in folder' });
    expect(actionLabel({ kind: 'engine-slot', leg: 'participant', stage: 'tts' })).toEqual({ key: 'settings.title', fallback: 'Settings' });
    expect(actionLabel({ kind: 'windows-settings', page: 'microphone-privacy' })).toEqual({ key: 'audioPanel.openSystemSettings', fallback: 'Open System Settings' });
  });
});
