/**
 * The extension overlay's wire (spec: "The two subtitle surfaces are not the
 * same thing"): the side panel sends what the overlay draws — the tail of the
 * merged `Entry[]`, the subtitle session, karaoke — and the overlay sends back
 * its controls. `Entry[]` holds rows, never pcm, so there is nothing heavy to
 * strip. The tail is cut after the legs are merged, never per leg (spec:
 * "Invariants"). The transport is a `WirePort`: a `chrome.runtime` port in the
 * extension, a `MessagePort` in the development preview.
 */
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

/** Side panel → overlay. */
export type ToOverlay =
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
}

export interface PanelControls {
  clear(): void;
  exit(): void;
  press(): void;
  release(): void;
}

/**
 * The side panel's end: sends everything once when the overlay connects, then
 * each change, and acts on the overlay's controls. Stops when the overlay
 * disconnects, or — reporting it once — when posting throws. Returns the stop.
 */
export function publishSubtitles(port: WirePort, sources: PanelSources, controls: PanelControls): () => void {
  let stopped = false;
  const offs: Array<() => void> = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
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
  const sendEntries = () => {
    const next = sources.entries.get();
    if (next === entries) return;
    entries = next;
    post({ type: 'subtitle:entries', entries: next.slice(-OVERLAY_ENTRIES) });
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
    sources.entries.subscribe(sendEntries),
    sources.session.subscribe(sendSession),
    sources.karaoke.subscribe(sendKaraoke),
    port.onMessage((message) => {
      switch (typeOf(message)) {
        case 'subtitle:request-clear': return controls.clear();
        case 'subtitle:user-exit': return controls.exit();
        case 'subtitle:turn-press': return controls.press();
        case 'subtitle:turn-release': return controls.release();
        default: return undefined;
      }
    }),
    port.onDisconnect(stop),
  );
  sendEntries();
  sendSession();
  sendKaraoke();
  return stop;
}

/** What the overlay draws, as it last heard it. */
export interface OverlayModel {
  entries: readonly Entry[];
  /** Null until the side panel has sent one. */
  session: SubtitleSession | null;
  lit: ReadonlyMap<SegmentId, number>;
}

const NOTHING: OverlayModel = { entries: [], session: null, lit: new Map() };

/** The overlay's end: the last model the side panel sent, and a way to send it controls. */
export function receiveSubtitles(port: WirePort): Readable<OverlayModel> & { send(message: ToPanel): void; dispose(): void } {
  let model = NOTHING;
  const listeners = new Set<() => void>();
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
      case 'subtitle:entries':
        if (Array.isArray((m as { entries?: unknown }).entries)) set({ ...model, entries: (m as Extract<ToOverlay, { type: 'subtitle:entries' }>).entries });
        return;
      case 'subtitle:session':
        set({ ...model, session: (m as Extract<ToOverlay, { type: 'subtitle:session' }>).session });
        return;
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
      } catch (error) {
        reportError('SubtitleWire', `The side panel's port did not take a control: ${describeCause(error)}`, { cause: error, dedupeKey: 'subtitle-wire-send' });
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

/** A `chrome.runtime` port as a wire: the extension's side panel and overlay (plan 1e wires them). */
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
