import { describe, it, expect, beforeEach, vi } from 'vitest';
import useAudioStore, { pickDefaultInputDevice, DEFAULT_PARTICIPANT_SOURCE } from './audioStore';
import type { AudioMode, AudioDevice } from './audioStore';
import { ServiceFactory } from '../services/ServiceFactory';

// Device enumeration moved to src/lib/audio/devices.ts (plan 1e-3c, controller
// ruling 3); refreshDevices calls its plain functions instead of the old
// audioService, so tests mock the module rather than an audioService object.
const mockListAudioDevices = vi.hoisted(() => vi.fn(async (_options?: { warmUp?: boolean }): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[]; complete?: boolean }> => ({ inputs: [], outputs: [] })));
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
});
