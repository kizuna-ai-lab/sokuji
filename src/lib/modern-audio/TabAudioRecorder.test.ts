import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromeTabStreamDeps, openTabStream, type TabStream } from '../screen/tabStream';
import { TabAudioRecorder } from './TabAudioRecorder';

// The recorder opens its tab through the one-capture-per-tab broker: audio always, video when the screen context
// shares the capture. These cases fail begin() on purpose (jsdom has no AudioContext), which is the path that ends
// in cleanup() alone.

function fakeTrack(kind: 'audio' | 'video') {
  const track = { kind, readyState: 'live' as MediaStreamTrackState, stop: vi.fn(() => { track.readyState = 'ended'; }) };
  return track;
}

describe('TabAudioRecorder over the tab stream broker', () => {
  const audio = fakeTrack('audio');
  const video = fakeTrack('video');
  let sendMessage: ReturnType<typeof vi.fn>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  const held: TabStream[] = [];
  let error: ReturnType<typeof vi.spyOn>;
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    audio.readyState = 'live';
    video.readyState = 'live';
    audio.stop.mockClear();
    video.stop.mockClear();
    sendMessage = vi.fn((_message: unknown, reply: (r: unknown) => void) => reply({ success: true, streamId: 'sid' }));
    vi.stubGlobal('chrome', { runtime: { sendMessage, lastError: undefined } });
    getUserMedia = vi.fn(async (c: MediaStreamConstraints) => {
      const tracks = [...(c.audio ? [audio] : []), ...(c.video ? [video] : [])];
      return new FakeMediaStream(tracks);
    });
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    vi.stubGlobal('MediaStream', FakeMediaStream);
    // begin() reports its failure through console.error before it returns false.
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
    info = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    error.mockRestore();
    info.mockRestore();
    for (const s of held.splice(0)) await s.release();
    vi.unstubAllGlobals();
  });

  const messages = () => sendMessage.mock.calls.map(([m]) => (m as { type: string }).type);

  it('captures audio alone unless the screen context asks for the video too', async () => {
    const recorder = new TabAudioRecorder(24000);
    await recorder.begin({ tabId: 5 });
    expect(getUserMedia.mock.calls[0][0].video).toBe(false);

    const withVideo = new TabAudioRecorder(24000);
    await withVideo.begin({ tabId: 6, video: true });
    expect(getUserMedia.mock.calls[1][0].video).toMatchObject({ mandatory: { chromeMediaSource: 'tab', maxFrameRate: 2 } });
    expect(getUserMedia.mock.calls[1][0].audio).toMatchObject({ mandatory: { chromeMediaSource: 'tab' } });
  });

  it('a begin that fails after the capture opened lets go of it, and tells the background', async () => {
    const recorder = new TabAudioRecorder(24000);
    await expect(recorder.begin({ tabId: 5 })).resolves.toBe(false);
    expect(audio.stop).toHaveBeenCalled();
    expect(messages()).toEqual(['START_TAB_CAPTURE', 'STOP_TAB_CAPTURE']);
  });

  it('stops only the audio it holds: the video another opener shares stays live, and the tab is not told to stop', async () => {
    held.push(await openTabStream(5, { audio: true, video: true }, chromeTabStreamDeps()));
    const recorder = new TabAudioRecorder(24000);
    await expect(recorder.begin({ tabId: 5, video: true })).resolves.toBe(false);

    expect(audio.stop).toHaveBeenCalled();
    expect(video.stop).not.toHaveBeenCalled();
    expect(messages()).toEqual(['START_TAB_CAPTURE']);
  });
});

/** The part of `MediaStream` the recorder and the broker use. */
class FakeMediaStream {
  constructor(private readonly tracks: Array<ReturnType<typeof fakeTrack>>) {}
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
}
