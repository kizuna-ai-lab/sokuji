import type { Conversation } from '../conversation/Conversation';
import type { Leg, LegName } from '../conversation/types';
import { describeCause, reportError } from '../diagnostics/report';

const ORDER: readonly LegName[] = ['speaker', 'participant'];

/** Which provider and models a conversation's run used: what its export says about itself (plan 1d-3). */
export interface ConversationInfo {
  provider: string;
  models: { asrModel?: string; translationModel?: string; ttsModel?: string };
}

/**
 * The conversation: the legs of the last run, held until the next start
 * replaces them or `clear()` empties them (spec: "The conversation outlives
 * the run"). Export, replay, auto-save and the surfaces read this, never a run.
 */
export class ConversationSet {
  private legs = new Map<LegName, Conversation>();
  private unsubscribes: Array<() => void> = [];
  private readonly listeners = new Set<() => void>();
  private cached: readonly Leg[] = [];
  private stale = true;
  private current: ConversationInfo | null = null;

  get(leg: LegName): Conversation | undefined {
    return this.legs.get(leg);
  }

  get info(): ConversationInfo | null {
    return this.current;
  }

  /** A new run's legs take the place of the last run's. */
  replace(next: ReadonlyMap<LegName, Conversation>, info: ConversationInfo | null = null): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.legs = new Map(next);
    this.current = info;
    this.unsubscribes = [...this.legs.values()].map((c) => c.subscribe(() => this.changed()));
    this.changed();
  }

  /** Every leg's snapshot, speaker first; the same array until a leg changes. */
  snapshot(): readonly Leg[] {
    if (this.stale) {
      this.cached = ORDER.flatMap((leg) => {
        const conversation = this.legs.get(leg);
        return conversation ? [conversation.snapshot()] : [];
      });
      this.stale = false;
    }
    return this.cached;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  clear(): void {
    for (const conversation of this.legs.values()) conversation.clear();
  }

  private changed(): void {
    this.stale = true;
    // Each listener is isolated: a throw is reported, never allowed to skip
    // notifying a later listener (F2).
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        reportError('SessionRunner', `A conversation subscriber threw: ${describeCause(error)}`, { cause: error, dedupeKey: 'subscriber' });
      }
    }
  }
}
