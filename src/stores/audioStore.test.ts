import { describe, it, expect, beforeEach } from 'vitest';
import useAudioStore, { pickDefaultInputDevice } from './audioStore';
import type { AudioMode, AudioDevice } from './audioStore';

// Regression test: on a machine with no physical microphone, the only
// enumerated "audioinput" device can be a virtual/loopback one — notably
// Sokuji's own "Sokuji_Virtual_Mic", the monitor of Sokuji's own virtual
// speaker (electron/pulseaudio-utils.js). Auto-selecting it as the mic feeds
// Sokuji's own TTS output back into ASR as "user speech", producing an
// infinite transcribe -> translate -> speak loop. The fallback must never
// pick a virtual device, even when it's the only one available.
describe('pickDefaultInputDevice', () => {
  it('picks the first non-virtual device when a real mic is present', () => {
    const inputs: AudioDevice[] = [
      { deviceId: 'virtual-1', label: 'Sokuji_Virtual_Mic', isVirtual: true },
      { deviceId: 'real-1', label: 'Built-in Microphone', isVirtual: false },
    ];
    expect(pickDefaultInputDevice(inputs)?.deviceId).toBe('real-1');
  });

  it('returns null when every available input is virtual (no physical mic)', () => {
    const inputs: AudioDevice[] = [
      { deviceId: 'virtual-1', label: 'Sokuji_Virtual_Mic', isVirtual: true },
    ];
    expect(pickDefaultInputDevice(inputs)).toBeNull();
  });

  it('returns null for an empty device list', () => {
    expect(pickDefaultInputDevice([])).toBeNull();
  });
});

// Integration-level regression test for the actual UI-visible fix: when
// refreshDevices() finds no real microphone, it must turn the mic off
// (isMicMuted: true), not just leave selectedInputDevice unset. The device
// picker's "Off" option (DeviceList.tsx) only renders as selected when
// isMicMuted is true — an unset device with isMicMuted still false shows
// nothing selected at all, which is what prompted this follow-up.
describe('audioStore — refreshDevices with no real microphone', () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioStore.setState({
      selectedInputDevice: null,
      selectedMonitorDevice: null,
      isMicMuted: false,
      mode: 'speaker' as AudioMode,
    } as any);
  });

  it('turns the mic off when only virtual/loopback input devices are enumerated', async () => {
    useAudioStore.setState({
      audioService: {
        initialize: async () => {},
        getDevices: async () => ({
          inputs: [{ deviceId: 'virtual-1', label: 'Sokuji_Virtual_Mic', isVirtual: true }],
          outputs: [],
        }),
        setMonitorVolume: () => {},
      },
    } as any);

    await useAudioStore.getState().refreshDevices();

    const s = useAudioStore.getState();
    expect(s.selectedInputDevice).toBeNull();
    expect(s.isMicMuted).toBe(true);
  });

  it('turns the mic off when no input devices are enumerated at all', async () => {
    useAudioStore.setState({
      audioService: {
        initialize: async () => {},
        getDevices: async () => ({ inputs: [], outputs: [] }),
        setMonitorVolume: () => {},
      },
    } as any);

    await useAudioStore.getState().refreshDevices();

    const s = useAudioStore.getState();
    expect(s.selectedInputDevice).toBeNull();
    expect(s.isMicMuted).toBe(true);
  });

  it('still auto-selects a real microphone when one is present', async () => {
    useAudioStore.setState({
      audioService: {
        initialize: async () => {},
        getDevices: async () => ({
          inputs: [
            { deviceId: 'virtual-1', label: 'Sokuji_Virtual_Mic', isVirtual: true },
            { deviceId: 'real-1', label: 'Built-in Microphone', isVirtual: false },
          ],
          outputs: [],
        }),
        setMonitorVolume: () => {},
      },
    } as any);

    await useAudioStore.getState().refreshDevices();

    const s = useAudioStore.getState();
    expect(s.selectedInputDevice?.deviceId).toBe('real-1');
    expect(s.isMicMuted).toBe(false);
  });

  // Regression for code review finding: canStartSession (MainPanel.tsx) gates
  // purely on !!selectedInputDevice and "mute state does not block start" by
  // design, so a stale device object left in place after it's unplugged would
  // still satisfy the start gate — and unmuting mid-session would reconnect
  // straight to it.
  it('clears a stale selectedInputDevice (now disconnected) when no real mic remains', async () => {
    useAudioStore.setState({
      selectedInputDevice: { deviceId: 'unplugged-real-mic', label: 'USB Microphone', isVirtual: false },
      isMicMuted: false,
      audioService: {
        initialize: async () => {},
        getDevices: async () => ({
          inputs: [{ deviceId: 'virtual-1', label: 'Sokuji_Virtual_Mic', isVirtual: true }],
          outputs: [],
        }),
        setMonitorVolume: () => {},
      },
    } as any);

    await useAudioStore.getState().refreshDevices();

    const s = useAudioStore.getState();
    expect(s.selectedInputDevice).toBeNull();
    expect(s.isMicMuted).toBe(true);
  });

  // Regression for code review finding: a user who hit the original bug may
  // already have SELECTED_INPUT_DEVICE_ID persisted as the virtual mic's id.
  // The saved-device restore path must reject it rather than blindly trusting
  // whatever's on disk — otherwise the fix does nothing for exactly the users
  // it's meant to protect.
  it('does not restore a persisted device id that resolves to a virtual device', async () => {
    localStorage.setItem('audio.selectedInputDeviceId', 'virtual-1');
    useAudioStore.setState({
      audioService: {
        initialize: async () => {},
        getDevices: async () => ({
          inputs: [{ deviceId: 'virtual-1', label: 'Sokuji_Virtual_Mic', isVirtual: true }],
          outputs: [],
        }),
        setMonitorVolume: () => {},
      },
    } as any);

    await useAudioStore.getState().refreshDevices();

    const s = useAudioStore.getState();
    expect(s.selectedInputDevice).toBeNull();
    expect(s.isMicMuted).toBe(true);
  });
});

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

  // Participant mute tracks mode scope bidirectionally: unmute on entering
  // scope (Participant/Both), mute on leaving (Speaker). One-directional —
  // setParticipantMuted never changes mode.
  it('setMode("speaker") auto-mutes participant (leaves scope)', () => {
    useAudioStore.setState({ mode: 'both', isParticipantMuted: false } as any);
    useAudioStore.getState().setMode('speaker');
    expect(useAudioStore.getState().isParticipantMuted).toBe(true);
  });

  it('setMode("participant") auto-unmutes participant (enters scope)', () => {
    useAudioStore.setState({ mode: 'speaker', isParticipantMuted: true } as any);
    useAudioStore.getState().setMode('participant');
    expect(useAudioStore.getState().isParticipantMuted).toBe(false);
  });

  it('setMode("both") auto-unmutes participant (in scope)', () => {
    useAudioStore.setState({ mode: 'speaker', isParticipantMuted: true } as any);
    useAudioStore.getState().setMode('both');
    expect(useAudioStore.getState().isParticipantMuted).toBe(false);
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

// ── Monitor <-> participant mutex enforced via mode-gated playback ──────────
// The monitor is audible only in pure speaker mode. setMode re-gates the
// actual playback volume (audioService.setMonitorVolume) on every mode change
// WITHOUT mutating isMonitorMuted — the flag stays the user's sticky opt-in
// preference, restored when returning to speaker. This closes the bug where
// switching to Participant/Both auto-unmuted participant but left the monitor
// playing (both active = mutex violation).
describe('audioStore — monitor volume mode-gating', () => {
  function withMockService(): boolean[] {
    const calls: boolean[] = [];
    useAudioStore.setState({
      audioService: { setMonitorVolume: (v: boolean) => { calls.push(v); } },
    } as any);
    return calls;
  }

  beforeEach(() => {
    useAudioStore.setState({
      mode: 'speaker' as AudioMode,
      isMicMuted: false,
      isMonitorMuted: false,
      isParticipantMuted: false,
      audioInputDevices: [],
      selectedInputDevice: null,
      audioService: null,
    } as any);
  });

  it('setMode("both") silences the monitor (leaves speaker scope) without touching the flag', () => {
    useAudioStore.setState({ mode: 'speaker', isMonitorMuted: false } as any);
    const calls = withMockService();
    useAudioStore.getState().setMode('both');
    expect(calls[calls.length - 1]).toBe(false);
    expect(useAudioStore.getState().isMonitorMuted).toBe(false); // preference preserved
  });

  it('setMode("participant") silences the monitor', () => {
    useAudioStore.setState({ mode: 'speaker', isMonitorMuted: false } as any);
    const calls = withMockService();
    useAudioStore.getState().setMode('participant');
    expect(calls[calls.length - 1]).toBe(false);
  });

  it('setMode("speaker") restores the monitor to the saved preference (unmuted -> audible)', () => {
    useAudioStore.setState({ mode: 'both', isMonitorMuted: false } as any);
    const calls = withMockService();
    useAudioStore.getState().setMode('speaker');
    expect(calls[calls.length - 1]).toBe(true);
  });

  it('setMode("speaker") keeps the monitor silent when the saved preference is muted', () => {
    useAudioStore.setState({ mode: 'both', isMonitorMuted: true } as any);
    const calls = withMockService();
    useAudioStore.getState().setMode('speaker');
    expect(calls[calls.length - 1]).toBe(false);
  });

  it('setMode never mutates isMonitorMuted across a round trip', () => {
    useAudioStore.setState({ mode: 'speaker', isMonitorMuted: false } as any);
    withMockService();
    useAudioStore.getState().setMode('both');
    expect(useAudioStore.getState().isMonitorMuted).toBe(false);
    useAudioStore.getState().setMode('speaker');
    expect(useAudioStore.getState().isMonitorMuted).toBe(false);
  });
});
