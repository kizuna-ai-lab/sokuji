import { describe, expect, it, vi } from 'vitest';
import type { Picture } from './sampler';
import { captureSourceMode, desktopConstraints, listCaptureSources, openDesktopCapture } from './desktopFrames';

// ---- fixtures ---------------------------------------------------------------------------------

/** A video track that can end: `stop()` does not fire `ended`, as in a browser; `end()` is the source going away. */
function fakeTrack() {
  const listeners = new Set<() => void>();
  const track = {
    readyState: 'live' as MediaStreamTrackState,
    stop: vi.fn(() => { track.readyState = 'ended'; }),
    addEventListener: vi.fn((type: string, listener: () => void) => { if (type === 'ended') listeners.add(listener); }),
    removeEventListener: vi.fn((type: string, listener: () => void) => { if (type === 'ended') listeners.delete(listener); }),
    end() {
      track.readyState = 'ended';
      for (const listener of [...listeners]) listener();
    },
  };
  return track;
}

function streamWith(...tracks: Array<ReturnType<typeof fakeTrack>>): MediaStream {
  return { getVideoTracks: () => tracks, getTracks: () => tracks } as unknown as MediaStream;
}

const picture: Picture = { rgba: new Uint8ClampedArray(16), width: 2, height: 2 };

function fakeCapture() {
  return {
    grab: vi.fn(async () => picture),
    encode: vi.fn(async () => new Uint8Array([1, 2, 3])),
    close: vi.fn(),
  };
}

const slides = { id: 'window:12:0', name: 'Slides', kind: 'window' as const };

// ---- the pick as a stream ----------------------------------------------------------------------

describe('desktopConstraints', () => {
  it('names the source by its desktop id, video only, at most 2 fps', () => {
    expect(desktopConstraints('screen:0:0')).toEqual({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'screen:0:0', maxFrameRate: 2 } },
    });
  });
});

describe('openDesktopCapture', () => {
  it('captures the pick through the desktop source id, video only, at most 2 fps, never the display-media path', async () => {
    const track = fakeTrack();
    const getUserMedia = vi.fn(async () => streamWith(track));
    await openDesktopCapture(slides, { getUserMedia, capture: fakeCapture });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'window:12:0', maxFrameRate: 2 } } });
  });

  it('is a Capture named and kinded as the pick, over the capture built from its video track', async () => {
    const track = fakeTrack();
    const inner = fakeCapture();
    const capture = vi.fn(() => inner);
    const opened = await openDesktopCapture(slides, { getUserMedia: async () => streamWith(track), capture });
    expect(capture).toHaveBeenCalledWith(track);
    expect(opened.name).toBe('Slides');
    expect(opened.kind).toBe('window');
    expect(await opened.grab()).toBe(picture);
    expect(await opened.encode(picture, 0.7)).toEqual(new Uint8Array([1, 2, 3]));
    expect(inner.encode).toHaveBeenCalledWith(picture, 0.7);
  });

  it('a track that ends makes every later grab null, and close stops the track', async () => {
    const track = fakeTrack();
    const inner = fakeCapture();
    const opened = await openDesktopCapture(slides, { getUserMedia: async () => streamWith(track), capture: () => inner });
    expect(await opened.grab()).toBe(picture);

    track.end();
    inner.grab.mockClear();
    expect(await opened.grab()).toBeNull();
    expect(await opened.grab()).toBeNull();
    expect(inner.grab).not.toHaveBeenCalled();

    opened.close();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('close stops the track, releases the capture, and makes every later grab null although stop() fires no ended event', async () => {
    const track = fakeTrack();
    const inner = fakeCapture();
    const opened = await openDesktopCapture(slides, { getUserMedia: async () => streamWith(track), capture: () => inner });

    opened.close();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(inner.close).toHaveBeenCalledOnce();
    expect(await opened.grab()).toBeNull();

    opened.close();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(inner.close).toHaveBeenCalledOnce();
  });

  it('a track already ended when asked reads as ended, without waiting for an event', async () => {
    const track = fakeTrack();
    const inner = fakeCapture();
    const opened = await openDesktopCapture(slides, { getUserMedia: async () => streamWith(track), capture: () => inner });
    track.readyState = 'ended';
    expect(await opened.grab()).toBeNull();
    expect(inner.grab).not.toHaveBeenCalled();
  });

  it('works over a capture that has nothing to release', async () => {
    const track = fakeTrack();
    const { grab, encode } = fakeCapture();
    const opened = await openDesktopCapture(slides, { getUserMedia: async () => streamWith(track), capture: () => ({ grab, encode }) });
    expect(() => opened.close()).not.toThrow();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it('rejects with the refusal when the stream cannot be opened, building no capture', async () => {
    const capture = vi.fn(fakeCapture);
    await expect(openDesktopCapture(slides, {
      getUserMedia: async () => { throw new Error('Could not start video source'); },
      capture,
    })).rejects.toThrow('Could not start video source');
    expect(capture).not.toHaveBeenCalled();
  });

  it('rejects when the stream has no video track, never naming the window (the message reaches the Logs panel), and leaves nothing running', async () => {
    const stray = fakeTrack();
    const stream = { getVideoTracks: () => [], getTracks: () => [stray] } as unknown as MediaStream;
    const opening = openDesktopCapture(slides, { getUserMedia: async () => stream, capture: fakeCapture });
    await expect(opening).rejects.toThrow('The picked capture has no video track');
    await expect(opening).rejects.not.toThrow(/Slides/);
    expect(stray.stop).toHaveBeenCalledOnce();
  });
});

// ---- the two channels --------------------------------------------------------------------------

describe('captureSourceMode', () => {
  it('reads the mode and the Screen Recording status through its channel', async () => {
    const invoke = vi.fn(async () => ({ mode: 'portal', screenRecording: 'granted' }));
    expect(await captureSourceMode(invoke)).toEqual({ mode: 'portal', screenRecording: 'granted' });
    expect(invoke).toHaveBeenCalledWith('capture-source-mode');
  });
});

describe('listCaptureSources', () => {
  const source = { id: 'screen:0:0', name: 'Entire Screen', kind: 'screen' as const, thumbnail: 'data:image/png;base64,AA', appIcon: null };

  it('reads the list through its channel', async () => {
    const invoke = vi.fn(async () => ({ ok: true, sources: [source] }));
    expect(await listCaptureSources(invoke)).toEqual({ ok: true, sources: [source] });
    expect(invoke).toHaveBeenCalledWith('list-capture-sources');
  });

  it('passes a refusal through as it came', async () => {
    const invoke = vi.fn(async () => ({ ok: false, error: 'screen-recording-denied' }));
    expect(await listCaptureSources(invoke)).toEqual({ ok: false, error: 'screen-recording-denied' });
  });
});
