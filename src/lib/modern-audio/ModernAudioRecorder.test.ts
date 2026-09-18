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

// The MediaRecorder runs for the whole session and hands us one encoded chunk
// every 100ms, but nothing in the app ever reads them: all five
// `recorder.end()` call sites discard the return value, and save() was only
// ever reached from end() itself. The chunks were pushed onto an array that
// lived as long as the session, so a heap snapshot of a 40-minute session
// showed 19,937 Blob objects still alive -- ~86MB of native memory, which
// survived the end of the session too, since only the next record() cleared
// the array. Issue #531.
describe('ModernAudioRecorder — the MediaRecorder output is not retained (#531)', () => {
  const fakeMediaRecorder = () => ({
    state: 'recording',
    ondataavailable: null as ((event: { data: unknown }) => void) | null,
    onstart: null as (() => void) | null,
    onstop: null as (() => void) | null,
    onerror: null as ((event: unknown) => void) | null,
  });

  const armed = () => {
    const rec = new ModernAudioRecorder() as any;
    rec.mediaRecorder = fakeMediaRecorder();
    rec.setupMediaRecorderEvents();
    return rec;
  };

  it('holds on to none of the chunks it is handed', () => {
    const rec = armed();

    const delivered: unknown[] = [];
    for (let i = 0; i < 600; i++) {  // 600 chunks == one minute at a 100ms timeslice
      const data = { size: 1600, seq: i };
      delivered.push(data);
      rec.mediaRecorder.ondataavailable({ data });
    }

    // Deliberately not "audioChunks is empty": the property that matters is
    // that no field of the recorder still points at a delivered chunk.
    const retaining = Object.entries(rec)
      .filter(([, value]) => Array.isArray(value) && value.some((x) => delivered.includes(x)))
      .map(([name]) => name);
    expect(retaining).toEqual([]);
  });

  it('still wires the lifecycle handlers', () => {
    const rec = armed();

    expect(typeof rec.mediaRecorder.ondataavailable).toBe('function');
    expect(typeof rec.mediaRecorder.onstart).toBe('function');
    expect(typeof rec.mediaRecorder.onstop).toBe('function');
    expect(typeof rec.mediaRecorder.onerror).toBe('function');
  });
});
