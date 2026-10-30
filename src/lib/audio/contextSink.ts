/**
 * An outlet's way out: the stream its bus ends in, played through an
 * AudioContext of its own on the outlet's device. The browser's echo canceller
 * takes an AudioContext's output as its reference, and not an `<audio>`
 * element's. It is a `SinkElement`, so the graph drives it as it would an
 * element.
 */
import { realClock, type Clock } from '../contract/clock';
import { describeCause, reportWarning } from '../diagnostics/report';
import { MAX_REBUILDS, RESUME_DEADLINE_MS, WEDGE_GRACE_MS, type SinkElement } from './graph';

/**
 * How long a device may take to answer a switch. Past the graph's own switch
 * deadline, because a Bluetooth output can be slow and a slow one is not a dead
 * one; a switch that never answers would otherwise hold recovery off for good.
 */
export const SWITCH_GIVE_UP_MS = 5_000;

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
  /** Each switch and rebuild takes a turn; only the latest may land. */
  let turn = 0;
  /** The turn of a switch in flight, or 0. A rebuild gives way to it. */
  let switching = 0;
  /** `pause()` was asked: this 'suspended' is ours, not a wedge. */
  let resting = false;
  /** Rebuilds since a context last ran. */
  let rebuilds = 0;
  /** The cap was reached and said so, once. */
  let gaveUp = false;
  let cancelGrace: (() => void) | null = null;
  let cancelDeadline: (() => void) | null = null;

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

  const clearWatch = () => {
    cancelGrace?.();
    cancelDeadline?.();
    cancelGrace = cancelDeadline = null;
  };

  /** The graph's watch sees only its own context (#246), so each sink keeps one of the same shape. */
  const armDeadline = () => {
    if (cancelDeadline) return;
    cancelDeadline = clock.setTimeout(() => {
      cancelDeadline = null;
      if (context.state !== 'running' && !resting) void rebuild();
    }, RESUME_DEADLINE_MS);
  };

  const onState = () => {
    if (context.state === 'running') {
      ran = true;
      clearWatch();
      rebuilds = 0;
      gaveUp = false;
      return;
    }
    if (context.state !== 'suspended' || !ran || resting || cancelGrace || cancelDeadline) return;
    cancelGrace = clock.setTimeout(() => {
      cancelGrace = null;
      if (context.state !== 'suspended' || resting) return;
      context.resume().catch((error: unknown) => {
        reportWarning('ContextSink', `The ${deps.label} output did not resume: ${describeCause(error)}`, { dedupeKey: `sink:${deps.label}:resume` });
      });
      armDeadline();
    }, WEDGE_GRACE_MS);
  };

  /** The stream moves first, so the old context, if it is wedged, holds nothing up. */
  const adopt = (next: AudioContext, id: string) => {
    if (pending === next) pending = null;
    const old = context;
    clearWatch();
    old.removeEventListener('statechange', onState);
    source?.disconnect();
    context = next;
    device = id;
    next.addEventListener('statechange', onState);
    source = current ? connect(next, current) : null;
    abandon(old);
    // It may have started before the listener, so no event will say so.
    if (next.state === 'running') onState();
  };

  /**
   * A new context on the same device. A device that is gone stays lost until
   * `deviceWatch` resolves another and the graph calls `setSinkId`.
   */
  const rebuild = async () => {
    if (current === null) return;
    // A switch in flight wins: it replaces this context anyway, and the graph counts on it landing.
    if (switching) {
      armDeadline();
      return;
    }
    if (rebuilds >= MAX_REBUILDS) {
      if (!gaveUp) reportWarning('ContextSink', `The ${deps.label} output stopped responding and could not be recovered`, { dedupeKey: `sink:${deps.label}:gave-up` });
      gaveUp = true;
      return;
    }
    rebuilds += 1;
    turn += 1;
    const mine = turn;
    const key = `sink:${deps.label}:rebuild`;
    reportWarning('ContextSink', `The ${deps.label} output stopped responding and was rebuilt (attempt ${rebuilds} of ${MAX_REBUILDS})`, { dedupeKey: key });
    // A device that does not answer counts as a failed attempt: the next one abandons this.
    armDeadline();
    let next: AudioContext;
    try {
      next = await openOn(device);
    } catch (error) {
      reportWarning('ContextSink', `The ${deps.label} output could not be rebuilt: ${describeCause(error)}`, { dedupeKey: `sink:${deps.label}:rebuild-failed` });
      armDeadline();
      return;
    }
    if (mine !== turn || current === null) {
      abandon(next);
      return;
    }
    adopt(next, device);
    void next.resume().catch(() => {});
    armDeadline();
  };

  context.addEventListener('statechange', onState);

  const answersInTime = async (opening: Promise<AudioContext>): Promise<AudioContext> => {
    let cancel = () => {};
    const late = new Promise<never>((_resolve, reject) => {
      cancel = clock.setTimeout(() => reject(new Error('the device did not answer')), SWITCH_GIVE_UP_MS);
    });
    try {
      return await Promise.race([opening, late]);
    } finally {
      cancel();
    }
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
      clearWatch();
      context.removeEventListener('statechange', onState);
      abandon(context);
      if (pending) abandon(pending);
      pending = null;
    },

    get paused() {
      return context.state !== 'running';
    },

    /**
     * A new context rather than `setSinkId` on the running one: a wedged context
     * can report success (#246). It resolves only if the sink moved: the graph
     * records a resolved switch as landed. A switch a newer one overtook rejects,
     * and `switchBus` knows it is stale and lets that go.
     */
    async setSinkId(id: string) {
      turn += 1;
      const mine = turn;
      switching = mine;
      const stale = () => mine !== turn || current === null;
      const overtaken = (ctx: AudioContext) => {
        abandon(ctx);
        return new Error('a newer switch overtook this one');
      };
      try {
        const next = await answersInTime(openOn(id)).catch((error: unknown) => {
          if (!stale() && pending) {
            abandon(pending);
            pending = null;
          }
          throw error;
        });
        if (stale()) throw overtaken(next);
        if (ran) {
          const started = await startsInTime(next);
          if (stale()) throw overtaken(next);
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
      } finally {
        if (switching === mine) switching = 0;
      }
    },

    /** Asked again on a later play() when refused: a context waits for the first user gesture. */
    async play() {
      if (current === null) return;
      resting = false;
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
      resting = true;
      clearWatch();
      void context.suspend().catch(() => {});
    },
  };
}
