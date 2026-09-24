/**
 * What every source shares (spec: "Sources, in full"), so the microphone, the
 * system audio and the tab only drive their recorders: listeners, mute, one
 * end, a watched track, one release.
 */
import { describeCause, reportError } from '../../diagnostics/report';
import type { Source, SourceNotice } from '../../session/source';

export const TRACK_ENDED = 'The capture device went away (unplugged, closed or stopped).';

export interface SourceCore extends Source {
  /** Hands a chunk to the listeners, unless muted, ended or stopped. */
  deliver(pcm: Int16Array): void;
  /** Ends the source when the stream's audio track ends; returns the unwatch. */
  watch(stream: MediaStream | null): () => void;
  /** Ends the source with a reason, once; nothing after a stop. */
  end(reason: string): void;
  degrade(notice: SourceNotice): void;
  readonly stopped: boolean;
  readonly ended: boolean;
}

export interface SourceCoreOptions {
  /** Read on every chunk: mute takes effect at once. */
  muted(): boolean;
  track(): MediaStreamTrack | undefined;
  /** Stops the recorders; called once, by the first `stop()`. */
  release(): Promise<void>;
}

export function createSourceCore(options: SourceCoreOptions): SourceCore {
  const pcmListeners = new Set<(pcm: Int16Array) => void>();
  const endedListeners = new Set<(reason: string) => void>();
  const degradedListeners = new Set<(notice: SourceNotice) => void>();
  /** Degradations raised before anyone listened: the first listener gets them. */
  const held: SourceNotice[] = [];
  let ended = false;
  let stopping: Promise<void> | null = null;
  const failing = new Set<(pcm: Int16Array) => void>();

  const listen = <T>(set: Set<T>, listener: T) => {
    set.add(listener);
    return () => { set.delete(listener); };
  };

  const end = (reason: string) => {
    if (ended || stopping) return;
    ended = true;
    for (const listener of [...endedListeners]) listener(reason);
  };

  return {
    onPcm: (listener) => {
      const off = listen(pcmListeners, listener);
      return () => {
        off();
        failing.delete(listener);
      };
    },
    onEnded: (listener) => listen(endedListeners, listener),
    onDegraded: (listener) => {
      const off = listen(degradedListeners, listener);
      if (!ended && !stopping) {
        for (const notice of held.splice(0)) listener(notice);
      }
      return off;
    },
    get track() {
      return options.track();
    },

    deliver(pcm) {
      if (ended || stopping || options.muted()) return;
      for (const listener of [...pcmListeners]) {
        try {
          listener(pcm);
          failing.delete(listener);
        } catch (error) {
          // Per chunk: report when a listener starts failing, not on every chunk after.
          if (!failing.has(listener)) reportError('SourceCore', `A capture listener threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'source:listener' });
          failing.add(listener);
        }
      }
    },

    watch(stream) {
      const track = stream?.getAudioTracks()[0];
      if (!track) return () => {};
      const onEnded = () => end(TRACK_ENDED);
      track.addEventListener('ended', onEnded);
      return () => track.removeEventListener('ended', onEnded);
    },

    end,

    degrade(notice) {
      if (ended || stopping) return;
      if (degradedListeners.size === 0) {
        held.push(notice);
        return;
      }
      for (const listener of [...degradedListeners]) listener(notice);
    },

    stop() {
      stopping ??= options.release();
      return stopping;
    },

    get stopped() {
      return stopping !== null;
    },

    get ended() {
      return ended;
    },
  };
}
