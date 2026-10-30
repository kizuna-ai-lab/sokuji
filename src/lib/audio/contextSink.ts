/**
 * An outlet's way out: the stream its bus ends in, played through an
 * AudioContext of its own on the outlet's device. The browser's echo canceller
 * takes an AudioContext's output as its reference, and not an `<audio>`
 * element's. It is a `SinkElement`, so the graph drives it as it would an
 * element.
 */
import { realClock, type Clock } from '../contract/clock';
import { RESUME_DEADLINE_MS, type SinkElement } from './graph';

export interface ContextSinkDeps {
  /** A new context at the app's rate, on the browser's default device. */
  createContext(): AudioContext;
  /** The outlet, for warnings and their dedupe keys. */
  label: string;
  /** Times the deadlines and the wedge watch; `realClock` by default. */
  clock?: Pick<Clock, 'setTimeout'>;
}

/** `AudioContext.setSinkId`, Chromium 110, which TypeScript's DOM types do not have yet. */
type RoutableContext = AudioContext & { setSinkId(id: string): Promise<void> };

export function createContextSink(stream: MediaStream, deps: ContextSinkDeps): SinkElement {
  const clock = deps.clock ?? realClock;
  let current: MediaStream | null = stream;
  let context = deps.createContext();
  let source: MediaStreamAudioSourceNode | null = null;
  /** The device `context` is on; `''` is the browser's default. */
  let device = '';
  /** A context of this sink has run: the user has made a gesture, so a start no longer waits for one. */
  let ran = context.state === 'running';
  /** A context not yet adopted. A newer one replaces it, so a device that hangs holds nothing. */
  let pending: AudioContext | null = null;
  /** Each switch takes a turn; only the latest may land. */
  let turn = 0;

  const connect = (ctx: AudioContext, from: MediaStream) => {
    const node = ctx.createMediaStreamSource(from);
    node.connect(ctx.destination);
    return node;
  };
  source = connect(context, stream);

  /** A wedged context may never settle its close() (#246): it is abandoned, never awaited. */
  const abandon = (ctx: AudioContext) => { void ctx.close().catch(() => {}); };

  const openOn = async (id: string): Promise<AudioContext> => {
    if (pending) abandon(pending);
    const next = deps.createContext();
    pending = next;
    try {
      // The default device needs no asking: a new context is on it already.
      if (id) await (next as RoutableContext).setSinkId(id);
    } catch (error) {
      if (pending === next) pending = null;
      abandon(next);
      throw error;
    }
    return next;
  };

  /** The stream moves first, so the old context, if it is wedged, holds nothing up. */
  const adopt = (next: AudioContext, id: string) => {
    if (pending === next) pending = null;
    const old = context;
    source?.disconnect();
    context = next;
    device = id;
    source = current ? connect(next, current) : null;
    abandon(old);
  };

  /** Whether `ctx` runs before the deadline. */
  const startsInTime = async (ctx: AudioContext): Promise<boolean> => {
    let cancel = () => {};
    const deadline = new Promise<boolean>((resolve) => { cancel = clock.setTimeout(() => resolve(false), RESUME_DEADLINE_MS); });
    try {
      return await Promise.race([ctx.resume().then(() => true, () => false), deadline]);
    } finally {
      cancel();
    }
  };

  return {
    get srcObject() {
      return current;
    },

    set srcObject(next: MediaProvider | null) {
      if (current === null) return;
      source?.disconnect();
      source = null;
      current = next as MediaStream | null;
      if (current) {
        source = connect(context, current);
        return;
      }
      abandon(context);
      if (pending) abandon(pending);
      pending = null;
    },

    get paused() {
      return context.state !== 'running';
    },

    /**
     * A new context rather than `setSinkId` on the running one: a wedged context
     * can report success (#246). Rejects only when the sink stayed where it was,
     * which is what `switchBus` expects of an element; a switch a newer one
     * overtook resolves.
     */
    async setSinkId(id: string) {
      turn += 1;
      const mine = turn;
      const stale = () => mine !== turn || current === null;
      let next: AudioContext;
      try {
        next = await openOn(id);
      } catch (error) {
        if (stale()) return;
        throw error;
      }
      if (stale()) {
        abandon(next);
        return;
      }
      if (ran) {
        const started = await startsInTime(next);
        if (stale()) {
          abandon(next);
          return;
        }
        if (!started) {
          pending = null;
          abandon(next);
          throw new Error('the output would not start');
        }
      } else {
        // Before the first gesture a start cannot land yet: `play()` asks again.
        void next.resume().catch(() => {});
      }
      adopt(next, id);
    },

    /** Asked again on a later play() when refused: a context waits for the first user gesture. */
    async play() {
      if (current === null) return;
      let cancel = () => {};
      const deadline = new Promise<void>((resolve) => { cancel = clock.setTimeout(resolve, RESUME_DEADLINE_MS); });
      try {
        await Promise.race([context.resume(), deadline]);
        if (context.state === 'running') ran = true;
      } finally {
        cancel();
      }
    },

    pause() {
      void context.suspend().catch(() => {});
    },
  };
}
