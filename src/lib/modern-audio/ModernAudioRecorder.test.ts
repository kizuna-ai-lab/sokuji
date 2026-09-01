import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModernAudioRecorder } from './ModernAudioRecorder';

const getUserMedia = vi.fn();

beforeEach(() => {
  getUserMedia.mockReset();
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** What getUserMedia rejects with: a DOMException, which carries its kind in `name`. */
const captureFailure = (name: string, message = 'capture failed') =>
  Object.assign(new Error(message), { name });

describe('ModernAudioRecorder.begin — a capture that fails is an error, not `false` (#458)', () => {
  // The old contract returned `false` and left the caller to find out from
  // record()'s "please call .begin() first" -- which is exactly what a user
  // whose microphone macOS had silently denied got to read.
  it('rejects with a permission message when the microphone is blocked', async () => {
    getUserMedia.mockRejectedValue(captureFailure('NotAllowedError', 'Permission denied'));
    const rec = new ModernAudioRecorder();

    await expect(rec.begin('mic-1')).rejects.toThrow(/microphone access is blocked/i);
    expect(rec.getStatus()).toBe('ended');
  });

  it('keeps the original failure as the cause and names its kind in the message', async () => {
    const cause = captureFailure('NotAllowedError', 'Permission denied');
    getUserMedia.mockRejectedValue(cause);
    const rec = new ModernAudioRecorder();

    const error = await rec.begin('mic-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { cause?: unknown }).cause).toBe(cause);
    expect((error as Error).message).toContain('NotAllowedError');
  });

  it('points at the OS privacy settings in Electron, at site permissions elsewhere', async () => {
    getUserMedia.mockRejectedValue(captureFailure('NotAllowedError'));

    const browser = await new ModernAudioRecorder().begin('mic-1').catch((e: Error) => e.message);
    expect(browser).toMatch(/site permissions/i);

    vi.stubGlobal('electronAPI', {});
    const electron = await new ModernAudioRecorder().begin('mic-1').catch((e: Error) => e.message);
    expect(electron).toMatch(/Privacy & Security/);
  });

  it('tells a vanished device apart from a busy one', async () => {
    getUserMedia.mockRejectedValue(captureFailure('NotFoundError'));
    await expect(new ModernAudioRecorder().begin('gone')).rejects.toThrow(/no longer available/i);

    getUserMedia.mockRejectedValue(captureFailure('NotReadableError'));
    await expect(new ModernAudioRecorder().begin('busy')).rejects.toThrow(/in use/i);
  });

  it('releases a stream it did acquire when a later step fails', async () => {
    const stop = vi.fn();
    const track = { stop, getSettings: () => ({ echoCancellation: true }) };
    getUserMedia.mockResolvedValue({ getAudioTracks: () => [track], getTracks: () => [track] });
    vi.stubGlobal('AudioContext', class {
      constructor() { throw new Error('no audio output hardware'); }
    });
    const rec = new ModernAudioRecorder();

    await expect(rec.begin('mic-1')).rejects.toThrow(/no audio output hardware/);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(rec.getStatus()).toBe('ended');
    // A retry must start from a clean slate, not trip "Already connected".
    getUserMedia.mockRejectedValue(captureFailure('NotAllowedError'));
    await expect(rec.begin('mic-1')).rejects.toThrow(/microphone access is blocked/i);
  });
});
