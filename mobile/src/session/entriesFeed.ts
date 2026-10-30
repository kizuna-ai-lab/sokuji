import type { Entry } from '@shared/lib/projection/types';
import type { Transcript } from './transcript';

// What the subtitle list is told, and when. The transcript notifies on every
// message; the list hears at most once per batch window while the app is in
// front, nothing while it is not (drawing a growing transcript with the phone
// locked is what froze the Android phone and grew memory on iOS in Gate A),
// and once, with everything, the moment the app comes back.
export function createEntriesFeed(o: {
  transcript: Pick<Transcript, 'entries' | 'subscribe'>;
  isActive: () => boolean;
  onActiveChange(cb: (active: boolean) => void): () => void;
  now: () => number;
  schedule: (fn: () => void, ms: number) => () => void;
  batchMs?: number;
}): { subscribe(listener: (entries: readonly Entry[]) => void): () => void; stop(): void } {
  const batchMs = o.batchMs ?? 250;
  const listeners = new Set<(entries: readonly Entry[]) => void>();
  let stopped = false;
  let dirty = false;
  let cancel: (() => void) | null = null;

  // Newest first: the list is inverted, so index 0 sits at the bottom.
  const deliver = () => {
    if (stopped) return;
    dirty = false;
    const newestFirst = [...o.transcript.entries()].reverse();
    listeners.forEach((l) => l(newestFirst));
  };
  const flush = () => {
    cancel = null;
    if (stopped || !dirty || !o.isActive()) return;
    deliver();
  };
  const changed = () => {
    dirty = true;
    if (stopped || cancel || !o.isActive()) return;
    cancel = o.schedule(flush, batchMs);
  };
  const unsubscribeTranscript = o.transcript.subscribe(changed);
  const unsubscribeActive = o.onActiveChange((active) => {
    if (!active || stopped || !dirty) return;
    cancel?.();
    cancel = null;
    deliver();
  });

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      cancel?.();
      cancel = null;
      unsubscribeTranscript();
      unsubscribeActive();
    },
  };
}
