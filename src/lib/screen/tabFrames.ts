/**
 * The extension's screen capture: the meeting tab's video, as a `Capture` for
 * the sampler. The tab arrives as a `TabStream` (shared with the tab's audio,
 * which Chrome allows only one capture of), and the picture is cropped to the
 * video the page is showing the shared screen in: the content script says where
 * that is, in CSS pixels, and `cropFor` maps it onto the frame. The box is asked
 * at open and every `BOX_REFRESH_MS`, since the shared screen moves and resizes.
 * A page that cannot be asked, or has no such video, is captured whole.
 *
 * Everything the platform supplies comes in through `deps`; the failures that
 * reject (a stream that cannot be opened, one without video) go to the caller,
 * which owns what the user is told.
 */
import { every, type Clock } from '../contract/clock';
import { describeCause, reportWarning } from '../diagnostics/report';
import type { Box, Size } from './pixels';
import type { Capture } from './sampler';
import type { TabStream } from './tabStream';

export type { Box } from './pixels';

/** The largest visible <video> on the page, in CSS pixels, with the viewport — the content script's answer to SCREEN_CONTEXT_BBOX. */
export interface BoxAnswer {
  box: Box | null;
  viewport: { width: number; height: number };
}

export const BOX_REFRESH_MS = 5000;

const whole = (frame: Size): Box => ({ x: 0, y: 0, width: frame.width, height: frame.height });

const finite = (...values: number[]) => values.every(Number.isFinite);

/**
 * `box` mapped from CSS pixels to the frame's pixels (the frame is the viewport at some scale), clamped to the
 * frame; a null box, a viewport without area, a box that is not numbers or has no area inside the frame — the whole frame.
 */
export function cropFor(answer: BoxAnswer | null, frame: { width: number; height: number }): Box {
  if (!answer?.box) return whole(frame);
  const { box, viewport } = answer;
  if (!finite(box.x, box.y, box.width, box.height, viewport.width, viewport.height)) return whole(frame);
  if (!(viewport.width > 0) || !(viewport.height > 0) || !(box.width > 0) || !(box.height > 0)) return whole(frame);

  const scaleX = frame.width / viewport.width;
  const scaleY = frame.height / viewport.height;
  const left = Math.max(0, Math.round(box.x * scaleX));
  const top = Math.max(0, Math.round(box.y * scaleY));
  const right = Math.min(frame.width, Math.round((box.x + box.width) * scaleX));
  const bottom = Math.min(frame.height, Math.round((box.y + box.height) * scaleY));
  if (right <= left || bottom <= top) return whole(frame);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface TabCaptureDeps {
  /** The meeting tab's stream: the caller decides whether it carries the audio too (`openTabStream`). */
  openStream(): Promise<TabStream>;
  /** The content script's answer, or null when it cannot be asked (no script on the page, the tab is navigating). */
  askBox(): Promise<BoxAnswer | null>;
  /** The `Capture` over a video track, drawing the region it is asked for on every grab (`canvasCapture`). */
  capture(track: MediaStreamTrack, options: { region(frame: Size): Box }): Omit<Capture, 'name' | 'kind'> & { close(): void };
  tabTitle(): Promise<string>;
  clock: Clock;
}

/**
 * Opens the tab's video. Once its track ends (the tab closed) every `grab()` resolves null, which the sampler tells
 * as a loss; `close()` does the same, stops the box timer and releases the stream (the audio, if the run uses it,
 * holds its own share of the capture). Rejects when the title cannot be read, the stream cannot be opened, or it
 * carries no video track.
 */
export async function openTabCapture(tabId: number, deps: TabCaptureDeps): Promise<Capture & { close(): void }> {
  const name = await deps.tabTitle();
  const tab = await deps.openStream();
  const track = tab.stream.getVideoTracks()[0];
  if (!track) {
    await tab.release();
    throw new Error(`The capture of tab ${tabId} has no video track`);
  }

  let closed = false;
  let latest: BoxAnswer | null = null;
  const refresh = async () => {
    let answer: BoxAnswer | null;
    try {
      answer = await deps.askBox();
    } catch {
      // A page that cannot be asked is captured whole until it answers again.
      answer = null;
    }
    if (!closed) latest = answer;
  };

  let inner: ReturnType<TabCaptureDeps['capture']>;
  try {
    inner = deps.capture(track, { region: (frame) => cropFor(latest, frame) });
  } catch (error) {
    await tab.release();
    throw error;
  }
  // Asked before the first grab, so the first frame is already the shared screen.
  await refresh();
  const stopRefreshing = every(deps.clock, BOX_REFRESH_MS, () => { void refresh(); });

  return {
    name,
    kind: 'tab',
    grab: async () => (closed || track.readyState === 'ended' ? null : inner.grab()),
    encode: (picture, quality) => inner.encode(picture, quality),
    close() {
      if (closed) return;
      closed = true;
      stopRefreshing();
      inner.close();
      tab.release().catch((error) => {
        reportWarning('TabFrames', `Releasing the tab capture failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'tab-frames:release' });
      });
    },
  };
}
