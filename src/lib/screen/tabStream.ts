/**
 * The extension's one capture of a meeting tab, shared by whoever needs a track
 * of it. Chrome allows one capture per tab, and a stream id from
 * `tabCapture.getMediaStreamId` is consumed by exactly one `getUserMedia`, so
 * the tab's audio (the participant source) and its video (the screen context)
 * must come from the same call. This module is that call: the first opener asks
 * the background for the id and captures the tracks it wants, a later opener of
 * the same tab takes the same stream, and the last release stops the tracks and
 * tells the background.
 *
 * Nothing here reports a failure: a refusal comes back to the opener, which owns
 * what the user is told.
 */
/* global chrome */

export interface TabStreamDeps {
  /** `chrome.runtime.sendMessage` to the background, as `TabAudioRecorder.sendMessageToBackground` did. */
  background(message: { type: 'START_TAB_CAPTURE' | 'STOP_TAB_CAPTURE'; tabId: number }): Promise<{ success: boolean; streamId?: string; error?: string }>;
  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream>;
}

export interface TabStream {
  stream: MediaStream;
  /** Lets go of this opener's share, once; the last one stops the tracks and tells the background. */
  release(): Promise<void>;
}

type Wants = { audio: boolean; video: boolean };

interface Capture {
  /** What the first opener asked for: the tracks the stream carries. */
  wants: Wants;
  stream: Promise<MediaStream>;
  /** Openers holding the capture, those still waiting for it included. */
  refs: number;
}

/** The open captures by tab. An entry is removed on the release that empties it, or when its capture fails. */
const captures = new Map<number, Capture>();

/** The tab's stream by its id: `mandatory` is Chromium's legacy constraint form, the one tab capture takes; lib.dom does not type it. */
export const tabConstraints = (streamId: string, wants: Wants): MediaStreamConstraints => ({
  audio: wants.audio ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } : false,
  video: wants.video ? { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxFrameRate: 2 } } : false,
} as MediaStreamConstraints);

async function capture(tabId: number, wants: Wants, deps: TabStreamDeps): Promise<MediaStream> {
  const response = await deps.background({ type: 'START_TAB_CAPTURE', tabId });
  if (!response.success) throw new Error(response.error || 'Failed to start tab capture');
  if (!response.streamId) throw new Error('The background gave no stream id for the tab');
  try {
    return await deps.getUserMedia(tabConstraints(response.streamId, wants));
  } catch (error) {
    // The background keeps the id it handed out and would hand the same, spent, one to the next start.
    // Its answer to this is not the failure to report: the caller gets getUserMedia's.
    await deps.background({ type: 'STOP_TAB_CAPTURE', tabId }).catch(() => {});
    throw error;
  }
}

/** The tab's capture, started now and registered so the next opener joins it. */
function start(tabId: number, wants: Wants, deps: TabStreamDeps): Capture {
  const fresh: Capture = { wants: { ...wants }, stream: capture(tabId, wants, deps), refs: 0 };
  captures.set(tabId, fresh);
  // A capture that failed is nobody's: the next open starts again. The rejection itself reaches every opener awaiting it.
  fresh.stream.catch(() => {
    if (captures.get(tabId) === fresh) captures.delete(tabId);
  });
  return fresh;
}

/**
 * One capture per tab: the first opener's `wants` decide the tracks; a later opener for the same tab shares the
 * stream (and must not want a track it lacks — that rejects), and the last release stops the tracks and tells the
 * background. A stream id from `getMediaStreamId` is consumed once, so a second capture of a tab is never attempted.
 */
export async function openTabStream(tabId: number, wants: { audio: boolean; video: boolean }, deps: TabStreamDeps): Promise<TabStream> {
  const existing = captures.get(tabId);
  if (existing) {
    const lacking = (['audio', 'video'] as const).find((kind) => wants[kind] && !existing.wants[kind]);
    if (lacking) throw new Error(`The capture of tab ${tabId} is open without ${lacking}, which was asked for`);
  }

  const holder = existing ?? start(tabId, wants, deps);
  holder.refs += 1;
  let stream: MediaStream;
  try {
    stream = await holder.stream;
  } catch (error) {
    holder.refs -= 1;
    throw error;
  }

  let released = false;
  return {
    stream,
    async release() {
      if (released) return;
      released = true;
      holder.refs -= 1;
      if (holder.refs > 0) return;
      if (captures.get(tabId) === holder) captures.delete(tabId);
      for (const track of stream.getTracks()) track.stop();
      await deps.background({ type: 'STOP_TAB_CAPTURE', tabId });
    },
  };
}

/** The real deps: `chrome.runtime.sendMessage` (resolving `{ success: false, error }` on `lastError`, as TabAudioRecorder did) and `navigator.mediaDevices.getUserMedia`. */
export function chromeTabStreamDeps(): TabStreamDeps {
  return {
    background: (message) =>
      new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.runtime) {
          resolve({ success: false, error: 'Chrome runtime not available' });
          return;
        }
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message });
          else resolve(response || { success: false, error: 'No response' });
        });
      }),
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  };
}
