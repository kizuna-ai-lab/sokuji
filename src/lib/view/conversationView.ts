/**
 * The conversation as a surface process sees it: the legs and L2's entries,
 * projected once for every surface in the process (spec: "L2 … runs once per
 * session, not once per surface"). Driven directly, the projection would run
 * on every audio chunk and every partial; it runs at most once per interval
 * instead — today's list updates at the same 20 Hz (`UPDATE_THROTTLE_MS`).
 */
import type { Clock } from '../contract/clock';
import type { Leg } from '../conversation/types';
import { describeCause, reportError } from '../diagnostics/report';
import { createProjector } from '../projection/project';
import type { Entry, ProjectionSettings } from '../projection/types';

/** A value that can be read and watched: the view, a settings source, karaoke. */
export interface Readable<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

export interface ConversationViewState {
  legs: readonly Leg[];
  entries: readonly Entry[];
}

/** How long changes are gathered before one projection. */
export const VIEW_INTERVAL_MS = 50;

export function createConversationView(
  conversation: { snapshot(): readonly Leg[]; subscribe(listener: () => void): () => void },
  settings: Readable<ProjectionSettings>,
  clock: Pick<Clock, 'setTimeout'>,
  intervalMs = VIEW_INTERVAL_MS,
): Readable<ConversationViewState> & { dispose(): void } {
  const projector = createProjector();
  const listeners = new Set<() => void>();
  const compute = (): ConversationViewState => {
    const legs = conversation.snapshot();
    return { legs, entries: projector.project(legs, settings.get()) };
  };
  let state = compute();
  let cancel: (() => void) | null = null;
  // A throw from `compute()` (the conversation's `snapshot()`, or the
  // projector) is a hot path — up to once per interval, 20 Hz — so it is
  // reported once per failing streak, not per flush, and the previous state
  // is kept rather than losing what was last drawn.
  let computeFailing = false;

  const flush = () => {
    cancel = null;
    let next: ConversationViewState;
    try {
      next = compute();
      computeFailing = false;
    } catch (error) {
      if (!computeFailing) {
        reportError('ConversationView', `Projecting the conversation failed: ${describeCause(error)}`, { cause: error, dedupeKey: 'view-compute' });
      }
      computeFailing = true;
      return;
    }
    // The snapshot and the projection both keep their identity when nothing changed.
    if (next.legs === state.legs && next.entries === state.entries) return;
    state = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        reportError('ConversationView', `A view subscriber threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'view-subscriber' });
      }
    }
  };
  const schedule = () => { cancel ??= clock.setTimeout(flush, intervalMs); };
  const offConversation = conversation.subscribe(schedule);
  const offSettings = settings.subscribe(schedule);

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      offConversation();
      offSettings();
      cancel?.();
      cancel = null;
      listeners.clear();
    },
  };
}
