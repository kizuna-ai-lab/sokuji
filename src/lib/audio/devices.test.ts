import { describe, it, expect, vi, afterEach } from 'vitest';
import { ServiceFactory } from '../../services/ServiceFactory';

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
// enumerated device list. Ported from ModernBrowserAudioService.test.ts when
// device enumeration moved to this module (plan 1e-3c, controller ruling 3).

const reportWarningSpy = vi.hoisted(() => vi.fn());
const reportErrorSpy = vi.hoisted(() => vi.fn());
vi.mock('../diagnostics/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../diagnostics/report')>();
  return { ...actual, reportWarning: reportWarningSpy, reportError: reportErrorSpy };
});

import { listAudioDevices, listSystemAudioSources } from './devices';

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

describe('listAudioDevices', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    reportWarningSpy.mockClear();
    reportErrorSpy.mockClear();
    document.getElementById('sokuji-mic-error')?.remove();
  });

  it('returns devices WITHOUT opening the mic when labels are already present', async () => {
    const getUserMedia = vi.fn(async () => makeStream());
    const enumerateDevices = vi.fn(async () => LABELED);
    setMediaDevices(getUserMedia, enumerateDevices);

    const devices = await listAudioDevices();

    // The core fix: no unnecessary getUserMedia (which is what hung ~20s and
    // failed on the broken default device).
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(devices.inputs.map(d => d.deviceId)).toEqual(['mic-1']);
    expect(devices.outputs.map(d => d.deviceId)).toEqual(['spk-1']);
  });

  it('still returns the enumerated devices when the warm-up mic fails (broken default device), and reports a warning with the permission toast shown', async () => {
    const notReadable = Object.assign(new Error('Could not start audio source'), {
      name: 'NotReadableError',
    });
    // Labels missing -> warm-up attempted -> default device fails.
    const getUserMedia = vi.fn(() => Promise.reject(notReadable));
    const enumerateDevices = vi.fn(async () => UNLABELED);
    setMediaDevices(getUserMedia, enumerateDevices);

    const devices = await listAudioDevices();

    // The bug was returning { inputs: [], outputs: [] } here. It must NOT.
    expect(getUserMedia).toHaveBeenCalled();
    expect(devices.inputs.map(d => d.deviceId)).toEqual(['mic-1']);
    expect(devices.outputs.map(d => d.deviceId)).toEqual(['spk-1']);

    // A degraded fallback ran (the list is still returned), so this is a
    // warning, not an error, per CLAUDE.md's severity split.
    expect(reportWarningSpy).toHaveBeenCalledTimes(1);
    expect(reportWarningSpy.mock.calls[0][0]).toBe('AudioDevices');
    expect(reportErrorSpy).not.toHaveBeenCalled();

    // The permission toast is shown.
    const notification = document.getElementById('sokuji-mic-error');
    expect(notification).not.toBeNull();
    expect(notification?.textContent).toContain('already in use by another application');
  });

  it('warms up when an input lacks a label even if an output is labeled', async () => {
    const getUserMedia = vi.fn(async () => makeStream());
    let calls = 0;
    const enumerateDevices = vi.fn(async () =>
      ++calls === 1 ? LABELED_OUTPUT_UNLABELED_INPUT : LABELED
    );
    setMediaDevices(getUserMedia, enumerateDevices);

    await listAudioDevices();

    // Output label must not mask the unlabeled input — warm-up must still run.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('opens the mic only once for concurrent listAudioDevices() calls when a warm-up is needed', async () => {
    const streams: Array<{ getTracks: () => FakeTrack[] }> = [];
    const getUserMedia = vi.fn(
      () => new Promise((resolve) => setTimeout(() => { const s = makeStream(); streams.push(s); resolve(s); }, 5))
    );
    // First enumerate has no labels (forces warm-up); after warm-up, labels appear.
    let calls = 0;
    const enumerateDevices = vi.fn(async () => (++calls === 1 ? UNLABELED : LABELED));
    setMediaDevices(getUserMedia, enumerateDevices);

    await Promise.all([listAudioDevices(), listAudioDevices()]);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // Warm-up stream is released immediately (no leaked open source).
    expect(streams).toHaveLength(1);
    expect(streams[0].getTracks()[0].stop).toHaveBeenCalledTimes(1);
  });

  it('records an error and returns empty lists when enumeration itself throws', async () => {
    const enumerateDevices = vi.fn(() => Promise.reject(new Error('enumerateDevices unavailable')));
    setMediaDevices(vi.fn(), enumerateDevices);

    const devices = await listAudioDevices();

    expect(devices).toEqual({ inputs: [], outputs: [] });
    expect(reportErrorSpy).toHaveBeenCalledTimes(1);
    expect(reportErrorSpy.mock.calls[0][0]).toBe('AudioDevices');
  });
});

describe('listSystemAudioSources', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    reportWarningSpy.mockClear();
    delete (globalThis as any).window.electron;
  });

  it('returns [] outside Electron', async () => {
    vi.spyOn(ServiceFactory, 'isElectron').mockReturnValue(false);
    expect(await listSystemAudioSources()).toEqual([]);
  });

  it('returns [] when window.electron is unavailable even if isElectron is true', async () => {
    vi.spyOn(ServiceFactory, 'isElectron').mockReturnValue(true);
    delete (globalThis as any).window.electron;
    expect(await listSystemAudioSources()).toEqual([]);
  });

  it('returns [] when the platform does not support system audio capture', async () => {
    vi.spyOn(ServiceFactory, 'isElectron').mockReturnValue(true);
    (globalThis as any).window.electron = { invoke: vi.fn().mockResolvedValue(false) };
    expect(await listSystemAudioSources()).toEqual([]);
  });

  it('lists the sources reported by the main process', async () => {
    const sources = [{ deviceId: 'sink-1', label: 'Speakers' }];
    vi.spyOn(ServiceFactory, 'isElectron').mockReturnValue(true);
    const invoke = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(sources);
    (globalThis as any).window.electron = { invoke };

    expect(await listSystemAudioSources()).toEqual(sources);
    expect(invoke).toHaveBeenNthCalledWith(1, 'supports-system-audio-capture');
    expect(invoke).toHaveBeenNthCalledWith(2, 'list-system-audio-sources');
  });

  it('returns [] and reports a warning when the IPC call throws', async () => {
    vi.spyOn(ServiceFactory, 'isElectron').mockReturnValue(true);
    (globalThis as any).window.electron = {
      invoke: vi.fn().mockRejectedValue(new Error('ipc down')),
    };

    expect(await listSystemAudioSources()).toEqual([]);
    expect(reportWarningSpy).toHaveBeenCalledTimes(1);
    expect(reportWarningSpy.mock.calls[0][0]).toBe('AudioDevices');
  });
});
