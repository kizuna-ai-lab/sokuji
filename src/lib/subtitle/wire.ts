/**
 * The extension overlay's wire (spec: "The two subtitle surfaces are not the
 * same thing"): the side panel sends what the overlay draws — the tail of the
 * merged `Entry[]`, the subtitle session, karaoke — and the overlay sends back
 * its controls. `Entry[]` holds rows, never pcm, so there is nothing heavy to
 * strip. The tail is cut after the legs are merged, never per leg (spec:
 * "Invariants"). The transport is a `WirePort`: a `chrome.runtime` port in the
 * extension, a `MessagePort` in the development preview.
 */
import { realClock, type Clock } from '../contract/clock';
import type { SegmentId } from '../conversation/types';
import { describeCause, reportError } from '../diagnostics/report';
import type { Entry } from '../projection/types';
import type { Readable } from '../view/conversationView';
import type { KaraokeState } from '../view/karaoke';
import type { SubtitleSession } from './session';

export interface WirePort {
  post(message: unknown): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  close(): void;
}

/** The `chrome.runtime` port's name, on both ends: the overlay connects with it, the side panel accepts only it (plan 1e-4). */
export const SUBTITLE_PORT = 'sokuji-subtitle';

/** Side panel → overlay. */
export type ToOverlay =
  | { type: 'subtitle:language'; language: string }
  | { type: 'subtitle:entries'; entries: readonly Entry[] }
  | { type: 'subtitle:session'; session: SubtitleSession }
  | { type: 'subtitle:karaoke'; lit: ReadonlyArray<readonly [SegmentId, number]> };

/** Overlay → side panel. */
export type ToPanel =
  | { type: 'subtitle:request-clear' }
  | { type: 'subtitle:user-exit' }
  | { type: 'subtitle:turn-press' }
  | { type: 'subtitle:turn-release' };

/** How many entries the overlay gets: the tail of the merged conversation. */
export const OVERLAY_ENTRIES = 30;

/**
 * When the merged tail (`OVERLAY_ENTRIES`) drops a leg entirely — one side
 * goes quiet while the other keeps talking — this many of that leg's newest
 * entries are kept alongside it, so its bands never empty on the overlay.
 */
export const OVERLAY_QUIET_LEG_ENTRIES = 5;

/**
 * How long entries changes coalesce (trailing): the first change after a
 * send posts immediately; a burst of changes inside this window collapses to
 * one post, carrying the entries as they are when it fires. Session and
 * karaoke stay immediate — they are small, unlike a 30-entry tail.
 */
export const ENTRIES_INTERVAL_MS = 100;

const TO_PANEL = new Set<string>(['subtitle:request-clear', 'subtitle:user-exit', 'subtitle:turn-press', 'subtitle:turn-release']);

function typeOf(message: unknown): string | undefined {
  return typeof message === 'object' && message !== null && typeof (message as { type?: unknown }).type === 'string'
    ? (message as { type: string }).type
    : undefined;
}

export interface PanelSources {
  entries: Readable<readonly Entry[]>;
  session: Readable<SubtitleSession>;
  karaoke: Readable<KaraokeState>;
  /**
   * The side panel's interface language (plan 1e-4 ruling 5): the overlay's
   * own detection reads storage that sits inside the meeting page, which is
   * untested. Absent: nothing is sent, and the overlay keeps its own.
   */
  language?: Readable<string>;
}

export interface PanelControls {
  clear(): void;
  exit(): void;
  press(): void;
  release(): void;
}

/**
 * What the overlay gets for one send: the newest `OVERLAY_ENTRIES` of the
 * merged conversation, sliced after the legs are merged (never per leg —
 * spec: "Invariants"), plus — for any leg the merged tail drops entirely —
 * that leg's newest `OVERLAY_QUIET_LEG_ENTRIES`, so a quiet leg's bands never
 * empty on the overlay just because the other leg has been busy. Sent in the
 * conversation's own order.
 */
function overlayTail(entries: readonly Entry[]): readonly Entry[] {
  const tail = entries.slice(-OVERLAY_ENTRIES);
  const legs = new Set(entries.map((entry) => entry.leg));
  const included = new Set<Entry>(tail);
  for (const leg of legs) {
    if (tail.some((entry) => entry.leg === leg)) continue;
    for (const entry of entries.filter((e) => e.leg === leg).slice(-OVERLAY_QUIET_LEG_ENTRIES)) included.add(entry);
  }
  return included.size === tail.length ? tail : entries.filter((entry) => included.has(entry));
}

/**
 * The side panel's end: sends everything once when the overlay connects —
 * the side panel's language when it has one, then session, then entries,
 * then karaoke — then each further change. Entries
 * changes after the first coalesce trailing (`entriesIntervalMs`): the first
 * schedules one post after the interval, carrying the entries as they are
 * then; changes inside that window add nothing further. Session and karaoke
 * stay immediate. Acts on the overlay's controls, and — since a press left
 * outstanding when the overlay goes away would strand the turn (a lost
 * iframe never unmounts `HoldToTalk`) — releases one on its way down if a
 * press has not been released. Stops when the overlay disconnects, or —
 * reporting it once — when posting throws. Returns the stop.
 */
export function publishSubtitles(
  port: WirePort,
  sources: PanelSources,
  controls: PanelControls,
  clock: Clock = realClock,
  entriesIntervalMs: number = ENTRIES_INTERVAL_MS,
): () => void {
  let stopped = false;
  let pressed = false;
  let cancelPendingEntries: (() => void) | null = null;
  const offs: Array<() => void> = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (cancelPendingEntries) {
      cancelPendingEntries();
      cancelPendingEntries = null;
    }
    if (pressed) {
      pressed = false;
      controls.release();
    }
    offs.forEach((off) => off());
  };
  const post = (message: ToOverlay) => {
    if (stopped) return;
    try {
      port.post(message);
    } catch (error) {
      reportError('SubtitleWire', `The overlay's port did not take a message: ${describeCause(error)}`, { cause: error, dedupeKey: 'subtitle-wire-post' });
      stop();
    }
  };
  let entries: readonly Entry[] | null = null;
  let session: SubtitleSession | null = null;
  let karaoke: KaraokeState | null = null;
  let language: string | null = null;
  const sendLanguage = () => {
    if (!sources.language) return;
    const next = sources.language.get();
    if (next === language) return;
    language = next;
    post({ type: 'subtitle:language', language: next });
  };
  const flushEntries = () => {
    cancelPendingEntries = null;
    const latest = sources.entries.get();
    entries = latest;
    post({ type: 'subtitle:entries', entries: overlayTail(latest) });
  };
  const sendEntries = () => {
    const next = sources.entries.get();
    if (next === entries) return;
    if (entries === null) {
      entries = next;
      post({ type: 'subtitle:entries', entries: overlayTail(next) });
      return;
    }
    // A post is already scheduled: it reads `sources.entries.get()` fresh
    // when it fires, so this change needs nothing further.
    if (!cancelPendingEntries) cancelPendingEntries = clock.setTimeout(flushEntries, entriesIntervalMs);
  };
  const sendSession = () => {
    const next = sources.session.get();
    if (next === session) return;
    session = next;
    post({ type: 'subtitle:session', session: next });
  };
  const sendKaraoke = () => {
    const next = sources.karaoke.get();
    if (next === karaoke) return;
    karaoke = next;
    post({ type: 'subtitle:karaoke', lit: [...next.lit] });
  };
  // Subscribed before the first sends, so a port that throws on the first
  // message leaves nothing subscribed behind it.
  offs.push(
    sources.session.subscribe(sendSession),
    sources.entries.subscribe(sendEntries),
    sources.karaoke.subscribe(sendKaraoke),
    port.onMessage((message) => {
      switch (typeOf(message)) {
        case 'subtitle:request-clear': return controls.clear();
        case 'subtitle:user-exit': return controls.exit();
        case 'subtitle:turn-press': pressed = true; return controls.press();
        case 'subtitle:turn-release': pressed = false; return controls.release();
        default: return undefined;
      }
    }),
    port.onDisconnect(stop),
  );
  if (sources.language) offs.push(sources.language.subscribe(sendLanguage));
  // First sends go language → session → entries → karaoke: the overlay
  // picks its words before it draws, and a connect mid-run never draws one
  // frame of "Session ended" before the session lands.
  sendLanguage();
  sendSession();
  sendEntries();
  sendKaraoke();
  return stop;
}

/** What the overlay draws, as it last heard it. */
export interface OverlayModel {
  entries: readonly Entry[];
  /** Null until the side panel has sent one. */
  session: SubtitleSession | null;
  lit: ReadonlyMap<SegmentId, number>;
  /** The side panel's interface language; null until it has sent one. */
  language: string | null;
}

const NOTHING: OverlayModel = { entries: [], session: null, lit: new Map(), language: null };

/** The overlay's end: the model as last heard, and the way back. */
export type OverlayReceiver = Readable<OverlayModel> & { send(message: ToPanel): void; dispose(): void };

/** The overlay's end: the last model the side panel sent, and a way to send it controls. */
export function receiveSubtitles(port: WirePort): OverlayReceiver {
  let model = NOTHING;
  const listeners = new Set<() => void>();
  // A control the user presses/releases/clears/exits repeatedly is a
  // per-message path: report a broken port once per failing streak, not once
  // per press, and let a later failure report again once a post succeeds.
  let sendFailing = false;
  const set = (next: OverlayModel) => {
    model = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        reportError('SubtitleWire', `An overlay subscriber threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'subtitle-wire-subscriber' });
      }
    }
  };
  const off = port.onMessage((message) => {
    const m = message as ToOverlay;
    switch (typeOf(message)) {
      case 'subtitle:language': {
        const language = (m as { language?: unknown }).language;
        if (typeof language === 'string' && language !== '') set({ ...model, language });
        return;
      }
      case 'subtitle:entries':
        if (Array.isArray((m as { entries?: unknown }).entries)) set({ ...model, entries: (m as Extract<ToOverlay, { type: 'subtitle:entries' }>).entries });
        return;
      case 'subtitle:session': {
        const session = (m as { session?: unknown }).session;
        if (typeof session === 'object' && session !== null && typeof (session as { phase?: unknown }).phase === 'string') {
          set({ ...model, session: session as SubtitleSession });
        }
        return;
      }
      case 'subtitle:karaoke':
        if (Array.isArray((m as { lit?: unknown }).lit)) set({ ...model, lit: new Map((m as Extract<ToOverlay, { type: 'subtitle:karaoke' }>).lit) });
        return;
      default:
        return;
    }
  });
  return {
    get: () => model,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    send(message) {
      if (!TO_PANEL.has(message.type)) return;
      try {
        port.post(message);
        sendFailing = false;
      } catch (error) {
        if (!sendFailing) {
          reportError('SubtitleWire', `The side panel's port did not take a control: ${describeCause(error)}`, { cause: error, dedupeKey: 'subtitle-wire-send' });
        }
        sendFailing = true;
      }
    },
    dispose() {
      off();
      listeners.clear();
    },
  };
}

/** A `MessagePort` as a wire: the development preview's iframe. A `MessagePort` has no disconnect event. */
export function messagePortWire(port: MessagePort): WirePort {
  port.start();
  return {
    post: (message) => port.postMessage(message),
    onMessage(listener) {
      const handler = (event: MessageEvent) => listener(event.data);
      port.addEventListener('message', handler);
      return () => port.removeEventListener('message', handler);
    },
    onDisconnect: () => () => {},
    close: () => port.close(),
  };
}

/** The parts of a `chrome.runtime.Port` the wire uses, typed here so nothing imports `chrome`. */
export interface ChromePortLike {
  postMessage(message: unknown): void;
  onMessage: { addListener(listener: (message: unknown) => void): void; removeListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void; removeListener(listener: () => void): void };
  disconnect(): void;
}

/** A `chrome.runtime` port as a wire: the extension's side panel and overlay (plan 1e-4 wires them). */
export function chromePortWire(port: ChromePortLike): WirePort {
  return {
    post: (message) => port.postMessage(message),
    onMessage(listener) {
      const handler = (message: unknown) => listener(message);
      port.onMessage.addListener(handler);
      return () => port.onMessage.removeListener(handler);
    },
    onDisconnect(listener) {
      const handler = () => listener();
      port.onDisconnect.addListener(handler);
      return () => port.onDisconnect.removeListener(handler);
    },
    close: () => port.disconnect(),
  };
}
