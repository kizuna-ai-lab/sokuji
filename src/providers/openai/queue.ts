/**
 * The in-band responses one leg asks for (ruling 8; choice 10): a released
 * press's `response.create` and each typed text wait, first in first out,
 * while a response is in progress, and go up one at a time — the server
 * refuses a second in-band response while one is active (survey §1.11).
 * The old app held one typed text and overwrote it, behind the anchor's
 * responses too (`MainPanel.tsx:1577-1607, 3470-3478` before `aecaae2b`);
 * here nothing is overwritten, and the anchor's out-of-band responses
 * neither wait nor make anything wait (ruling 2). Pure; the clock serves
 * the frames' `waitedMs` alone.
 *
 * - **No release unanswered, one response per batch** (ruling 8's aim): a
 *   `response.create` answers the conversation as it stands, and a
 *   release's commit goes up at the release, so every release still
 *   waiting when a request goes up is answered by that request's response.
 *   They leave the queue with it — merged, and counted — rather than each
 *   asking later for a response with nothing new to answer. A typed text is
 *   never merged: its item goes up only with its own request, so it needs a
 *   response of its own.
 * - `asked`: the request sent, until the response it created names it back
 *   (its metadata carries the request's event id) or it is refused. A
 *   refusal that names it because a response was active — the server's own
 *   detection answered first — puts it back at the head, still answering
 *   the releases merged into it, to go up when that response ends. A
 *   refusal naming it for any other reason drops it: it could not go up.
 *   The releases merged into it then have their commits in the conversation
 *   still, unanswered, so the first of them goes back at the head, the rest
 *   merged into it; each such refusal spends one, so a request refused
 *   every time comes to an end. An error that names nothing drops it too —
 *   it may be no refusal of this request's, whose response may be running,
 *   so nothing is put back. The end of an in-band response clears it too:
 *   the server answers a `response.create` at once, so by then it was
 *   created or refused — assuming a `response.create` reaches the server
 *   before the in-band response already in progress ends (ruling 8; choice
 *   10). Outside that assumption — two server-started responses beginning
 *   and ending within one round trip of ours, improbable with
 *   `interrupt_response: false` — a request can be lost: refused for the
 *   first, but its refusal arrives only after the second's `done` already
 *   cleared `asked`. Clearing on `done` unconditionally is kept anyway: it
 *   self-heals a request that would otherwise wait forever for an answer
 *   that already came and went.
 * - `active`: the in-band response in progress — the adapter's, or one the
 *   server's own detection created (`create_response: true`).
 */
import type { Clock } from '../../lib/contract/clock';

/** The refusal of a `response.create` sent while a response is still active (survey §1.11). */
export const ACTIVE_RESPONSE = 'conversation_already_has_active_response';

/** What waits: a released press (its audio already committed) or a typed text (its source already shown). */
export type Request = { kind: 'turn' } | { kind: 'text'; itemId: string; text: string };

export interface QueueSink {
  /**
   * Sends the request now, under this event id: a typed text's item and then
   * its `response.create`; a turn's `response.create` alone. `merged`: how
   * many releases that waited behind it its response answers too.
   */
  send(request: Request, eventId: string, waitedMs: number, merged: number): void;
  /** A request that must wait behind a response in progress, and how many wait now, it included. */
  queued(request: Request, waiting: number): void;
}

export interface QueueOptions {
  clock: Pick<Clock, 'now'>;
  sink: QueueSink;
  /** A fresh client event id for each request sent. */
  eventId(): string;
}

/** A request waiting, and the releases merged into it (only a request put back at the head carries any). */
interface Waiting {
  request: Request;
  at: number;
  merged: ReadonlyArray<{ request: Request; at: number }>;
}

export class ResponseQueue {
  private readonly waiting: Waiting[] = [];
  private active: string | null = null;
  private asked: (Waiting & { eventId: string }) | null = null;
  private stopped = false;

  constructor(private readonly o: QueueOptions) {}

  /** An in-band response is in progress, or asked for. */
  get busy(): boolean {
    return this.active !== null || this.asked !== null;
  }

  push(request: Request): void {
    if (this.stopped) return;
    this.waiting.push({ request, at: this.o.clock.now(), merged: [] });
    if (this.busy) this.o.sink.queued(request, this.waiting.length);
    this.flush();
  }

  /** An in-band response was created: the one asked for when it names the request, else the server's own. */
  created(responseId: string, request: string | undefined): void {
    this.active = responseId;
    if (request !== undefined && request === this.asked?.eventId) this.asked = null;
  }

  /** An in-band response ended: the next request goes up. */
  done(responseId: string): void {
    if (this.active === responseId) this.active = null;
    this.asked = null;
    this.flush();
  }

  /** A server `error`: a refusal of the request asked, when it names it or names nothing. */
  refused(eventId: string | null | undefined, code: string | null | undefined): void {
    const asked = this.asked;
    if (!asked || (eventId && eventId !== asked.eventId)) return;
    this.asked = null;
    if (eventId === asked.eventId && code === ACTIVE_RESPONSE) {
      // Refused because a response was active: it goes again, first, when that one ends — still answering its merged releases.
      this.waiting.unshift({ request: asked.request, at: asked.at, merged: asked.merged });
    } else if (eventId === asked.eventId && asked.merged.length > 0) {
      // Refused for another reason, and dropped: its merged releases are still unanswered, and the first of them asks for them all.
      const [first, ...rest] = asked.merged;
      this.waiting.unshift({ request: first.request, at: first.at, merged: rest });
    }
    this.flush();
  }

  /** Nothing goes up after stop. */
  stop(): void {
    this.stopped = true;
    this.waiting.length = 0;
  }

  private flush(): void {
    if (this.stopped || this.busy) return;
    const next = this.waiting.shift();
    if (!next) return;
    // Every release still waiting has its commit in the conversation already: this request's response answers it (ruling 8's aim).
    const merged = [...next.merged];
    for (let i = 0; i < this.waiting.length; ) {
      const w = this.waiting[i];
      if (w.request.kind !== 'turn') {
        i += 1;
        continue;
      }
      this.waiting.splice(i, 1);
      merged.push({ request: w.request, at: w.at }, ...w.merged);
    }
    const eventId = this.o.eventId();
    this.asked = { eventId, request: next.request, at: next.at, merged };
    this.o.sink.send(next.request, eventId, this.o.clock.now() - next.at, merged.length);
  }
}
