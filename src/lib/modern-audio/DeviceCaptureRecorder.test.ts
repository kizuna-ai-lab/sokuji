import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeviceCaptureRecorder } from './DeviceCaptureRecorder';

const getUserMedia = vi.fn();

beforeEach(() => {
  getUserMedia.mockReset();
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
});

const fakeStream = () => ({
  getAudioTracks: () => [{ getSettings: () => ({ sampleRate: 24000 }) }],
  getVideoTracks: () => [],
}) as unknown as MediaStream;

describe('DeviceCaptureRecorder.acquireStream', () => {
  it('requests the given device with participant processing disabled', async () => {
    getUserMedia.mockResolvedValue(fakeStream());
    const rec = new DeviceCaptureRecorder(24000);

    await (rec as any).acquireStream({ deviceId: 'monitor-device-id' });

    const constraints = getUserMedia.mock.calls[0][0];
    expect(constraints.audio.deviceId).toEqual({ exact: 'monitor-device-id' });
    // Participant audio is already processed upstream; re-processing degrades ASR.
    expect(constraints.audio.echoCancellation).toBe(false);
    expect(constraints.audio.noiseSuppression).toBe(false);
    expect(constraints.audio.autoGainControl).toBe(false);
    // A video track would trigger the screen picker this path exists to avoid.
    expect(constraints.video).toBeUndefined();
  });

  it('throws a clear error when no deviceId is supplied', async () => {
    const rec = new DeviceCaptureRecorder(24000);
    await expect((rec as any).acquireStream({})).rejects.toThrow(/deviceId/i);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('surfaces a helpful message when the device has disappeared', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotFoundError' }));
    const rec = new DeviceCaptureRecorder(24000);
    await expect((rec as any).acquireStream({ deviceId: 'gone' })).rejects.toThrow(/no longer available/i);
  });

  it('surfaces the same message for OverconstrainedError', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('nope'), { name: 'OverconstrainedError' }));
    const rec = new DeviceCaptureRecorder(24000);
    await expect((rec as any).acquireStream({ deviceId: 'gone' })).rejects.toThrow(/no longer available/i);
  });

  it('rethrows unexpected errors unchanged', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('boom'), { name: 'NotAllowedError' }));
    const rec = new DeviceCaptureRecorder(24000);
    await expect((rec as any).acquireStream({ deviceId: 'x' })).rejects.toThrow('boom');
  });

  it('throws when the acquired stream carries no audio track', async () => {
    getUserMedia.mockResolvedValue({ getAudioTracks: () => [], getVideoTracks: () => [] } as unknown as MediaStream);
    const rec = new DeviceCaptureRecorder(24000);
    await expect((rec as any).acquireStream({ deviceId: 'x' })).rejects.toThrow(/no audio track/i);
  });

  it('does not connect to the audio destination (would echo)', () => {
    const rec = new DeviceCaptureRecorder(24000);
    expect((rec as any).shouldConnectToDestination()).toBe(false);
  });
});
