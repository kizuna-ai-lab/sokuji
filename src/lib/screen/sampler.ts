/**
 * Turns a `Capture` (a grab and an encode the platform supplies over a canvas)
 * into the `FrameSource` the Qwen adapter subscribes to: one grab a second, a
 * frame sent only when the picture changed, a keep-alive when it has not for a
 * minute, nothing for a black or flat picture, and a loss and a return told to
 * every subscriber. Pure logic on an injected `Clock`: no DOM, no stores, no
 * logging.
 *
 * A subscriber that joins while a frame is in hand has it at once, reason
 * 'first', and is told of a loss that is still on, so a run that starts on a
 * lost source learns it. Callbacks run synchronously, and never reach a
 * subscriber that unsubscribed, even in the middle of a fan-out.
 */
import type { FrameReason, FrameSource } from '../contract/adapter';
import type { Clock } from '../contract/clock';
import { CHANGE_THRESHOLD, greyThumb, isBlank, meanAbsDiff } from './pixels';

export interface Picture {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Capture {
  name: string;
  kind: FrameSource['kind'];
  /** The current picture at its own size, or null when the source yields nothing (closed, minimized, ended). */
  grab(): Promise<Picture | null>;
  /** The picture fitted inside 1280×720 as a JPEG at `quality` (0..1). */
  encode(picture: Picture, quality: number): Promise<Uint8Array>;
}

export type SamplerStatus = 'idle' | 'live' | 'stale' | 'lost';

export interface SamplerState {
  status: SamplerStatus;
  name: string;
  kind: FrameSource['kind'];
  /** Frames emitted, keep-alives included. */
  sent: number;
  lastSentAt: number | null;
  lastReason: FrameReason | null;
  lastJpeg: Uint8Array | null;
}

export interface Sampler {
  /** What the adapters subscribe to; stable across attach/detach. */
  readonly source: FrameSource;
  attach(capture: Capture): void;
  /** The capture is gone by the owner's hand (Choose again in flight): status lost, the last good frame kept. */
  detach(): void;
  /** The first non-blank frame, or null once `FIRST_FRAME_MS` has passed without one. */
  first(): Promise<Uint8Array | null>;
  state(): SamplerState;
  onState(listener: (s: SamplerState) => void): () => void;
  /** Cancels every timer, drops every subscriber and listener, and settles a pending `first()` with null. */
  close(): void;
}

export const SAMPLE_MS = 1000;
export const KEEPALIVE_MS = 60_000;
export const FIRST_FRAME_MS = 3000;
export const MAX_BYTES = 500_000;
/** Tried in order until the JPEG fits `MAX_BYTES`. */
export const QUALITIES = [0.85, 0.7, 0.5] as const;

interface FirstWait {
  promise: Promise<Uint8Array | null>;
  settle: (jpeg: Uint8Array | null) => void;
}

interface Subscriber {
  onFrame: (jpeg: Uint8Array, reason: FrameReason) => void;
  onLost: () => void;
  onBack: () => void;
}

export function createSampler(clock: Clock): Sampler {
  const subscribers = new Set<Subscriber>();
  const listeners = new Set<(s: SamplerState) => void>();

  let capture: Capture | null = null;
  let name = '';
  let kind: FrameSource['kind'] = 'window';
  let closed = false;

  /** Bumped by attach, detach and close: a tick from an older beat finds it changed and walks away. */
  let generation = 0;
  let cancelTick: () => void = () => {};

  let lastJpeg: Uint8Array | null = null;
  /** The thumb of the frame last sent with fresh pixels: what the next grab is compared with. */
  let lastThumb: Uint8Array | null = null;
  let sent = 0;
  let lastSentAt: number | null = null;
  let lastReason: FrameReason | null = null;
  let lost = false;
  /** The next usable picture goes out whatever it looks like: a loss came before it, or a new capture was attached. */
  let sendNext = false;

  let firstJpeg: Uint8Array | null = null;
  let firstWait: FirstWait | null = null;

  const source: FrameSource = {
    get name() {
      return name;
    },
    get kind() {
      return kind;
    },
    subscribe(onFrame, onLost, onBack) {
      if (closed) return () => {};
      const subscriber: Subscriber = { onFrame, onLost, onBack };
      subscribers.add(subscriber);
      if (lastJpeg) onFrame(lastJpeg, 'first');
      if (lost && subscribers.has(subscriber)) onLost();
      return () => {
        subscribers.delete(subscriber);
      };
    },
  };

  /** A promise for the first frame, settled by it or, empty, by the `FIRST_FRAME_MS` timer. */
  function startFirstWait(): FirstWait {
    let resolve: (jpeg: Uint8Array | null) => void = () => {};
    const promise = new Promise<Uint8Array | null>((r) => {
      resolve = r;
    });
    const cancel = clock.setTimeout(() => wait.settle(null), FIRST_FRAME_MS);
    const wait: FirstWait = {
      promise,
      settle(jpeg) {
        cancel();
        if (firstWait === wait) firstWait = null;
        resolve(jpeg);
      },
    };
    return wait;
  }

  function status(): SamplerStatus {
    if (lost) return 'lost';
    if (lastReason === null) return 'idle';
    return lastReason === 'keepalive' ? 'stale' : 'live';
  }

  function state(): SamplerState {
    return { status: status(), name, kind, sent, lastSentAt, lastReason, lastJpeg };
  }

  function publish(): void {
    const snapshot = state();
    for (const listener of [...listeners]) if (listeners.has(listener)) listener(snapshot);
  }

  /** Calls each subscriber still attached when its turn comes. */
  function fanOut(call: (s: Subscriber) => void): void {
    for (const subscriber of [...subscribers]) if (subscribers.has(subscriber)) call(subscriber);
  }

  function record(jpeg: Uint8Array, reason: FrameReason): void {
    lastJpeg = jpeg;
    sent += 1;
    lastSentAt = clock.now();
    lastReason = reason;
    firstJpeg ??= jpeg;
    firstWait?.settle(firstJpeg);
  }

  /** New pixels. The first one after a loss is a return, told before the frame. */
  function sendFresh(jpeg: Uint8Array, thumb: Uint8Array, reason: FrameReason): void {
    const back = lost;
    lost = false;
    sendNext = false;
    lastThumb = thumb;
    record(jpeg, reason);
    publish();
    if (back) fanOut((s) => s.onBack());
    fanOut((s) => s.onFrame(jpeg, reason));
  }

  /** The frame last sent, again. A loss stays a loss. */
  function sendKeepalive(jpeg: Uint8Array): void {
    record(jpeg, 'keepalive');
    publish();
    fanOut((s) => s.onFrame(jpeg, 'keepalive'));
  }

  /** The source yields nothing: told once per loss. Only fresh frames stop; the keep-alive deadline is untouched. */
  function markLost(): void {
    if (lost) return;
    lost = true;
    sendNext = true;
    publish();
    fanOut((s) => s.onLost());
  }

  /** The first JPEG within `MAX_BYTES`, or null when even the last quality is over it or the encoder failed. */
  async function encodeWithinCap(cap: Capture, picture: Picture): Promise<Uint8Array | null> {
    for (const quality of QUALITIES) {
      let jpeg: Uint8Array;
      try {
        jpeg = await cap.encode(picture, quality);
      } catch {
        // The capture knows why its canvas failed and is where that is reported; here the frame is skipped.
        return null;
      }
      if (jpeg.byteLength <= MAX_BYTES) return jpeg;
    }
    return null;
  }

  /** The picture, or null when the capture yields nothing; a grab that throws is a source that yields nothing. */
  async function grabOrNull(cap: Capture): Promise<Picture | null> {
    try {
      return await cap.grab();
    } catch {
      return null;
    }
  }

  /** One grab, and what it means. No capture is a source that yields nothing, as after `detach`. */
  async function sample(gen: number, cap: Capture | null): Promise<void> {
    const picture = cap ? await grabOrNull(cap) : null;
    if (gen !== generation) return;
    if (!cap || !picture) {
      markLost();
      return;
    }
    const thumb = greyThumb(picture.rgba, picture.width, picture.height);
    if (isBlank(thumb)) return;
    let reason: FrameReason;
    if (lastThumb === null) reason = 'first';
    else if (sendNext || meanAbsDiff(thumb, lastThumb) > CHANGE_THRESHOLD) reason = 'changed';
    else return;
    const jpeg = await encodeWithinCap(cap, picture);
    if (gen !== generation || !jpeg) return;
    sendFresh(jpeg, thumb, reason);
  }

  /**
   * One beat: a grab, then the keep-alive when `KEEPALIVE_MS` have passed since the last send, whatever the state
   * (unchanged, blank, lost, detached): the gap between two frames never exceeds it, and a loss does not restart it.
   */
  async function tick(gen: number): Promise<void> {
    const startedAt = clock.now();
    try {
      await sample(gen, capture);
      if (gen === generation && lastJpeg && lastSentAt !== null && clock.now() - lastSentAt >= KEEPALIVE_MS) sendKeepalive(lastJpeg);
    } finally {
      // Armed once the grab is done, so a slow one never overlaps the next; a thrown error still leaves the beat running.
      if (gen === generation) arm(gen, Math.max(0, SAMPLE_MS - (clock.now() - startedAt)));
    }
  }

  function arm(gen: number, delay: number): void {
    cancelTick = clock.setTimeout(() => {
      cancelTick = () => {};
      void tick(gen);
    }, delay);
  }

  /** Starts a fresh beat from now: whatever the older one still has in flight is dropped. */
  function restart(): void {
    cancelTick();
    generation += 1;
    arm(generation, SAMPLE_MS);
  }

  return {
    source,

    attach(next) {
      if (closed) return;
      capture = next;
      name = next.name;
      kind = next.kind;
      sendNext = true;
      restart();
      publish();
    },

    detach() {
      if (closed || capture === null) return;
      capture = null;
      restart();
      markLost();
    },

    first() {
      if (firstJpeg) return Promise.resolve(firstJpeg);
      if (closed) return Promise.resolve(null);
      firstWait ??= startFirstWait();
      return firstWait.promise;
    },

    state,

    onState(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    close() {
      if (closed) return;
      closed = true;
      generation += 1;
      cancelTick();
      firstWait?.settle(null);
      subscribers.clear();
      listeners.clear();
    },
  };
}
