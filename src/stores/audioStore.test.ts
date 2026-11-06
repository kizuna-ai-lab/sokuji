import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import useAudioStore, { pickDefaultInputDevice, DEFAULT_PARTICIPANT_SOURCE } from './audioStore';
import type { AudioMode, AudioDevice } from './audioStore';
import { ServiceFactory } from '../services/ServiceFactory';
import { UNKNOWN_FORM, getOutputFormFactor, useOutputFormFactor, type NativeOutputsResult, type OutputDeviceInfo, type OutputForm } from '../lib/audio/formFactor';
import { currentNativeOutputs, requestForSync, startNativeOutputs } from '../lib/audio/nativeOutputs';

// Device enumeration moved to src/lib/audio/devices.ts (plan 1e-3c, controller
// ruling 3); refreshDevices calls its plain functions instead of the old
// audioService, so tests mock the module rather than an audioService object.
const mockListAudioDevices = vi.hoisted(() => vi.fn(async (_options?: { warmUp?: boolean }): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[]; complete?: boolean; outputLabelsKnown?: boolean; defaultOutput?: OutputForm; native?: readonly OutputDeviceInfo[] | null }> => ({ inputs: [], outputs: [] })));
const mockListSystemAudioSources = vi.hoisted(() => vi.fn(async () => [] as AudioDevice[]));
vi.mock('../lib/audio/devices', () => ({
  listAudioDevices: mockListAudioDevices,
  listSystemAudioSources: mockListSystemAudioSources,
}));

beforeEach(() => {
  mockListAudioDevices.mockReset().mockResolvedValue({ inputs: [], outputs: [], complete: true });
  mockListSystemAudioSources.mockReset().mockResolvedValue([]);
});

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

  // OS loopback inputs ("Stereo Mix", sink monitors) re-capture what the
  // machine is playing — Sokuji's own TTS included — so they are as bad an
  // automatic choice as Sokuji's own virtual devices. They carry
  // isVirtual: false (they are real OS devices and stay manually selectable,
  // with a warning); the auto-pick exclusion goes by label.
  it('never auto-picks an OS loopback-style input over a real mic', () => {
    const inputs: AudioDevice[] = [
      { deviceId: 'loop-1', label: 'Stereo Mix (Realtek High Definition Audio)', isVirtual: false },
      { deviceId: 'real-1', label: 'Built-in Microphone', isVirtual: false },
    ];
    expect(pickDefaultInputDevice(inputs)?.deviceId).toBe('real-1');
  });

  it('returns null when only virtual and loopback inputs exist', () => {
    const inputs: AudioDevice[] = [
      { deviceId: 'virtual-1', label: 'Sokuji_Virtual_Mic', isVirtual: true },
      { deviceId: 'loop-1', label: 'Monitor of Built-in Audio Analog Stereo', isVirtual: false },
    ];
    expect(pickDefaultInputDevice(inputs)).toBeNull();
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
    mockListAudioDevices.mockResolvedValueOnce({
      inputs: [{ deviceId: 'virtual-1', label: 'Sokuji_Virtual_Mic', isVirtual: true }],
      outputs: [],
    });

    await useAudioStore.getState().refreshDevices();

    const s = useAudioStore.getState();
    expect(s.selectedInputDevice).toBeNull();
    expect(s.isMicMuted).toBe(true);
  });

  it('turns the mic off when no input devices are enumerated at all', async () => {
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [], outputs: [] });

    await useAudioStore.getState().refreshDevices();

    const s = useAudioStore.getState();
    expect(s.selectedInputDevice).toBeNull();
    expect(s.isMicMuted).toBe(true);
  });

  it('still auto-selects a real microphone when one is present', async () => {
    mockListAudioDevices.mockResolvedValueOnce({
      inputs: [
        { deviceId: 'virtual-1', label: 'Sokuji_Virtual_Mic', isVirtual: true },
        { deviceId: 'real-1', label: 'Built-in Microphone', isVirtual: false },
      ],
      outputs: [],
    });

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
    } as any);
    mockListAudioDevices.mockResolvedValueOnce({
      inputs: [{ deviceId: 'virtual-1', label: 'Sokuji_Virtual_Mic', isVirtual: true }],
      outputs: [],
    });

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
    mockListAudioDevices.mockResolvedValueOnce({
      inputs: [{ deviceId: 'virtual-1', label: 'Sokuji_Virtual_Mic', isVirtual: true }],
      outputs: [],
    });

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

// ---------------------------------------------------------------------------
// Participant audio source selection (issue #335). The picker lets the user
// translate one application instead of everything the machine plays.
// ---------------------------------------------------------------------------
describe('audioStore - participant source selection', () => {
  beforeEach(() => {
    useAudioStore.setState({
      participantSources: [],
      selectedParticipantSource: DEFAULT_PARTICIPANT_SOURCE,
    });
  });

  it('defaults to whole-system capture', () => {
    expect(useAudioStore.getState().selectedParticipantSource?.deviceId)
      .toBe('desktop-audio-loopback');
  });

  it('selects a source', () => {
    const chromium: AudioDevice = { deviceId: 'app:pid:205', label: 'Chromium' };
    useAudioStore.getState().selectParticipantSource(chromium);
    expect(useAudioStore.getState().selectedParticipantSource).toEqual(chromium);
  });

  it('keeps the selection when it is still present after a refresh', () => {
    const chromium: AudioDevice = { deviceId: 'app:pid:205', label: 'Chromium' };
    useAudioStore.getState().selectParticipantSource(chromium);
    useAudioStore.getState().setParticipantSources([DEFAULT_PARTICIPANT_SOURCE, chromium]);
    expect(useAudioStore.getState().selectedParticipantSource).toEqual(chromium);
  });

  it('reverts to whole-system capture when the selected app disappears', () => {
    useAudioStore.getState().selectParticipantSource({ deviceId: 'app:pid:205', label: 'Chromium' });
    // The app quit; a refresh no longer lists it.
    useAudioStore.getState().setParticipantSources([DEFAULT_PARTICIPANT_SOURCE]);
    expect(useAudioStore.getState().selectedParticipantSource?.deviceId)
      .toBe('desktop-audio-loopback');
  });

  it('refreshDevices populates the participant sources', async () => {
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [], outputs: [] });
    mockListSystemAudioSources.mockResolvedValueOnce([
      DEFAULT_PARTICIPANT_SOURCE,
      { deviceId: 'app:pid:205', label: 'Chromium' },
    ]);

    await useAudioStore.getState().refreshDevices();

    expect(useAudioStore.getState().participantSources.map((s) => s.deviceId))
      .toEqual(['desktop-audio-loopback', 'app:pid:205']);
  });

  it('refreshDevices survives a platform with no per-application sources', async () => {
    // The web build and the browser extension have none: listSystemAudioSources
    // itself answers [] off Electron.
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [], outputs: [] });
    mockListSystemAudioSources.mockResolvedValueOnce([]);
    useAudioStore.setState({ participantSources: [] });

    await useAudioStore.getState().refreshDevices();

    expect(useAudioStore.getState().participantSources).toEqual([]);
  });

  it('refreshDevices survives the source listing throwing', async () => {
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [], outputs: [] });
    mockListSystemAudioSources.mockRejectedValueOnce(new Error('helper exploded'));
    useAudioStore.setState({ participantSources: [] });

    await useAudioStore.getState().refreshDevices();

    expect(useAudioStore.getState().participantSources).toEqual([]);
  });
});

// Regression guard (issue #335): after restarting the app the participant
// selection silently reverted to whole-system capture, because deviceId embeds
// a pid that is different every launch. On macOS that then demanded Screen
// Recording for a feature that does not need it, and the session aborted.
describe('audioStore - participant source survives a restart', () => {
  const CHROME_RUN_1: AudioDevice = { deviceId: 'app:pid:3940', label: 'Google Chrome', appKey: 'com.google.Chrome' };
  const CHROME_RUN_2: AudioDevice = { deviceId: 'app:pid:8271', label: 'Google Chrome', appKey: 'com.google.Chrome' };

  beforeEach(() => {
    useAudioStore.setState({
      participantSources: [],
      selectedParticipantSource: DEFAULT_PARTICIPANT_SOURCE,
      persistedParticipantAppKey: null,
    });
  });

  it('keeps the selection when the pid is unchanged', () => {
    useAudioStore.getState().selectParticipantSource(CHROME_RUN_1);
    useAudioStore.getState().setParticipantSources([DEFAULT_PARTICIPANT_SOURCE, CHROME_RUN_1]);
    expect(useAudioStore.getState().selectedParticipantSource?.deviceId).toBe('app:pid:3940');
  });

  it('re-finds the application after its pid changed', () => {
    useAudioStore.getState().selectParticipantSource(CHROME_RUN_1);
    // The app was restarted, so the same application now has a different pid.
    useAudioStore.getState().setParticipantSources([DEFAULT_PARTICIPANT_SOURCE, CHROME_RUN_2]);
    expect(useAudioStore.getState().selectedParticipantSource?.deviceId).toBe('app:pid:8271');
  });

  it('re-finds the application from a key persisted by a previous run', () => {
    // Fresh launch: nothing selected yet, only the saved key is known.
    useAudioStore.setState({ persistedParticipantAppKey: 'com.google.Chrome' });
    useAudioStore.getState().setParticipantSources([DEFAULT_PARTICIPANT_SOURCE, CHROME_RUN_2]);
    expect(useAudioStore.getState().selectedParticipantSource?.deviceId).toBe('app:pid:8271');
  });

  it('falls back to whole-system capture when the application is gone', () => {
    useAudioStore.getState().selectParticipantSource(CHROME_RUN_1);
    useAudioStore.getState().setParticipantSources([DEFAULT_PARTICIPANT_SOURCE]);
    expect(useAudioStore.getState().selectedParticipantSource?.deviceId).toBe('desktop-audio-loopback');
  });

  it('does not match a different application that happens to share a label', () => {
    useAudioStore.setState({ persistedParticipantAppKey: 'com.google.Chrome' });
    const other: AudioDevice = { deviceId: 'app:pid:99', label: 'Google Chrome', appKey: 'org.chromium.Chromium' };
    useAudioStore.getState().setParticipantSources([DEFAULT_PARTICIPANT_SOURCE, other]);
    expect(useAudioStore.getState().selectedParticipantSource?.deviceId).toBe('desktop-audio-loopback');
  });
});

describe('audioStore - participant capture widened', () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioStore.setState({ participantCaptureWidened: false } as any);
  });

  it('starts out not widened, follows the setter, and is never persisted', () => {
    expect(useAudioStore.getState().participantCaptureWidened).toBe(false);
    useAudioStore.getState().setParticipantCaptureWidened(true);
    expect(useAudioStore.getState().participantCaptureWidened).toBe(true);
    useAudioStore.getState().setParticipantCaptureWidened(false);
    expect(useAudioStore.getState().participantCaptureWidened).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('is a no-op when unchanged, so the routing is not rebuilt for nothing', () => {
    const listener = vi.fn();
    const off = useAudioStore.subscribe(listener);
    useAudioStore.getState().setParticipantCaptureWidened(false);
    off();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('audioStore - participant tap audio seen', () => {
  const KEY = 'audio.participantTapAudioSeen';

  beforeEach(() => {
    localStorage.clear();
    useAudioStore.setState({ participantTapAudioSeen: false } as any);
  });

  it('starts out unproven', () => {
    expect(useAudioStore.getState().participantTapAudioSeen).toBe(false);
  });

  it('records that a tap has delivered audio, and persists it for the next launch', async () => {
    useAudioStore.getState().markParticipantTapAudioSeen();

    expect(useAudioStore.getState().participantTapAudioSeen).toBe(true);
    expect(await ServiceFactory.getSettingsService().getSetting<boolean>(KEY, false)).toBe(true);
  });

  it('restores the fact on the next launch', async () => {
    await ServiceFactory.getSettingsService().setSetting(KEY, true);

    await useAudioStore.getState().refreshDevices();

    expect(useAudioStore.getState().participantTapAudioSeen).toBe(true);
  });
});

describe('audioStore — following the OS (syncDevices)', () => {
  const real = (deviceId: string, label = deviceId): AudioDevice => ({ deviceId, label, isVirtual: false });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    localStorage.clear();
    useAudioStore.setState({
      devicesLoaded: true,
      audioInputDevices: [real('mic-a'), real('mic-b')],
      audioMonitorDevices: [real('spk-a')],
      selectedInputDevice: real('mic-a'),
      selectedMonitorDevice: real('spk-a'),
      savedInputDeviceId: 'mic-a',
      savedMonitorDeviceId: 'spk-a',
      unusableInputIds: [],
      isMicMuted: false,
    } as any);
  });

  it('falls back to another real microphone when the selected one leaves the list, without saving it', async () => {
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-b')], outputs: [real('spk-a')], complete: true });
    await useAudioStore.getState().syncDevices();
    await flush();
    const s = useAudioStore.getState();
    expect(s.selectedInputDevice?.deviceId).toBe('mic-b');
    expect(s.savedInputDeviceId).toBe('mic-a');
    expect(localStorage.getItem('audio.selectedInputDeviceId') ?? '').not.toContain('mic-b');
  });

  it('switches back to the saved microphone when it returns', async () => {
    useAudioStore.setState({ selectedInputDevice: real('mic-b') });
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-b'), real('mic-a')], outputs: [real('spk-a')], complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().selectedInputDevice?.deviceId).toBe('mic-a');
  });

  it('waits — no selection — when only virtual or loopback inputs remain, and leaves mute alone', async () => {
    mockListAudioDevices.mockResolvedValueOnce({
      inputs: [{ deviceId: 'v', label: 'Sokuji_Virtual_Mic', isVirtual: true }, { deviceId: 'l', label: 'Monitor of Built-in Audio', isVirtual: false }],
      outputs: [real('spk-a')],
      complete: true,
    });
    await useAudioStore.getState().syncDevices();
    const s = useAudioStore.getState();
    expect(s.selectedInputDevice).toBeNull();
    expect(s.isMicMuted).toBe(false);
  });

  it('changes no selection when the listing has no labels, and keeps the lists when the listing failed', async () => {
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('Microphone 12345...')], outputs: [], complete: false });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().selectedInputDevice?.deviceId).toBe('mic-a');

    mockListAudioDevices.mockResolvedValueOnce({ inputs: [], outputs: [], complete: false });
    useAudioStore.setState({ audioInputDevices: [real('mic-a')] });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().audioInputDevices.map((d) => d.deviceId)).toEqual(['mic-a']);
    expect(useAudioStore.getState().selectedInputDevice?.deviceId).toBe('mic-a');
  });

  it('never warms up the permission, lists applications or re-reads settings', async () => {
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a')], outputs: [real('spk-a')], complete: true });
    await useAudioStore.getState().syncDevices();
    expect(mockListAudioDevices).toHaveBeenCalledWith({ warmUp: false });
    expect(mockListSystemAudioSources).not.toHaveBeenCalled();
  });

  it('does nothing before the first refresh has loaded the saved devices', async () => {
    useAudioStore.setState({ devicesLoaded: false });
    await useAudioStore.getState().syncDevices();
    expect(mockListAudioDevices).not.toHaveBeenCalled();
  });

  it('leaves an unusable input out until it leaves the list; back again, it is chosen again', async () => {
    useAudioStore.setState({ unusableInputIds: ['mic-a'] });
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: [], complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().selectedInputDevice?.deviceId).toBe('mic-b');

    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-b')], outputs: [], complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().unusableInputIds).toEqual([]);

    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: [], complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().selectedInputDevice?.deviceId).toBe('mic-a');
  });

  it('retryUnusable clears every mark and chooses the saved device again', async () => {
    useAudioStore.setState({ unusableInputIds: ['mic-a'], selectedInputDevice: real('mic-b') });
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: [real('spk-a')], complete: true });
    await useAudioStore.getState().syncDevices({ retryUnusable: true });
    const s = useAudioStore.getState();
    expect(s.unusableInputIds).toEqual([]);
    expect(s.selectedInputDevice?.deviceId).toBe('mic-a');
  });

  it('keeps the marks on a plain sync (the poll, a mark\'s own sync)', async () => {
    useAudioStore.setState({ unusableInputIds: ['mic-a'], selectedInputDevice: real('mic-b') });
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: [real('spk-a')], complete: true });
    await useAudioStore.getState().syncDevices();
    const s = useAudioStore.getState();
    expect(s.unusableInputIds).toEqual(['mic-a']);
    expect(s.selectedInputDevice?.deviceId).toBe('mic-b');
  });

  it('markInputUnusable leaves the device out and re-syncs at once', async () => {
    mockListAudioDevices.mockResolvedValue({ inputs: [real('mic-a'), real('mic-b')], outputs: [], complete: true });
    useAudioStore.getState().markInputUnusable('mic-a');
    await flush();
    expect(useAudioStore.getState().unusableInputIds).toEqual(['mic-a']);
    expect(useAudioStore.getState().selectedInputDevice?.deviceId).toBe('mic-b');
  });

  it("a user's pick clears its unusable mark and becomes the saved device", () => {
    useAudioStore.setState({ unusableInputIds: ['mic-b'] });
    useAudioStore.getState().selectInputDevice(real('mic-b'));
    const s = useAudioStore.getState();
    expect(s.unusableInputIds).toEqual([]);
    expect(s.savedInputDeviceId).toBe('mic-b');
  });

  it('notifies no subscriber when the listing has not changed', async () => {
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: [real('spk-a')], complete: true });
    const heard = vi.fn();
    const off = useAudioStore.subscribe(heard);
    await useAudioStore.getState().syncDevices();
    off();
    expect(heard).not.toHaveBeenCalled();
  });

  it('notifies no subscriber when an unlabelled listing has not changed either', async () => {
    useAudioStore.setState({ audioInputDevices: [real('Microphone 12345...')], audioMonitorDevices: [] });
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('Microphone 12345...')], outputs: [], complete: false });
    const heard = vi.fn();
    const off = useAudioStore.subscribe(heard);
    await useAudioStore.getState().syncDevices();
    off();
    expect(heard).not.toHaveBeenCalled();
  });

  it('replaces the selected device object when its label changed (a placeholder becoming its real name)', async () => {
    const before = useAudioStore.getState().selectedInputDevice;
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a', 'Mic A (USB)'), real('mic-b')], outputs: [real('spk-a')], complete: true });
    await useAudioStore.getState().syncDevices();
    const after = useAudioStore.getState().selectedInputDevice;
    expect(after).not.toBe(before);
    expect(after).toEqual(real('mic-a', 'Mic A (USB)'));
  });

  it('keeps the same device object when the choice did not change, so subscribers see no churn', async () => {
    const before = useAudioStore.getState().selectedInputDevice;
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: [real('spk-a')], complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().selectedInputDevice).toBe(before);
  });

  it('a form factor change alone replaces the output list', async () => {
    // A laptop's Linux port switching from speakers to headphones: same sink, same name.
    const spk = (formFactor: AudioDevice['formFactor'], transport: AudioDevice['transport']): AudioDevice => ({ ...real('spk-a'), formFactor, transport });
    const before = [spk('speakers', 'builtin')];
    useAudioStore.setState({ audioMonitorDevices: before });

    const unchanged = [spk('speakers', 'builtin')];
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: unchanged, complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().audioMonitorDevices).toBe(before);

    const headphones = [spk('headphones', 'builtin')];
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: headphones, complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().audioMonitorDevices).toBe(headphones);

    const overUsb = [spk('headphones', 'usb')];
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: overUsb, complete: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().audioMonitorDevices).toBe(overUsb);
  });

  it('the default output\'s form follows the listing, and an unchanged one wakes no subscriber', async () => {
    const inputs = [real('mic-a'), real('mic-b')];
    const outputs = [real('spk-a')];
    useAudioStore.setState({ defaultOutputForm: { formFactor: 'unknown', transport: 'unknown' } });

    mockListAudioDevices.mockResolvedValueOnce({ inputs, outputs, complete: true, defaultOutput: { formFactor: 'headphones', transport: 'bluetooth' } });
    await useAudioStore.getState().syncDevices();
    const headphones = useAudioStore.getState().defaultOutputForm;
    expect(headphones).toEqual({ formFactor: 'headphones', transport: 'bluetooth' });

    mockListAudioDevices.mockResolvedValueOnce({ inputs, outputs, complete: true, defaultOutput: { formFactor: 'headphones', transport: 'bluetooth' } });
    const heard = vi.fn();
    const off = useAudioStore.subscribe(heard);
    await useAudioStore.getState().syncDevices();
    off();
    expect(heard).not.toHaveBeenCalled();
    expect(useAudioStore.getState().defaultOutputForm).toBe(headphones);

    // Without labels the default is still known: it needs none.
    mockListAudioDevices.mockResolvedValueOnce({ inputs, outputs, complete: false, defaultOutput: { formFactor: 'speakers', transport: 'builtin' } });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().defaultOutputForm).toEqual({ formFactor: 'speakers', transport: 'builtin' });

    // A failed listing looks like every device gone: it changes nothing, the default's form included.
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [], outputs: [], complete: false, defaultOutput: { formFactor: 'unknown', transport: 'unknown' } });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().defaultOutputForm).toEqual({ formFactor: 'speakers', transport: 'builtin' });
  });

  it('keeps whether the outputs carry their own labels, as the listing reports it, complete or not', async () => {
    useAudioStore.setState({ outputLabelsKnown: false });
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: [real('spk-a')], complete: true, outputLabelsKnown: true });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().outputLabelsKnown).toBe(true);
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [real('mic-a'), real('mic-b')], outputs: [real('spk-a', 'Speaker spk-a...')], complete: false, outputLabelsKnown: false });
    await useAudioStore.getState().syncDevices();
    expect(useAudioStore.getState().outputLabelsKnown).toBe(false);
  });
});

describe('audioStore — stale reads unknown at the lookup (spec 2026-11-05 §6)', () => {
  const HEADPHONES: OutputForm = { formFactor: 'headphones', transport: 'bluetooth' };
  const AIRPODS: OutputDeviceInfo = { label: 'AirPods', isDefault: true, ...HEADPHONES, raw: {} };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const ok = (): NativeOutputsResult => ({ ok: true, devices: [{ ...AIRPODS }] });

  /** What devices.ts lists now: the forms joined from the answer current at the time, and that answer. */
  const joined = () => {
    const native = currentNativeOutputs();
    const form = native ? { formFactor: native[0].formFactor, transport: native[0].transport } : { ...UNKNOWN_FORM };
    return {
      inputs: [{ deviceId: 'mic-a', label: 'Mic', isVirtual: false }],
      outputs: [{ deviceId: 'hp', label: 'AirPods', isVirtual: false, ...form }],
      complete: true,
      outputLabelsKnown: true,
      defaultOutput: { ...form },
      native,
    };
  };
  const failed = { inputs: [], outputs: [], complete: false, outputLabelsKnown: false, defaultOutput: { ...UNKNOWN_FORM }, native: null };
  const neverLands = () => new Promise<never>(() => {});

  const stops: Array<() => void> = [];
  /** The reader started as Home starts it, on a fake main process whose reads land when the test says. */
  function startReader() {
    const reads: Array<(r: NativeOutputsResult) => void> = [];
    const pushes: Array<() => void> = [];
    const ipc = {
      invoke: vi.fn(() => new Promise<NativeOutputsResult>((resolve) => reads.push(resolve))),
      receive: vi.fn((_channel: string, fn: () => void) => { pushes.push(fn); }),
      removeListener: vi.fn(),
    };
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const native = startNativeOutputs(() => useAudioStore.getState().nativeOutputsChanged(), { ipc, doc });
    stops.push(native.dispose);
    return { native, reads, push: () => pushes[0]() };
  }

  /** Started, its first read landed and joined: every lookup has the answer. */
  async function current() {
    mockListAudioDevices.mockImplementation(async () => joined());
    const reader = startReader();
    reader.reads[0](ok());
    await settle();
    expect(getOutputFormFactor('hp')).toEqual(HEADPHONES);
    expect(getOutputFormFactor()).toEqual(HEADPHONES);
    return reader;
  }

  beforeEach(() => {
    localStorage.clear();
    useAudioStore.setState({
      devicesLoaded: true,
      nativeFormsCurrent: false,
      audioInputDevices: [],
      audioMonitorDevices: [],
      selectedInputDevice: null,
      selectedMonitorDevice: null,
      savedInputDeviceId: null,
      savedMonitorDeviceId: null,
      unusableInputIds: [],
      outputLabelsKnown: false,
      defaultOutputForm: { ...UNKNOWN_FORM },
    });
  });
  afterEach(async () => {
    mockListAudioDevices.mockImplementation(neverLands);
    while (stops.length) stops.pop()!();
    await settle();
  });

  it('a push or a devicechange makes every lookup unknown at once, before any sync lands', async () => {
    const reader = await current();

    mockListAudioDevices.mockImplementation(neverLands);
    reader.push();
    expect(getOutputFormFactor('hp')).toEqual(UNKNOWN_FORM);
    expect(getOutputFormFactor()).toEqual(UNKNOWN_FORM);
    // The list still holds the last join: the lookup is what says unknown.
    expect(useAudioStore.getState().audioMonitorDevices[0].formFactor).toBe('headphones');

    // The re-read lands and the store syncs: the answer is back.
    mockListAudioDevices.mockImplementation(async () => joined());
    reader.reads[1](ok());
    await settle();
    expect(getOutputFormFactor('hp')).toEqual(HEADPHONES);

    mockListAudioDevices.mockImplementation(neverLands);
    requestForSync(reader.native, 'change');
    expect(getOutputFormFactor('hp')).toEqual(UNKNOWN_FORM);
    expect(getOutputFormFactor()).toEqual(UNKNOWN_FORM);
  });

  it('a failed listing after an event still reads unknown, and so does the next answer until a listing joins it', async () => {
    const reader = await current();

    mockListAudioDevices.mockResolvedValue(failed);
    reader.push();
    await settle();
    expect(getOutputFormFactor('hp')).toEqual(UNKNOWN_FORM);
    // A failed listing changes nothing: the remembered headphones are still in the list, and not returned.
    expect(useAudioStore.getState().audioMonitorDevices[0].formFactor).toBe('headphones');

    // The re-read lands, but its listing fails too: the remembered join is still not the new answer's.
    reader.reads[1](ok());
    await settle();
    expect(currentNativeOutputs()).not.toBeNull();
    expect(getOutputFormFactor('hp')).toEqual(UNKNOWN_FORM);
    expect(getOutputFormFactor()).toEqual(UNKNOWN_FORM);

    mockListAudioDevices.mockImplementation(async () => joined());
    await useAudioStore.getState().syncDevices();
    expect(getOutputFormFactor('hp')).toEqual(HEADPHONES);
  });

  it('a listing that joined an answer gone stale before it landed does not count', async () => {
    mockListAudioDevices.mockImplementation(async () => joined());
    const reader = startReader();
    let land = () => {};
    mockListAudioDevices.mockImplementationOnce(() => {
      const listing = joined();
      return new Promise((resolve) => { land = () => resolve(listing); });
    });
    reader.reads[0](ok());
    await settle();
    expect(getOutputFormFactor('hp')).toEqual(UNKNOWN_FORM);

    mockListAudioDevices.mockImplementation(neverLands);
    reader.push();
    land();
    await settle();
    expect(useAudioStore.getState().audioMonitorDevices[0].formFactor).toBe('headphones');
    expect(getOutputFormFactor('hp')).toEqual(UNKNOWN_FORM);
  });

  it('a listing counts only for the answer it joined, not for a newer one current when it lands', async () => {
    mockListAudioDevices.mockImplementation(async () => joined());
    const reader = startReader();
    let land = () => {};
    mockListAudioDevices.mockImplementationOnce(() => {
      const listing = joined();
      return new Promise((resolve) => { land = () => resolve(listing); });
    });
    reader.reads[0](ok()); // headphones, joined by a listing still in flight
    await settle();

    mockListAudioDevices.mockImplementation(neverLands);
    reader.push();
    // The re-read says the default is now the speakers.
    reader.reads[1]({ ok: true, devices: [{ ...AIRPODS, isDefault: false }, { label: 'Speakers', isDefault: true, formFactor: 'speakers', transport: 'builtin', raw: {} }] });
    await settle();
    expect(currentNativeOutputs()).not.toBeNull();
    land();
    await settle();
    expect(useAudioStore.getState().defaultOutputForm).toEqual(HEADPHONES);
    expect(getOutputFormFactor()).toEqual(UNKNOWN_FORM);
  });

  it('dispose makes every lookup unknown', async () => {
    const reader = await current();
    mockListAudioDevices.mockImplementation(neverLands);
    reader.native.dispose();
    expect(getOutputFormFactor('hp')).toEqual(UNKNOWN_FORM);
    expect(getOutputFormFactor()).toEqual(UNKNOWN_FORM);
  });

  it('useOutputFormFactor follows the same answer', async () => {
    const reader = await current();
    const { result } = renderHook(() => useOutputFormFactor('hp'));
    expect(result.current).toEqual(HEADPHONES);

    mockListAudioDevices.mockImplementation(neverLands);
    act(() => reader.push());
    expect(result.current).toEqual(UNKNOWN_FORM);

    mockListAudioDevices.mockImplementation(async () => joined());
    await act(async () => {
      reader.reads[1](ok());
      await settle();
    });
    expect(result.current).toEqual(HEADPHONES);
  });

  it('refreshDevices counts the forms its listing joined from the current answer', async () => {
    mockListAudioDevices.mockImplementation(async () => joined());
    const reader = startReader();
    reader.reads[0](ok());
    await settle();
    useAudioStore.setState({ nativeFormsCurrent: false });
    await useAudioStore.getState().refreshDevices();
    expect(getOutputFormFactor('hp')).toEqual(HEADPHONES);
  });

  it('with no reader (the extension) every lookup is unknown, whatever a listing carries', async () => {
    mockListAudioDevices.mockResolvedValue({ ...joined(), outputs: [{ deviceId: 'hp', label: 'AirPods', isVirtual: false, ...HEADPHONES }], defaultOutput: HEADPHONES });
    await useAudioStore.getState().syncDevices();
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().nativeFormsCurrent).toBe(false);
    expect(getOutputFormFactor('hp')).toEqual(UNKNOWN_FORM);
    expect(getOutputFormFactor()).toEqual(UNKNOWN_FORM);
  });
});

describe('audioStore — refreshDevices and the saved device', () => {
  beforeEach(() => {
    localStorage.clear();
    useAudioStore.setState({ selectedInputDevice: { deviceId: 'mic-b', label: 'B', isVirtual: false }, devicesLoaded: false } as any);
  });

  it('prefers the saved microphone over the current one, remembers the saved ids, and marks the devices loaded', async () => {
    localStorage.setItem('audio.selectedInputDeviceId', 'mic-a');
    mockListAudioDevices.mockResolvedValueOnce({
      inputs: [{ deviceId: 'mic-b', label: 'B', isVirtual: false }, { deviceId: 'mic-a', label: 'A', isVirtual: false }],
      outputs: [],
      complete: true,
    });
    await useAudioStore.getState().refreshDevices();
    const s = useAudioStore.getState();
    expect(s.selectedInputDevice?.deviceId).toBe('mic-a');
    expect(s.savedInputDeviceId).toBe('mic-a');
    expect(s.devicesLoaded).toBe(true);
  });

  it('sets the default output\'s form', async () => {
    useAudioStore.setState({ defaultOutputForm: { formFactor: 'unknown', transport: 'unknown' } });
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [], outputs: [], complete: true, defaultOutput: { formFactor: 'speakers', transport: 'builtin' } });
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().defaultOutputForm).toEqual({ formFactor: 'speakers', transport: 'builtin' });
  });

  it('keeps whether the outputs carry their own labels', async () => {
    useAudioStore.setState({ outputLabelsKnown: false });
    mockListAudioDevices.mockResolvedValueOnce({ inputs: [], outputs: [{ deviceId: 'spk', label: 'Speakers', isVirtual: false }], complete: true, outputLabelsKnown: true });
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().outputLabelsKnown).toBe(true);
  });
});

describe('the Both popover seen flag', () => {
  const KEY = 'audio.bothPopoverSeen';

  it('defaults to false, persists, and restores', async () => {
    useAudioStore.setState({ bothPopoverSeen: false });
    useAudioStore.getState().setBothPopoverSeen(true);
    expect(await ServiceFactory.getSettingsService().getSetting<boolean>(KEY, false)).toBe(true);
    useAudioStore.setState({ bothPopoverSeen: false });
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().bothPopoverSeen).toBe(true);
  });

  it('reads anything but true as false', async () => {
    await ServiceFactory.getSettingsService().setSetting(KEY, 'yes');
    useAudioStore.setState({ bothPopoverSeen: true });
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().bothPopoverSeen).toBe(false);
  });
});

describe('the other side (face-to-face)', () => {
  const KEY = 'audio.otherSide';

  it('defaults to a meeting, persists a choice, and restores it', async () => {
    useAudioStore.setState({ otherSide: 'meeting' });
    expect(useAudioStore.getState().otherSide).toBe('meeting');
    useAudioStore.getState().setOtherSide('beside');
    expect(useAudioStore.getState().otherSide).toBe('beside');
    expect(await ServiceFactory.getSettingsService().getSetting<string>(KEY, '')).toBe('beside');

    useAudioStore.setState({ otherSide: 'meeting' });
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().otherSide).toBe('beside');
  });

  it('reads an unknown stored value as a meeting', async () => {
    await ServiceFactory.getSettingsService().setSetting(KEY, 'hallway');
    useAudioStore.setState({ otherSide: 'beside' });
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().otherSide).toBe('meeting');
  });
});

describe('echo cancellation', () => {
  const KEY = 'audio.echoCancellationMode';

  it('defaults to all sounds, persists a choice, and restores it', async () => {
    useAudioStore.setState({ echoCancellationMode: 'all' });
    useAudioStore.getState().setEchoCancellationMode('app');
    expect(useAudioStore.getState().echoCancellationMode).toBe('app');
    expect(await ServiceFactory.getSettingsService().getSetting<string>(KEY, '')).toBe('app');

    useAudioStore.setState({ echoCancellationMode: 'all' });
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().echoCancellationMode).toBe('app');
  });

  it('reads an unknown stored value as all sounds', async () => {
    await ServiceFactory.getSettingsService().setSetting(KEY, 'off');
    useAudioStore.setState({ echoCancellationMode: 'app' });
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().echoCancellationMode).toBe('all');
  });
});

describe('the outlets (spec 2026-10-10 §3)', () => {
  const fresh = () => useAudioStore.setState({ outlets: { other: { device: null, channel: 'auto' }, me: { device: null, channel: 'auto' }, them: { device: null, channel: 'auto' } } });

  it('follows the default device on auto channels until something is chosen', () => {
    fresh();
    expect(useAudioStore.getState().outlets).toEqual({
      other: { device: null, channel: 'auto' }, me: { device: null, channel: 'auto' }, them: { device: null, channel: 'auto' },
    });
  });

  it('persists a device and a channel per outlet, and restores them', async () => {
    fresh();
    useAudioStore.getState().setOutletDevice('them', 'usb-1');
    useAudioStore.getState().setOutletChannel('them', 'left');
    const service = ServiceFactory.getSettingsService();
    expect(await service.getSetting<string | null>('audio.outlet.them.device', null)).toBe('usb-1');
    expect(await service.getSetting<string>('audio.outlet.them.channel', '')).toBe('left');
    fresh();
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().outlets.them).toEqual({ device: 'usb-1', channel: 'left' });
    expect(useAudioStore.getState().outlets.me).toEqual({ device: null, channel: 'auto' });
  });

  it('keeps a stored device the list lacks: the choice is kept, following the default until it returns (Review Focus 1)', async () => {
    fresh();
    await ServiceFactory.getSettingsService().setSetting('audio.outlet.me.device', 'usb-gone');
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().outlets.me.device).toBe('usb-gone');
  });

  it('reads an unknown channel as auto and a non-string device as none', async () => {
    fresh();
    const service = ServiceFactory.getSettingsService();
    await service.setSetting('audio.outlet.other.channel', 'centre');
    await service.setSetting('audio.outlet.other.device', 42);
    await useAudioStore.getState().refreshDevices();
    expect(useAudioStore.getState().outlets.other).toEqual({ device: null, channel: 'auto' });
  });

  it('back to following the default: a null device is stored as null', async () => {
    fresh();
    useAudioStore.getState().setOutletDevice('me', 'usb-1');
    useAudioStore.getState().setOutletDevice('me', null);
    expect(useAudioStore.getState().outlets.me.device).toBeNull();
    expect(await ServiceFactory.getSettingsService().getSetting<string | null | number>('audio.outlet.me.device', -1)).toBeNull();
  });
});
