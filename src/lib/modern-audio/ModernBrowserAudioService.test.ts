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

describe('participant capture first audio', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forwards the recorder\'s first-audio signal, so the UI can stop reading silence as a denial', async () => {
    setMediaDevices(vi.fn(), vi.fn().mockResolvedValue([]));
    vi.spyOn(ServiceFactory, 'isElectron').mockReturnValue(true);
    const handlers: Record<string, (payload: any) => void> = {};
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.electron = {
      invoke: vi.fn(async (channel: string) =>
        channel === 'connect-system-audio-source' ? { success: true, capture: 'app' } : { ok: true }),
      receive: vi.fn((channel: string, fn: (payload: any) => void) => { handlers[channel] = fn; }),
      removeListener: vi.fn((channel: string) => { delete handlers[channel]; }),
    };
    const svc = new ModernBrowserAudioService();
    const seen = vi.fn();
    svc.onParticipantAudioSeen = seen;

    await svc.connectSystemAudioSource('app:pid:42');
    await svc.startSystemAudioRecording(vi.fn());

    // One level window (~2 s at 24 kHz) with one audible sample in it.
    const samples = new Int16Array(48000);
    samples[10] = 2000;
    handlers['app-audio:pcm'](new Uint8Array(samples.buffer));

    expect(seen).toHaveBeenCalledTimes(1);
    await svc.stopSystemAudioRecording();
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

// Regression guard: the Linux tap's sink description carried a space, and pactl
// truncates sink_properties at the first one - the monitor came out as
// "Monitor of Sokuji" while the renderer looked for "Sokuji App Capture". It
// never matched, so every per-application session silently captured the whole
// system instead. The lookup also has to tolerate the browser's device list
// refreshing asynchronously after the sink is created.
describe('resolving the application-capture monitor', () => {
  const withDevices = (...frames: MediaDeviceInfo[][]) => {
    let i = 0;
    return vi.fn(async () => frames[Math.min(i++, frames.length - 1)]);
  };
  const dev = (label: string): MediaDeviceInfo =>
    ({ kind: 'audioinput', label, deviceId: `id-${label}`, groupId: '' } as MediaDeviceInfo);

  it('matches the monitor the sound server actually publishes', async () => {
    setMediaDevices(vi.fn(), withDevices([dev('Monitor of Sokuji_App_Capture')]));
    const svc = new ModernBrowserAudioService();

    const id = await (svc as any).resolveMonitorDeviceId('Sokuji_App_Capture');

    expect(id).toBe('id-Monitor of Sokuji_App_Capture');
  });

  it('waits for a device list that has not refreshed yet', async () => {
    setMediaDevices(vi.fn(), withDevices([], [], [dev('Monitor of Sokuji_App_Capture')]));
    const svc = new ModernBrowserAudioService();

    const id = await (svc as any).resolveMonitorDeviceId('Sokuji_App_Capture');

    expect(id).toBe('id-Monitor of Sokuji_App_Capture');
  });

  it('gives up rather than hanging when the monitor never appears', async () => {
    setMediaDevices(vi.fn(), withDevices([dev('Some other input')]));
    const svc = new ModernBrowserAudioService();

    expect(await (svc as any).resolveMonitorDeviceId('Sokuji_App_Capture')).toBeNull();
  });
});

// Switching the participant source mid-session used to do nothing: the picker
// stayed live (it is gated on mode, not on the session) but no code applied the
// change, so capture stayed on whatever was chosen at start.
describe('switching the participant source mid-session', () => {
  const service = () => {
    setMediaDevices(vi.fn(), vi.fn().mockResolvedValue([]));
    return new ModernBrowserAudioService();
  };

  it('rebuilds capture around the new source and keeps the same callback', async () => {
    const svc = service();
    const callback = vi.fn();
    const order: string[] = [];
    (svc as any).currentSystemAudioSinkId = 'app:pid:1';
    (svc as any).systemAudioCallback = callback;
    svc.stopSystemAudioRecording = vi.fn(async () => {
      order.push('stop');
      (svc as any).systemAudioCallback = null;   // as the real one does
    });
    svc.disconnectSystemAudioSource = vi.fn(async () => { order.push('disconnect'); });
    svc.connectSystemAudioSource = vi.fn(async () => { order.push('connect'); });
    svc.startSystemAudioRecording = vi.fn(async () => { order.push('start'); });

    await svc.switchParticipantSource('app:pid:2');

    expect(order).toEqual(['stop', 'disconnect', 'connect', 'start']);
    expect(svc.connectSystemAudioSource).toHaveBeenCalledWith('app:pid:2');
    // The callback is the only link to the live client, and stop() clears it -
    // it has to be captured before teardown or the session goes deaf.
    expect(svc.startSystemAudioRecording).toHaveBeenCalledWith(callback);
  });

  it('does nothing when the source is unchanged', async () => {
    const svc = service();
    (svc as any).currentSystemAudioSinkId = 'app:pid:1';
    svc.stopSystemAudioRecording = vi.fn();

    await svc.switchParticipantSource('app:pid:1');

    expect(svc.stopSystemAudioRecording).not.toHaveBeenCalled();
  });

  it('switches between whole-system and one application in either direction', async () => {
    const svc = service();
    (svc as any).currentSystemAudioSinkId = 'app:pid:1';
    (svc as any).systemAudioCallback = vi.fn();
    svc.stopSystemAudioRecording = vi.fn(async () => {});
    svc.disconnectSystemAudioSource = vi.fn(async () => {});
    svc.connectSystemAudioSource = vi.fn(async () => {});
    svc.startSystemAudioRecording = vi.fn(async () => {});

    await svc.switchParticipantSource('desktop-audio-loopback');
    expect(svc.connectSystemAudioSource).toHaveBeenLastCalledWith('desktop-audio-loopback');

    (svc as any).currentSystemAudioSinkId = 'desktop-audio-loopback';
    await svc.switchParticipantSource('app:pid:9');
    expect(svc.connectSystemAudioSource).toHaveBeenLastCalledWith('app:pid:9');
  });
});

// Review findings: rapid selections could interleave and leave the earlier
// source running, and a failed connect tore down the old capture without
// putting anything back - a live session with no participant audio.
describe('participant source switching is serialized and recoverable', () => {
  const svcWithStubs = () => {
    setMediaDevices(vi.fn(), vi.fn().mockResolvedValue([]));
    const svc = new ModernBrowserAudioService();
    (svc as any).currentSystemAudioSinkId = 'app:pid:1';
    (svc as any).systemAudioCallback = vi.fn();
    svc.stopSystemAudioRecording = vi.fn(async () => {});
    svc.disconnectSystemAudioSource = vi.fn(async () => {});
    svc.startSystemAudioRecording = vi.fn(async () => {});
    return svc;
  };

  it('runs overlapping switches one at a time, ending on the last one chosen', async () => {
    const svc = svcWithStubs();
    const order: string[] = [];
    svc.connectSystemAudioSource = vi.fn(async (id: string) => {
      order.push(`start:${id}`);
      await new Promise((r) => setTimeout(r, id.endsWith('2') ? 20 : 0));
      order.push(`end:${id}`);
      (svc as any).currentSystemAudioSinkId = id;
    });

    await Promise.all([
      svc.switchParticipantSource('app:pid:2'),
      svc.switchParticipantSource('app:pid:3'),
    ]);

    // No interleaving: each connect finishes before the next begins.
    expect(order).toEqual(['start:app:pid:2', 'end:app:pid:2', 'start:app:pid:3', 'end:app:pid:3']);
    expect((svc as any).currentSystemAudioSinkId).toBe('app:pid:3');
  });

  it('puts the previous source back when the new one cannot connect', async () => {
    const svc = svcWithStubs();
    const tried: string[] = [];
    svc.connectSystemAudioSource = vi.fn(async (id: string) => {
      tried.push(id);
      if (id === 'app:pid:9') throw new Error('that application is no longer playing audio');
    });

    await expect(svc.switchParticipantSource('app:pid:9')).rejects.toThrow(/no longer playing/);

    expect(tried).toEqual(['app:pid:9', 'app:pid:1']);
    // Recovered, not left dead: capture is running again on the old source.
    expect(svc.startSystemAudioRecording).toHaveBeenCalled();
  });

  it('a failed switch does not block the next one', async () => {
    const svc = svcWithStubs();
    svc.connectSystemAudioSource = vi.fn(async (id: string) => {
      if (id === 'app:pid:9') throw new Error('gone');
      (svc as any).currentSystemAudioSinkId = id;
    });

    await expect(svc.switchParticipantSource('app:pid:9')).rejects.toThrow();
    await svc.switchParticipantSource('app:pid:4');

    expect((svc as any).currentSystemAudioSinkId).toBe('app:pid:4');
  });
});

// Review finding (privacy): losing the helper silently widened capture from one
// chosen application to everything the machine plays, so audio the user never
// meant to share started reaching the translation provider with only a log line.
describe('losing the capture helper is announced', () => {
  it('warns before falling back to whole-system capture', async () => {
    setMediaDevices(vi.fn(), vi.fn().mockResolvedValue([]));
    (window as any).electron = {
      invoke: vi.fn().mockResolvedValue({ ok: true }),
      receive: vi.fn(),
      removeListener: vi.fn(),
    };
    const svc = new ModernBrowserAudioService();
    const codes: string[] = [];
    svc.onParticipantWarning = (c) => codes.push(c);
    svc.startSystemAudioRecording = vi.fn(async () => {});

    // Drive the real installation path rather than restating it here.
    await (svc as any).startAppAudioRecording('app:pid:42', vi.fn());
    const recorder = (svc as any).systemAudioRecorder;
    expect(recorder?.onLost).toBeTypeOf('function');

    recorder.onLost();

    expect(codes).toEqual(['app_capture_lost_using_system_audio']);
    expect(svc.startSystemAudioRecording).toHaveBeenCalled();
    delete (window as any).electron;
  });
});
