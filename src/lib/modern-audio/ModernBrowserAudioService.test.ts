import { describe, it, expect, vi, afterEach } from 'vitest';
import { ModernBrowserAudioService } from './ModernBrowserAudioService';

// Regression tests for the reported failure: on a single fresh launch the UI
// reported "no audio devices", after a ~20s freeze, with:
//   [ModernBrowserAudio] Microphone permission denied:
//   NotReadableError: Could not start audio source
//
// Root cause (captured from the packaged app's logs): enumerateDevices()
// SUCCEEDS and returns every device, but getDevices() then ran a
// getUserMedia({ audio: true }) "permission warm-up" that opens the system
// DEFAULT input. On this machine the default was a stale/phantom "3- ZUM-2"
// that hangs ~20s and rejects with NotReadableError. The old code let that
// warm-up failure DISCARD the good enumerated list and return empty.
//
// The fix: enumerate first; skip the warm-up entirely when labels are already
// present (permission granted); and never let a warm-up failure wipe the
// enumerated device list.

type FakeTrack = { stop: ReturnType<typeof vi.fn> };

function makeStream(): { getTracks: () => FakeTrack[] } {
  const track: FakeTrack = { stop: vi.fn() };
  return { getTracks: () => [track] };
}

function setMediaDevices(getUserMedia: any, enumerateDevices: any) {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia, enumerateDevices },
  });
}

const LABELED = [
  { deviceId: 'mic-1', kind: 'audioinput', label: 'Anker Powerconf C200', groupId: 'g1' },
  { deviceId: 'spk-1', kind: 'audiooutput', label: 'WR44-PLUS', groupId: 'g2' },
];
const UNLABELED = [
  { deviceId: 'mic-1', kind: 'audioinput', label: '', groupId: 'g1' },
  { deviceId: 'spk-1', kind: 'audiooutput', label: '', groupId: 'g2' },
];
// A labeled OUTPUT must not mask an unlabeled INPUT: the warm-up unlocks mic
// (input) labels, so it must still run here.
const LABELED_OUTPUT_UNLABELED_INPUT = [
  { deviceId: 'mic-1', kind: 'audioinput', label: '', groupId: 'g1' },
  { deviceId: 'spk-1', kind: 'audiooutput', label: 'WR44-PLUS', groupId: 'g2' },
];

describe('ModernBrowserAudioService.getDevices', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns devices WITHOUT opening the mic when labels are already present', async () => {
    const getUserMedia = vi.fn(async () => makeStream());
    const enumerateDevices = vi.fn(async () => LABELED);
    setMediaDevices(getUserMedia, enumerateDevices);

    const service = new ModernBrowserAudioService();
    const devices = await service.getDevices();

    // The core fix: no unnecessary getUserMedia (which is what hung ~20s and
    // failed on the broken default device).
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(devices.inputs.map(d => d.deviceId)).toEqual(['mic-1']);
    expect(devices.outputs.map(d => d.deviceId)).toEqual(['spk-1']);
  });

  it('still returns the enumerated devices when the warm-up mic fails (broken default device)', async () => {
    const notReadable = Object.assign(new Error('Could not start audio source'), {
      name: 'NotReadableError',
    });
    // Labels missing -> warm-up attempted -> default device fails.
    const getUserMedia = vi.fn(() => Promise.reject(notReadable));
    const enumerateDevices = vi.fn(async () => UNLABELED);
    setMediaDevices(getUserMedia, enumerateDevices);

    const service = new ModernBrowserAudioService();
    const devices = await service.getDevices();

    // The bug was returning { inputs: [], outputs: [] } here. It must NOT.
    expect(getUserMedia).toHaveBeenCalled();
    expect(devices.inputs.map(d => d.deviceId)).toEqual(['mic-1']);
    expect(devices.outputs.map(d => d.deviceId)).toEqual(['spk-1']);
  });

  it('warms up when an input lacks a label even if an output is labeled', async () => {
    const getUserMedia = vi.fn(async () => makeStream());
    let calls = 0;
    const enumerateDevices = vi.fn(async () =>
      ++calls === 1 ? LABELED_OUTPUT_UNLABELED_INPUT : LABELED
    );
    setMediaDevices(getUserMedia, enumerateDevices);

    const service = new ModernBrowserAudioService();
    await service.getDevices();

    // Output label must not mask the unlabeled input — warm-up must still run.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('opens the mic only once for concurrent getDevices() when a warm-up is needed', async () => {
    const streams: Array<{ getTracks: () => FakeTrack[] }> = [];
    const getUserMedia = vi.fn(
      () => new Promise((resolve) => setTimeout(() => { const s = makeStream(); streams.push(s); resolve(s); }, 5))
    );
    // First enumerate has no labels (forces warm-up); after warm-up, labels appear.
    let calls = 0;
    const enumerateDevices = vi.fn(async () => (++calls === 1 ? UNLABELED : LABELED));
    setMediaDevices(getUserMedia, enumerateDevices);

    const service = new ModernBrowserAudioService();
    await Promise.all([service.getDevices(), service.getDevices()]);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // Warm-up stream is released immediately (no leaked open source).
    expect(streams).toHaveLength(1);
    expect(streams[0].getTracks()[0].stop).toHaveBeenCalledTimes(1);
  });
});

describe('ModernBrowserAudioService.releaseMicrophone', () => {
  it('stops the recorder capture stream so the device is freed on close', () => {
    const service = new ModernBrowserAudioService();
    const recorder = service.getRecorder();
    const spy = vi.spyOn(recorder, 'releaseStream');

    service.releaseMicrophone();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('actually stops live capture tracks via the recorder', () => {
    const service = new ModernBrowserAudioService();
    const recorder = service.getRecorder();
    const track: FakeTrack = { stop: vi.fn() };
    (recorder as unknown as { stream: unknown }).stream = { getTracks: () => [track] };

    service.releaseMicrophone();

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect((recorder as unknown as { stream: unknown }).stream).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Per-application participant capture routing (issue #335).
// ---------------------------------------------------------------------------
import { ServiceFactory } from '../../services/ServiceFactory';

describe('participant capture routing', () => {
  function arrange(invokeResult: any) {
    setMediaDevices(vi.fn(), vi.fn().mockResolvedValue([]));
    vi.spyOn(ServiceFactory, 'isElectron').mockReturnValue(true);
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue(invokeResult),
      receive: vi.fn(),
      removeListener: vi.fn(),
    };
    return new ModernBrowserAudioService();
  }

  afterEach(() => vi.restoreAllMocks());

  it('records app capture mode when the main process reports it', async () => {
    const svc = arrange({ success: true, capture: 'app' });
    await svc.connectSystemAudioSource('app:pid:42');
    expect((svc as any).currentCaptureMode).toBe('app');
    expect(svc.isSystemAudioSourceConnected()).toBe(true);
  });

  it('stays in system mode for whole-system capture', async () => {
    const svc = arrange({ success: true, capture: 'system' });
    await svc.connectSystemAudioSource('desktop-audio-loopback');
    expect((svc as any).currentCaptureMode).toBe('system');
  });

  it('stays in system mode when the platform reports no capture field', async () => {
    // Linux and macOS still return a bare { success: true }.
    const svc = arrange({ success: true });
    await svc.connectSystemAudioSource('desktop-audio-loopback');
    expect((svc as any).currentCaptureMode).toBe('system');
  });

  it('propagates a main-process failure and stays disconnected', async () => {
    const svc = arrange({ success: false, error: 'helper unavailable' });
    await expect(svc.connectSystemAudioSource('app:pid:42')).rejects.toThrow('helper unavailable');
    expect(svc.isSystemAudioSourceConnected()).toBe(false);
    expect((svc as any).currentCaptureMode).toBe('system');
  });

  it('resets to system mode on disconnect', async () => {
    const svc = arrange({ success: true, capture: 'app' });
    await svc.connectSystemAudioSource('app:pid:42');
    await svc.disconnectSystemAudioSource();
    expect((svc as any).currentCaptureMode).toBe('system');
  });
});

describe('participant capture warnings', () => {
  it('exposes a hook the UI can use to surface helper warnings', () => {
    setMediaDevices(vi.fn(), vi.fn().mockResolvedValue([]));
    const svc = new ModernBrowserAudioService();

    // Default is null: without a UI listener a macOS permission denial is
    // invisible, since the session runs happily and stays silent.
    expect(svc.onParticipantWarning).toBeNull();

    const seen: string[] = [];
    svc.onParticipantWarning = (code) => seen.push(code);
    svc.onParticipantWarning('silent_no_permission');
    expect(seen).toEqual(['silent_no_permission']);
  });
});

describe('linux monitor-device resolution', () => {
  function arrange(devices: any[], invokeResult: any) {
    setMediaDevices(vi.fn(), vi.fn().mockResolvedValue(devices));
    vi.spyOn(ServiceFactory, 'isElectron').mockReturnValue(true);
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockResolvedValue(invokeResult),
      receive: vi.fn(),
      removeListener: vi.fn(),
    };
    return new ModernBrowserAudioService();
  }

  afterEach(() => vi.restoreAllMocks());

  it('resolves the monitor label to a Chromium input deviceId', async () => {
    const svc = arrange([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Built-in Microphone' },
      { kind: 'audioinput', deviceId: 'mon-9', label: 'Monitor of Sokuji App Capture' },
      // The same label on an output must not win - we need an input to record.
      { kind: 'audiooutput', deviceId: 'spk-1', label: 'Monitor of Sokuji App Capture' },
    ], { success: true, monitorLabel: 'Sokuji App Capture' });

    await svc.connectSystemAudioSource('app:205');

    expect((svc as any).currentMonitorDeviceId).toBe('mon-9');
  });

  it('falls back to whole-system loopback when the monitor cannot be resolved', async () => {
    const svc = arrange([], { success: true, monitorLabel: 'Sokuji App Capture' });

    await svc.connectSystemAudioSource('app:205');

    // Degrading to system-wide audio beats failing the session outright.
    expect((svc as any).currentMonitorDeviceId).toBeNull();
    expect(svc.isSystemAudioSourceConnected()).toBe(true);
  });

  it('leaves the monitor unset for whole-system capture', async () => {
    const svc = arrange([
      { kind: 'audioinput', deviceId: 'mon-9', label: 'Monitor of Sokuji App Capture' },
    ], { success: true });

    await svc.connectSystemAudioSource('desktop-audio-loopback');

    expect((svc as any).currentMonitorDeviceId).toBeNull();
  });

  it('clears the monitor deviceId on disconnect', async () => {
    const svc = arrange([
      { kind: 'audioinput', deviceId: 'mon-9', label: 'Monitor of Sokuji App Capture' },
    ], { success: true, monitorLabel: 'Sokuji App Capture' });
    await svc.connectSystemAudioSource('app:205');

    await svc.disconnectSystemAudioSource();

    expect((svc as any).currentMonitorDeviceId).toBeNull();
  });
});

describe('stopping app capture does not resurrect it', () => {
  it('clears the recorder fallback before ending it', async () => {
    setMediaDevices(vi.fn(), vi.fn().mockResolvedValue([]));
    const svc = new ModernBrowserAudioService();

    const recorder = { onLost: () => { throw new Error('fallback must be detached'); },
                       end: vi.fn().mockResolvedValue(undefined) };
    (svc as any).systemAudioRecorder = recorder;
    (svc as any).systemAudioRecordingActive = true;

    await svc.stopSystemAudioRecording();

    // end() kills the helper; a live onLost would restart whole-system capture
    // for a session that has already stopped.
    expect(recorder.onLost).toBeNull();
    expect(recorder.end).toHaveBeenCalled();
  });
});
