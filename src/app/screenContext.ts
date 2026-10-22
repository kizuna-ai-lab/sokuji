/**
 * Screen context around a run (spec 2026-10-22 §3.1, §3.3, §4): the area the
 * user lets Qwen see, chosen before Start, sampled into frames for the run's
 * legs, and let go when the run is over.
 *
 * Before a run `prepareScreenContext` opens the capture — on the desktop the
 * one the picker (the modal Task 8 mounts) hands back, in the extension the
 * meeting tab — attaches it to a fresh sampler and waits for its first good
 * frame. Only then does the sampler go into `useScreenContextStore`, where
 * `readShapeFromStores` hands its `source` to the run: a source with no frame
 * behind it would let a Qwen session declare video and be cut off at its first
 * turn. `chooseAgain` swaps the capture under the same sampler mid-run, checked the same way, and
 * `releaseScreenContext` closes both once the run is back to idle.
 *
 * A failure never reaches Start: it is a `reportWarning` and a run without
 * frames.
 */
import type { Clock } from '../lib/contract/clock';
import { targetTabIdFromSearch } from '../lib/audio/tabMicrophone';
import { describeCause, reportWarning } from '../lib/diagnostics/report';
import type { Platform } from '../lib/provider/types';
import { canvasCapture } from '../lib/screen/canvasCapture';
import { listCaptureSources, type CaptureSourceInfo, type Invoke, type openDesktopCapture } from '../lib/screen/desktopFrames';
import { createSampler, type Capture, type Sampler } from '../lib/screen/sampler';
import type { BoxAnswer, openTabCapture, TabCaptureDeps } from '../lib/screen/tabFrames';
import { chromeTabStreamDeps, openTabStream } from '../lib/screen/tabStream';
import type { RunShape } from '../lib/session/types';
import { useScreenContextStore } from '../stores/screenContextStore';

// The one place that reads the switch, beside the provider selection it depends on.
export { screenContextWanted } from '../lib/session/appShape';

export type PickedSource = { kind: 'desktop'; source: CaptureSourceInfo } | { kind: 'portal' };
/** Why the picker is shown again: the area just picked yielded no frame. */
export type PickReason = 'nothingVisible';

export interface ScreenContextDeps {
  /** The picker: a source, the portal's button, or null for Start without screen context. */
  pick(reason?: PickReason): Promise<PickedSource | null>;
  clock: Clock;
  invoke: Invoke;
  openDesktop: typeof openDesktopCapture;
  openTab: typeof openTabCapture;
}

type OpenCapture = Capture & { close(): void };

/** How long the meeting tab is given to say where its shared screen is. */
const BOX_TIMEOUT_MS = 2000;
/** The capture's name when the tab's title cannot be read. */
const TAB_NAME_FALLBACK = 'Meeting tab';

/**
 * The capture under the store's sampler: the store holds the sampler and its state, this the capture closed with it;
 * null after a Choose again whose area showed nothing was cancelled.
 */
let held: { sampler: Sampler; capture: OpenCapture | null } | null = null;

/**
 * Before a run. On Electron: asks `pick` (the modal) for a source — null is a cancel, the run starts without — opens the
 * capture, attaches it to a fresh sampler and waits for the first good frame (`first()`); a null first frame closes that
 * capture and asks `pick('nothingVisible')` again, until a frame comes or the user cancels. On the extension: opens the
 * meeting tab's capture (`targetTabIdFromSearch`) with `audio: shape.legs.includes('participant')` (the extension's
 * participant source is always that tab), `video: true`; a null first frame there starts the run without.
 * Puts the sampler in the store and mirrors its state there; while a capture is opened and its first frame awaited the
 * store is `preparing`. Never throws into Start: a failed capture is a `reportWarning('ScreenContext', …)` and a run
 * without frames.
 */
export async function prepareScreenContext(platform: Platform, shape: Pick<RunShape, 'legs'>, deps: ScreenContextDeps): Promise<void> {
  try {
    if (platform === 'electron') await prepareDesktop(deps);
    else if (platform === 'extension') await prepareTab(shape, deps);
  } catch (error) {
    reportWarning('ScreenContext', `The screen could not be captured; the session starts without screen context: ${describeCause(error)}`, { cause: error });
  }
}

/** When the run is over: closes the sampler and empties the store. */
export function releaseScreenContext(): void {
  const current = held;
  held = null;
  useScreenContextStore.getState().sampler?.close();
  if (current) {
    current.sampler.close();
    if (current.capture) closeQuietly(current.capture);
  }
  useScreenContextStore.getState().set(null);
  useScreenContextStore.getState().setState(null);
}

/**
 * Choose again, mid-run: a new pick replaces the capture on the same sampler (`attach`), so the legs' subscriptions
 * stand, and is checked as a start's is: until its first good frame (`first()`). One that shows nothing is closed, the
 * sampler left without a capture (lost), and the picker asked again with the reason; a cancel then leaves it lost.
 */
export async function chooseAgain(deps: Pick<ScreenContextDeps, 'pick' | 'invoke' | 'openDesktop'>): Promise<void> {
  const current = held;
  if (!current) return;
  try {
    let reason: PickReason | undefined;
    for (;;) {
      const picked = await deps.pick(reason);
      // A cancel keeps what is shared (nothing, after an area that showed nothing); a run that ended while the picker
      // was open has nothing to replace.
      if (!picked || held !== current) return;
      const capture = await openPicked(picked, deps);
      if (!capture) return;
      if (held !== current) {
        closeQuietly(capture);
        return;
      }
      // Closed and replaced in one step, so no beat ever grabs the closed one and tells a loss.
      if (current.capture) closeQuietly(current.capture);
      current.capture = capture;
      current.sampler.attach(capture);
      const frame = await current.sampler.first();
      // A run that ended during the check closed this capture with its sampler.
      if (frame || held !== current) return;
      current.sampler.detach();
      current.capture = null;
      closeQuietly(capture);
      reason = 'nothingVisible';
    }
  } catch (error) {
    const after = current.capture ? 'the one chosen before stays' : 'translation continues on audio alone';
    reportWarning('ScreenContext', `The new area could not be captured; ${after}: ${describeCause(error)}`, { cause: error });
  }
}

/**
 * The modal's loop: a pick, its capture, its first frame — or the picker again, told why. Preparing from the pick's answer
 * until its first frame settles, so the modal shows the check (and never while the picker is asked).
 */
async function prepareDesktop(deps: ScreenContextDeps): Promise<void> {
  let reason: PickReason | undefined;
  for (;;) {
    const picked = await deps.pick(reason);
    if (!picked) return;
    const kept = await preparing(async () => {
      const capture = await openPicked(picked, deps);
      return capture ? hold(capture, deps.clock) : null;
    });
    // Kept, or nothing to keep (the portal's own Cancel, a listing that failed).
    if (kept !== false) return;
    reason = 'nothingVisible';
  }
}

/** The meeting tab, its stream opened for this run alone: a stream kept from an earlier run carries an audio track its recorder stopped. */
async function prepareTab(shape: Pick<RunShape, 'legs'>, deps: ScreenContextDeps): Promise<void> {
  const tabId = targetTabIdFromSearch(window.location.search);
  if (tabId === null) {
    reportWarning('ScreenContext', 'No meeting tab is targeted; the session starts without screen context.');
    return;
  }
  const kept = await preparing(async () => {
    const capture = await deps.openTab(tabId, chromeTabCaptureDeps(tabId, shape.legs.includes('participant'), deps.clock));
    return hold(capture, deps.clock);
  });
  if (!kept) {
    reportWarning('ScreenContext', 'The meeting tab showed nothing to send; the session starts without screen context.');
  }
}

/** `useScreenContextStore`'s `preparing` for as long as `work` runs, a throw included. */
async function preparing<T>(work: () => Promise<T>): Promise<T> {
  useScreenContextStore.getState().setPreparing(true);
  try {
    return await work();
  } finally {
    useScreenContextStore.getState().setPreparing(false);
  }
}

/** The picked source opened; null when there is nothing to open (the portal's own Cancel, or a listing that failed). */
async function openPicked(picked: PickedSource, deps: Pick<ScreenContextDeps, 'invoke' | 'openDesktop'>): Promise<OpenCapture | null> {
  if (picked.kind === 'desktop') return deps.openDesktop(picked.source);
  // The portal's dialog opens with the listing, and returns the one source the user chose there.
  const listed = await listCaptureSources(deps.invoke);
  if (!listed.ok) {
    reportWarning('ScreenContext', `The desktop offered no source (${listed.error}); the session starts without screen context.`);
    return null;
  }
  const [chosen] = listed.sources;
  return chosen ? deps.openDesktop(chosen) : null;
}

/**
 * Attaches the capture to a fresh sampler and waits for its first good frame. With one, the sampler goes into the
 * store, its state mirrored there, and true; without, the sampler and the capture are closed, and false.
 */
async function hold(capture: OpenCapture, clock: Clock): Promise<boolean> {
  const sampler = createSampler(clock);
  sampler.attach(capture);
  const frame = await sampler.first();
  if (!frame) {
    sampler.close();
    closeQuietly(capture);
    return false;
  }
  // One capture held at a time: whatever an earlier start left goes first.
  releaseScreenContext();
  held = { sampler, capture };
  sampler.onState((state) => useScreenContextStore.getState().setState(state));
  useScreenContextStore.getState().set(sampler);
  useScreenContextStore.getState().setState(sampler.state());
  return true;
}

function closeQuietly(capture: OpenCapture): void {
  try {
    capture.close();
  } catch (error) {
    reportWarning('ScreenContext', `Closing the screen capture failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'screen-context:close' });
  }
}

/** The part of `chrome` the tab's capture asks (the repo's own `chrome` typing lacks `tabs.get` and `tabs.sendMessage`). */
interface ChromeTabsLike {
  runtime?: { lastError?: unknown };
  tabs?: {
    get(tabId: number, callback: (tab?: { title?: unknown }) => void): void;
    sendMessage(tabId: number, message: unknown, callback: (answer: unknown) => void): void;
  };
}

const chromeApi = (): ChromeTabsLike | undefined => (globalThis as unknown as { chrome?: ChromeTabsLike }).chrome;

/** The extension's deps for `openTabCapture`: the tab's shared stream, the content script's box, its title. */
function chromeTabCaptureDeps(tabId: number, audio: boolean, clock: Clock): TabCaptureDeps {
  return {
    openStream: () => openTabStream(tabId, { audio, video: true }, chromeTabStreamDeps()),
    askBox: () => askBox(tabId, clock),
    capture: canvasCapture,
    tabTitle: () => tabTitle(tabId),
    clock,
  };
}

/** The content script's box; null on an error, an answer that is not an object, or none within `BOX_TIMEOUT_MS`. Always settles. */
function askBox(tabId: number, clock: Clock): Promise<BoxAnswer | null> {
  return new Promise((resolve) => {
    let settled = false;
    let cancel = () => {};
    const settle = (answer: BoxAnswer | null) => {
      if (settled) return;
      settled = true;
      cancel();
      resolve(answer);
    };
    cancel = clock.setTimeout(() => settle(null), BOX_TIMEOUT_MS);
    const api = chromeApi();
    try {
      if (!api?.tabs) {
        settle(null);
        return;
      }
      api.tabs.sendMessage(tabId, { type: 'SCREEN_CONTEXT_BBOX' }, (answer) => {
        // Read on every answer: reading it is what keeps Chrome from logging it as unchecked.
        if (api.runtime?.lastError) settle(null);
        else settle(answer !== null && typeof answer === 'object' ? (answer as BoxAnswer) : null);
      });
    } catch {
      settle(null);
    }
  });
}

/** The tab's title, or `TAB_NAME_FALLBACK`. */
function tabTitle(tabId: number): Promise<string> {
  return new Promise((resolve) => {
    const api = chromeApi();
    try {
      if (!api?.tabs) {
        resolve(TAB_NAME_FALLBACK);
        return;
      }
      api.tabs.get(tabId, (tab) => {
        const title = api.runtime?.lastError ? undefined : tab?.title;
        resolve(typeof title === 'string' && title.trim() !== '' ? title : TAB_NAME_FALLBACK);
      });
    } catch {
      resolve(TAB_NAME_FALLBACK);
    }
  });
}
