import { SAMPLE_RATE } from '../../lib/contract/adapter';
import type { Clock } from '../../lib/contract/clock';
import type { Source } from '../../lib/session/source';
import { synthPcm } from './synth';

export interface FakeSource extends Source {
  /** Makes the next chunks a tone (voice) or silence. */
  setVoiced(voiced: boolean): void;
  /** Ends the capture, as an unplugged device would. */
  end(reason: string): void;
  /** Reports the capture as degraded. */
  degrade(message: string): void;
  readonly stopped: boolean;
}

/**
 * A capture that delivers a chunk every `chunkMs` on the clock — a tone while
 * voiced, silence otherwise — with its end and degradation injectable (spec:
 * "Testing", fake sources).
 */
export function createFakeSource(clock: Clock, options: { chunkMs?: number; voiced?: boolean } = {}): FakeSource {
  const chunkMs = options.chunkMs ?? 100;
  let voiced = options.voiced ?? false;
  let stopped = false;
  const pcmListeners = new Set<(pcm: Int16Array) => void>();
  const endedListeners = new Set<(reason: string) => void>();
  const degradedListeners = new Set<(message: string) => void>();
  const listen = <T>(set: Set<T>, listener: T) => {
    set.add(listener);
    return () => { set.delete(listener); };
  };
  const tick = () => {
    if (stopped) return;
    const pcm = voiced ? synthPcm(chunkMs) : new Int16Array((SAMPLE_RATE * chunkMs) / 1000);
    for (const listener of pcmListeners) listener(pcm);
    cancel = clock.setTimeout(tick, chunkMs);
  };
  let cancel = clock.setTimeout(tick, chunkMs);

  return {
    onPcm: (listener) => listen(pcmListeners, listener),
    onEnded: (listener) => listen(endedListeners, listener),
    onDegraded: (listener) => listen(degradedListeners, listener),
    async stop() {
      stopped = true;
      cancel();
    },
    setVoiced(next) {
      voiced = next;
    },
    end(reason) {
      if (stopped) return;
      stopped = true;
      cancel();
      for (const listener of endedListeners) listener(reason);
    },
    degrade(message) {
      for (const listener of degradedListeners) listener(message);
    },
    get stopped() {
      return stopped;
    },
  };
}
