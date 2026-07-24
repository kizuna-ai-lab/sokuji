import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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
