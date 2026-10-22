import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openTabStream, tabConstraints, type TabStream, type TabStreamDeps } from './tabStream';

// ---- fixtures ---------------------------------------------------------------------------------

function fakeTrack(kind: 'audio' | 'video') {
  const track = { kind, readyState: 'live' as MediaStreamTrackState, stop: vi.fn(() => { track.readyState = 'ended'; }) };
  return track;
}

type Background = TabStreamDeps['background'];

/** The getUserMedia of a tab capture: one track per kind the constraints ask for. */
function fixture() {
  const audio = fakeTrack('audio');
  const video = fakeTrack('video');
  const background = vi.fn<Background>(async () => ({ success: true, streamId: 'sid' }));
  const getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
    const tracks = [...(c.audio ? [audio] : []), ...(c.video ? [video] : [])];
    return {
      getTracks: () => tracks,
      getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
      getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    } as unknown as MediaStream;
  });
  return { audio, video, background, getUserMedia, deps: { background, getUserMedia } satisfies TabStreamDeps };
}

describe('openTabStream', () => {
  let f: ReturnType<typeof fixture>;
  const opened: TabStream[] = [];
  /** Every stream a test opens is released afterwards: the open captures are module state. */
  const open = async (tabId: number, wants: { audio: boolean; video: boolean }) => {
    const s = await openTabStream(tabId, wants, f.deps);
    opened.push(s);
    return s;
  };

  beforeEach(() => { f = fixture(); });
  afterEach(async () => {
    for (const s of opened.splice(0)) await s.release();
  });

  it('asks the background for the tab\'s stream id once and captures the tracks asked for', async () => {
    await open(7, { audio: true, video: true });
    expect(f.background).toHaveBeenCalledTimes(1);
    expect(f.background).toHaveBeenCalledWith({ type: 'START_TAB_CAPTURE', tabId: 7 });
    expect(f.getUserMedia).toHaveBeenCalledTimes(1);
    expect(f.getUserMedia).toHaveBeenCalledWith({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'sid' } },
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'sid', maxFrameRate: 2 } },
    });
  });

  it('a second opener of the same tab shares the stream, and only the last release stops it and tells the background', async () => {
    const a = await open(7, { audio: true, video: true });
    const b = await open(7, { audio: false, video: true });
    expect(b.stream).toBe(a.stream);
    expect(f.getUserMedia).toHaveBeenCalledTimes(1);
    expect(f.background).toHaveBeenCalledTimes(1);

    await a.release();
    expect(f.audio.stop).not.toHaveBeenCalled();
    expect(f.video.stop).not.toHaveBeenCalled();
    expect(f.background).toHaveBeenCalledTimes(1);

    await b.release();
    expect(f.audio.stop).toHaveBeenCalledTimes(1);
    expect(f.video.stop).toHaveBeenCalledTimes(1);
    expect(f.background).toHaveBeenLastCalledWith({ type: 'STOP_TAB_CAPTURE', tabId: 7 });
    expect(f.background).toHaveBeenCalledTimes(2);
  });

  it('openers that arrive together share one capture: the background is asked once', async () => {
    const [a, b] = await Promise.all([
      open(7, { audio: true, video: true }),
      open(7, { audio: false, video: true }),
    ]);
    expect(b.stream).toBe(a.stream);
    expect(f.background).toHaveBeenCalledTimes(1);
    expect(f.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('rejects a second opener that wants a track the open stream lacks, naming it', async () => {
    await open(7, { audio: true, video: false });
    await expect(open(7, { audio: false, video: true })).rejects.toThrow('video');
  });

  it('a refused joiner holds no reference: the opener\'s release still stops the stream', async () => {
    const a = await open(7, { audio: true, video: false });
    await expect(open(7, { audio: false, video: true })).rejects.toThrow('video');
    await a.release();
    expect(f.audio.stop).toHaveBeenCalledTimes(1);
    expect(f.background).toHaveBeenLastCalledWith({ type: 'STOP_TAB_CAPTURE', tabId: 7 });
  });

  it('a background refusal rejects with its error and never calls getUserMedia', async () => {
    f.background.mockResolvedValueOnce({ success: false, error: 'Tab not found' });
    await expect(open(8, { audio: false, video: true })).rejects.toThrow('Tab not found');
    expect(f.getUserMedia).not.toHaveBeenCalled();
  });

  it('a background that answers without a stream id rejects without calling getUserMedia', async () => {
    f.background.mockResolvedValueOnce({ success: true });
    await expect(open(8, { audio: true, video: false })).rejects.toThrow('stream id');
    expect(f.getUserMedia).not.toHaveBeenCalled();
  });

  it('a getUserMedia failure rejects with it and tells the background to forget the tab, so a retry is given a fresh id', async () => {
    f.getUserMedia.mockRejectedValueOnce(new Error('Chrome has not been invoked for the current page'));
    await expect(open(9, { audio: true, video: true })).rejects.toThrow('Chrome has not been invoked');
    expect(f.background).toHaveBeenLastCalledWith({ type: 'STOP_TAB_CAPTURE', tabId: 9 });

    await open(9, { audio: true, video: true });
    expect(f.background).toHaveBeenCalledTimes(3);
    expect(f.background).toHaveBeenLastCalledWith({ type: 'START_TAB_CAPTURE', tabId: 9 });
  });

  it('openers that arrive together on a capture that fails all reject, and the next open starts again', async () => {
    f.getUserMedia.mockRejectedValueOnce(new Error('denied'));
    const results = await Promise.allSettled([
      open(9, { audio: true, video: false }),
      open(9, { audio: true, video: false }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    await open(9, { audio: true, video: false });
    expect(f.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('a release is spent once: a second call neither stops the stream under a holder nor tells the background twice', async () => {
    const a = await open(7, { audio: true, video: true });
    const b = await open(7, { audio: false, video: true });
    await a.release();
    await a.release();
    expect(f.video.stop).not.toHaveBeenCalled();
    await b.release();
    expect(f.video.stop).toHaveBeenCalledTimes(1);
    expect(f.background).toHaveBeenCalledTimes(2);
  });

  it('opens a fresh capture once the last release has gone: the stream id of the old one was consumed', async () => {
    const a = await open(7, { audio: true, video: false });
    await a.release();
    const b = await open(7, { audio: false, video: true });
    expect(b.stream).not.toBe(a.stream);
    expect(f.background.mock.calls.map(([m]) => m.type)).toEqual(['START_TAB_CAPTURE', 'STOP_TAB_CAPTURE', 'START_TAB_CAPTURE']);
  });

  it('keeps different tabs apart', async () => {
    const a = await open(7, { audio: true, video: false });
    const b = await open(8, { audio: true, video: false });
    expect(b.stream).not.toBe(a.stream);
    expect(f.getUserMedia).toHaveBeenCalledTimes(2);
  });
});

describe('tabConstraints', () => {
  it('asks for a track by the stream id, and refuses the other with false', () => {
    expect(tabConstraints('sid', { audio: true, video: false })).toEqual({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'sid' } },
      video: false,
    });
    expect(tabConstraints('sid', { audio: false, video: true })).toEqual({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: 'sid', maxFrameRate: 2 } },
    });
  });
});
