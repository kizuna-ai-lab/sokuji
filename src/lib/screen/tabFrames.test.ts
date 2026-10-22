import { describe, expect, it, vi } from 'vitest';
import { createVirtualClock } from '../contract/clock';
import { settleReports } from '../diagnostics/report';
import type { Box } from './pixels';
import type { Picture } from './sampler';
import { BOX_REFRESH_MS, cropFor, openTabCapture, type BoxAnswer } from './tabFrames';
import type { TabStream } from './tabStream';

// ---- fixtures ---------------------------------------------------------------------------------

const FRAME = { width: 2000, height: 1200 };
const SHARED: BoxAnswer = { box: { x: 100, y: 50, width: 800, height: 450 }, viewport: { width: 1000, height: 600 } };

function fakeTrack() {
  return { readyState: 'live' as MediaStreamTrackState, stop: vi.fn() };
}

function fakeTabStream(track: ReturnType<typeof fakeTrack> | null = fakeTrack()) {
  const release = vi.fn(async () => {});
  const tab = { stream: { getVideoTracks: () => (track ? [track] : []) } as unknown as MediaStream, release } satisfies TabStream;
  return { tab, track, release };
}

/** What `canvasCapture` does with a `region`: the video is `FRAME`, and the grab is the picture of the region it names. */
function fakeCapture() {
  const regions: Box[] = [];
  const inner = {
    grab: vi.fn(async (): Promise<Picture | null> => null),
    encode: vi.fn(async () => new Uint8Array([1, 2, 3])),
    close: vi.fn(),
  };
  const capture = vi.fn((_track: MediaStreamTrack, options: { region(frame: { width: number; height: number }): Box }) => {
    inner.grab.mockImplementation(async () => {
      const region = options.region(FRAME);
      regions.push(region);
      return { rgba: new Uint8ClampedArray(region.width * region.height * 4), width: region.width, height: region.height };
    });
    return inner;
  });
  return { capture, inner, regions };
}

function setup(o: { answer?: BoxAnswer | null; stream?: ReturnType<typeof fakeTabStream>; title?: string } = {}) {
  const clock = createVirtualClock(0);
  const stream = o.stream ?? fakeTabStream();
  const answers: Array<BoxAnswer | null | Error> = [];
  const askBox = vi.fn(async () => {
    const next = answers.length > 0 ? answers.shift()! : o.answer === undefined ? SHARED : o.answer;
    if (next instanceof Error) throw next;
    return next;
  });
  const { capture, inner, regions } = fakeCapture();
  const tabTitle = vi.fn(async () => o.title ?? 'Weekly sync - Google Meet');
  const openStream = vi.fn(async () => stream.tab);
  const deps = { openStream, askBox, capture, tabTitle, clock };
  return { deps, clock, stream, askBox, answers, capture, inner, regions, tabTitle, openStream };
}

/** Lets every pending promise reaction run: the box refresh settles on its own microtasks. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---- cropFor ----------------------------------------------------------------------------------

describe('cropFor', () => {
  it('maps the shared video\'s box from CSS pixels to the frame, and takes the whole frame without one', () => {
    expect(cropFor(SHARED, FRAME)).toEqual({ x: 200, y: 100, width: 1600, height: 900 });
    expect(cropFor(null, FRAME)).toEqual({ x: 0, y: 0, width: 2000, height: 1200 });
    expect(cropFor({ box: null, viewport: { width: 1000, height: 600 } }, FRAME)).toEqual({ x: 0, y: 0, width: 2000, height: 1200 });
  });

  it('scales each axis by its own ratio and rounds to whole pixels', () => {
    expect(cropFor(
      { box: { x: 10.5, y: 20, width: 300, height: 200.4 }, viewport: { width: 1000, height: 500 } },
      { width: 500, height: 1000 },
    )).toEqual({ x: 5, y: 40, width: 150, height: 401 });
  });

  it('clamps a box that runs past the viewport to the frame', () => {
    expect(cropFor(
      { box: { x: -100, y: 500, width: 600, height: 400 }, viewport: { width: 1000, height: 600 } },
      FRAME,
    )).toEqual({ x: 0, y: 1000, width: 1000, height: 200 });
  });

  it('takes the whole frame when the box is outside the viewport or the answer cannot be trusted', () => {
    const whole = { x: 0, y: 0, width: 2000, height: 1200 };
    expect(cropFor({ box: { x: 1200, y: 0, width: 400, height: 300 }, viewport: { width: 1000, height: 600 } }, FRAME)).toEqual(whole);
    expect(cropFor({ box: { x: 0, y: 0, width: 400, height: 300 }, viewport: { width: 0, height: 0 } }, FRAME)).toEqual(whole);
    expect(cropFor({ box: { x: 0, y: 0, width: Number.NaN, height: 300 }, viewport: { width: 1000, height: 600 } }, FRAME)).toEqual(whole);
    expect(cropFor({ box: { x: 0, y: 0, width: 0, height: 300 }, viewport: { width: 1000, height: 600 } }, FRAME)).toEqual(whole);
  });
});

// ---- openTabCapture ---------------------------------------------------------------------------

describe('openTabCapture', () => {
  it('asks the box at open and every 5 s, and close stops asking and releases the stream', async () => {
    const s = setup();
    const capture = await openTabCapture(7, s.deps);
    expect(s.askBox).toHaveBeenCalledTimes(1);

    s.clock.advance(BOX_REFRESH_MS);
    expect(s.askBox).toHaveBeenCalledTimes(2);
    s.clock.advance(BOX_REFRESH_MS);
    expect(s.askBox).toHaveBeenCalledTimes(3);

    capture.close();
    expect(s.stream.release).toHaveBeenCalledTimes(1);
    s.clock.advance(BOX_REFRESH_MS * 2);
    expect(s.askBox).toHaveBeenCalledTimes(3);
    expect(s.clock.pending()).toBe(0);
  });

  it('grabs the picture cropped to the latest box, named after the tab, kind tab', async () => {
    const s = setup();
    const capture = await openTabCapture(7, s.deps);
    expect(capture.name).toBe('Weekly sync - Google Meet');
    expect(capture.kind).toBe('tab');
    expect(s.capture).toHaveBeenCalledWith(s.stream.track, expect.objectContaining({ region: expect.any(Function) }));

    const picture = await capture.grab();
    expect(picture).toMatchObject({ width: 1600, height: 900 });
    expect(s.regions).toEqual([{ x: 200, y: 100, width: 1600, height: 900 }]);

    // The shared screen moved: the next grab follows it once the refresh has heard.
    s.answers.push({ box: { x: 0, y: 0, width: 500, height: 300 }, viewport: { width: 1000, height: 600 } });
    s.clock.advance(BOX_REFRESH_MS);
    await flush();
    await capture.grab();
    expect(s.regions[1]).toEqual({ x: 0, y: 0, width: 1000, height: 600 });
  });

  it('has the first grab cropped: the box is asked and answered before open resolves', async () => {
    const s = setup();
    const capture = await openTabCapture(7, s.deps);
    await capture.grab();
    expect(s.regions[0]).toEqual({ x: 200, y: 100, width: 1600, height: 900 });
  });

  it('grabs the whole frame when the page has no shared screen, or cannot be asked', async () => {
    const none = setup({ answer: { box: null, viewport: { width: 1000, height: 600 } } });
    await (await openTabCapture(7, none.deps)).grab();
    expect(none.regions[0]).toEqual({ x: 0, y: 0, width: 2000, height: 1200 });

    const unreachable = setup({ answer: null });
    await (await openTabCapture(7, unreachable.deps)).grab();
    expect(unreachable.regions[0]).toEqual({ x: 0, y: 0, width: 2000, height: 1200 });
  });

  it('a box refresh that fails falls back to the whole frame until the next one answers', async () => {
    const s = setup();
    const capture = await openTabCapture(7, s.deps);
    s.answers.push(new Error('Could not establish connection. Receiving end does not exist.'));
    s.clock.advance(BOX_REFRESH_MS);
    await flush();
    await capture.grab();
    expect(s.regions[0]).toEqual({ x: 0, y: 0, width: 2000, height: 1200 });

    s.clock.advance(BOX_REFRESH_MS);
    await flush();
    await capture.grab();
    expect(s.regions[1]).toEqual({ x: 200, y: 100, width: 1600, height: 900 });
  });

  it('an open whose first box ask fails still opens, on the whole frame', async () => {
    const s = setup();
    s.answers.push(new Error('no content script'));
    const capture = await openTabCapture(7, s.deps);
    await capture.grab();
    expect(s.regions[0]).toEqual({ x: 0, y: 0, width: 2000, height: 1200 });
  });

  it('encodes through the canvas capture', async () => {
    const s = setup();
    const capture = await openTabCapture(7, s.deps);
    const picture = { rgba: new Uint8ClampedArray(16), width: 2, height: 2 };
    await expect(capture.encode(picture, 0.7)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(s.inner.encode).toHaveBeenCalledWith(picture, 0.7);
  });

  it('grabs nothing once its track has ended or it is closed', async () => {
    const s = setup();
    const capture = await openTabCapture(7, s.deps);
    s.stream.track!.readyState = 'ended';
    await expect(capture.grab()).resolves.toBeNull();
    expect(s.inner.grab).not.toHaveBeenCalled();

    const t = setup();
    const closed = await openTabCapture(7, t.deps);
    closed.close();
    await expect(closed.grab()).resolves.toBeNull();
    expect(t.inner.grab).not.toHaveBeenCalled();
  });

  it('close lets go of the video, releases the stream once however often it is called', async () => {
    const s = setup();
    const capture = await openTabCapture(7, s.deps);
    capture.close();
    capture.close();
    expect(s.inner.close).toHaveBeenCalledTimes(1);
    expect(s.stream.release).toHaveBeenCalledTimes(1);
  });

  it('a release that fails does not escape close: it is recorded as a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const s = setup();
      s.stream.release.mockRejectedValueOnce(new Error('background gone'));
      const capture = await openTabCapture(7, s.deps);
      expect(() => capture.close()).not.toThrow();
      await settleReports();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('background gone');
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects and lets go of the stream when it carries no video track', async () => {
    const s = setup({ stream: fakeTabStream(null) });
    await expect(openTabCapture(7, s.deps)).rejects.toThrow('video track');
    expect(s.stream.release).toHaveBeenCalledTimes(1);
    expect(s.capture).not.toHaveBeenCalled();
    expect(s.clock.pending()).toBe(0);
  });

  it('rejects without opening the stream when the tab\'s title cannot be read', async () => {
    const s = setup();
    s.tabTitle.mockRejectedValueOnce(new Error('No tab with id: 7'));
    await expect(openTabCapture(7, s.deps)).rejects.toThrow('No tab with id');
    expect(s.openStream).not.toHaveBeenCalled();
  });

  it('rejects with the stream\'s own refusal', async () => {
    const s = setup();
    s.openStream.mockRejectedValueOnce(new Error('Tab not found'));
    await expect(openTabCapture(7, s.deps)).rejects.toThrow('Tab not found');
    expect(s.askBox).not.toHaveBeenCalled();
  });
});
