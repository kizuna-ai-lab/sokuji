import { describe, it, expect, beforeEach } from 'vitest';
import useAudioStore from './audioStore';
import type { AudioMode } from './audioStore';

describe('audioStore — mode + mute flags', () => {
  beforeEach(() => {
    useAudioStore.setState({
      mode: 'speaker' as AudioMode,
      isMicMuted: false,
      isMonitorMuted: true,
      isParticipantMuted: false,
      audioInputDevices: [],
      selectedInputDevice: null,
    } as any);
  });

  it('defaults: mode=speaker, isMicMuted=false, isMonitorMuted=true, isParticipantMuted=false', () => {
    const s = useAudioStore.getState();
    expect(s.mode).toBe('speaker');
    expect(s.isMicMuted).toBe(false);
    expect(s.isMonitorMuted).toBe(true);
    expect(s.isParticipantMuted).toBe(false);
  });

  it('setMode("participant") updates mode', () => {
    useAudioStore.getState().setMode('participant');
    const s = useAudioStore.getState();
    expect(s.mode).toBe('participant');
  });

  it('setMode resets newly-in-scope mute flags to false but leaves monitor sticky', () => {
    useAudioStore.setState({
      mode: 'speaker',
      isMicMuted: true,
      isMonitorMuted: true,
      isParticipantMuted: true,
    } as any);
    useAudioStore.getState().setMode('both');
    const s = useAudioStore.getState();
    expect(s.isParticipantMuted).toBe(false); // newly in scope
    expect(s.isMicMuted).toBe(true);          // was already in scope
    expect(s.isMonitorMuted).toBe(true);      // sticky
  });

  it('setMicMuted(true) sets isMicMuted', () => {
    useAudioStore.getState().setMicMuted(true);
    const s = useAudioStore.getState();
    expect(s.isMicMuted).toBe(true);
  });

  it('setParticipantMuted(true) sets isParticipantMuted', () => {
    useAudioStore.getState().setParticipantMuted(true);
    const s = useAudioStore.getState();
    expect(s.isParticipantMuted).toBe(true);
  });

  it('setMonitorMuted(false) sets isMonitorMuted', () => {
    useAudioStore.setState({ isMonitorMuted: true } as any);
    useAudioStore.getState().setMonitorMuted(false);
    const s = useAudioStore.getState();
    expect(s.isMonitorMuted).toBe(false);
  });

  // ── No-mutex tests: setters have no cross-channel side effects ──────────
  // The spec states: "Mutex (monitor ↔ participant): Enforced via mode only."
  // Monitor is in scope only when mode === 'speaker'; participant is in scope
  // only when mode === 'participant' || 'both'. They can never both be in
  // scope simultaneously, so a runtime mutex is unreachable from any UI path.

  it('setMonitorMuted(false) does not change isParticipantMuted (mutex is mode-enforced, not runtime)', () => {
    useAudioStore.setState({
      mode: 'speaker',
      isMonitorMuted: true,
      isParticipantMuted: false,
    } as any);
    useAudioStore.getState().setMonitorMuted(false);
    const s = useAudioStore.getState();
    expect(s.isMonitorMuted).toBe(false);
    expect(s.isParticipantMuted).toBe(false); // unchanged
  });

  it('setParticipantMuted(false) does not change isMonitorMuted (mutex is mode-enforced, not runtime)', () => {
    useAudioStore.setState({
      mode: 'participant',
      isMonitorMuted: true,
      isParticipantMuted: true,
    } as any);
    useAudioStore.getState().setParticipantMuted(false);
    const s = useAudioStore.getState();
    expect(s.isParticipantMuted).toBe(false);
    expect(s.isMonitorMuted).toBe(true); // unchanged
  });
});
