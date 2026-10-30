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

export function createContextSink(stream: MediaStream, deps: ContextSinkDeps): SinkElement {
  const clock = deps.clock ?? realClock;
  let current: MediaStream | null = stream;
  let context = deps.createContext();
  let source: MediaStreamAudioSourceNode | null = null;

  const connect = (ctx: AudioContext, from: MediaStream) => {
    const node = ctx.createMediaStreamSource(from);
    node.connect(ctx.destination);
    return node;
  };
  source = connect(context, stream);

  /** A wedged context may never settle its close() (#246): it is abandoned, never awaited. */
  const abandon = (ctx: AudioContext) => { void ctx.close().catch(() => {}); };

  return {
    get srcObject() {
      return current;
    },

    set srcObject(next: MediaProvider | null) {
      if (current === null) return;
      source?.disconnect();
      source = null;
      current = next as MediaStream | null;
      if (current) source = connect(context, current);
      else abandon(context);
    },

    get paused() {
      return context.state !== 'running';
    },

    async setSinkId() {},

    /** Asked again on a later play() when refused: a context waits for the first user gesture. */
    async play() {
      if (current === null) return;
      let cancel = () => {};
      const deadline = new Promise<void>((resolve) => { cancel = clock.setTimeout(resolve, RESUME_DEADLINE_MS); });
      try {
        await Promise.race([context.resume(), deadline]);
      } finally {
        cancel();
      }
    },

    pause() {
      void context.suspend().catch(() => {});
    },
  };
}
