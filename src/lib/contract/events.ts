import type { AdapterEventKind, AdapterEvents } from './adapter';

type PayloadOf<K extends AdapterEventKind> = Parameters<AdapterEvents[K]>[0];

/**
 * One adapter event as a value: `{ kind, payload }`. What L1 folds. `lateSpeech` is not one of them: it is for a
 * voice outside the adapter, and nothing above the contract takes it.
 */
export type AdapterEvent = {
  [K in AdapterEventKind]: { kind: K; payload: PayloadOf<K> };
}[AdapterEventKind];

const KINDS = {
  segmentOpened: true, segmentText: true, segmentClosed: true, audio: true, speechRanges: true,
  closed: true, reconnecting: true, reconnected: true, failed: true, degraded: true,
  loading: true, busy: true, frame: true,
} satisfies Record<AdapterEventKind, true>;

export const EVENT_KINDS = Object.keys(KINDS) as ReadonlyArray<AdapterEventKind>;

/** An `AdapterEvents` object whose every method forwards one tagged event; it takes no `lateSpeech`. */
export function eventsFrom(listener: (event: AdapterEvent) => void): AdapterEvents {
  const out: Record<string, (payload?: unknown) => void> = {};
  for (const kind of EVENT_KINDS) {
    out[kind] = (payload?: unknown) => listener({ kind, payload } as AdapterEvent);
  }
  return out as unknown as AdapterEvents;
}

/** For tests: the events object and the array it appends to. */
export function recordEvents(): { events: AdapterEvents; log: AdapterEvent[] } {
  const log: AdapterEvent[] = [];
  return { events: eventsFrom((e) => log.push(e)), log };
}
