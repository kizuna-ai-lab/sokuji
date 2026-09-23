import type { AdapterEvents } from './adapter';

type PayloadOf<K extends keyof AdapterEvents> = Parameters<AdapterEvents[K]>[0];

/** One adapter event as a value: `{ kind, payload }`. What L1 folds. */
export type AdapterEvent = {
  [K in keyof AdapterEvents]: { kind: K; payload: PayloadOf<K> };
}[keyof AdapterEvents];

const KINDS = {
  segmentOpened: true, segmentText: true, segmentClosed: true, audio: true,
  closed: true, reconnecting: true, reconnected: true, failed: true, degraded: true,
  loading: true, busy: true, frame: true,
} satisfies Record<keyof AdapterEvents, true>;

export const EVENT_KINDS = Object.keys(KINDS) as ReadonlyArray<keyof AdapterEvents>;

/** An `AdapterEvents` object whose every method forwards one tagged event. */
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
