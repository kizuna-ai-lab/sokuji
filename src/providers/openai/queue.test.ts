import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { ACTIVE_RESPONSE, ResponseQueue, type Request } from './queue';

function queue() {
  const clock = createVirtualClock(0);
  const sent: Array<{ request: Request; eventId: string; waitedMs: number }> = [];
  /** Each send's `merged`, beside `sent`: the releases waiting behind it that its response answers too. */
  const merged: number[] = [];
  const queued: Array<{ request: Request; waiting: number }> = [];
  let n = 0;
  const q = new ResponseQueue({
    clock,
    eventId: () => `sokuji_${++n}`,
    sink: {
      send: (request, eventId, waitedMs, m) => {
        sent.push({ request, eventId, waitedMs });
        merged.push(m);
      },
      queued: (request, waiting) => queued.push({ request, waiting }),
    },
  });
  return { q, clock, sent, merged, queued };
}
const TURN: Request = { kind: 'turn' };
/** A release of its own: two turns are otherwise indistinguishable by value. */
const turn = (): Request => ({ kind: 'turn' });
const text = (i: number): Request => ({ kind: 'text', itemId: `sokuji_text_${i}`, text: `words ${i}` });

describe("OpenAI Realtime's response queue (ruling 8; choice 10)", () => {
  it('sends a request at once while no response is in progress, and waits for none', () => {
    const { q, sent, queued } = queue();
    q.push(TURN);
    expect(sent).toEqual([{ request: TURN, eventId: 'sokuji_1', waitedMs: 0 }]);
    expect(queued).toEqual([]);
    expect(q.busy).toBe(true);
  });

  it('holds every request made while a response is in progress, first in first out, one at a time: nothing is overwritten', () => {
    const { q, clock, sent, queued } = queue();
    q.push(text(1));
    q.created('resp_1', 'sokuji_1');
    clock.advance(500);
    q.push(TURN);
    q.push(text(2));
    q.push(text(3));
    expect(queued.map((e) => e.waiting)).toEqual([1, 2, 3]);
    expect(sent).toHaveLength(1);
    clock.advance(1_000);
    q.done('resp_1');
    expect(sent.slice(1)).toEqual([{ request: TURN, eventId: 'sokuji_2', waitedMs: 1_000 }]);
    // The next waits for this one's response, not for a timer.
    q.created('resp_2', 'sokuji_2');
    q.done('resp_2');
    q.created('resp_3', 'sokuji_3');
    q.done('resp_3');
    expect(sent.map((e) => e.request)).toEqual([text(1), TURN, text(2), text(3)]);
  });

  it("holds a request while the one asked for has not been created yet, and while the server's own detection is answering", () => {
    const { q, sent } = queue();
    q.push(TURN);
    q.push(text(1));
    expect(sent).toHaveLength(1);
    q.created('resp_1', 'sokuji_1');
    q.done('resp_1');
    expect(sent).toHaveLength(2);
    q.created('resp_2', 'sokuji_2');
    q.done('resp_2');
    // The server's own: it names no request.
    q.created('resp_vad', undefined);
    q.push(text(2));
    expect(sent).toHaveLength(2);
    q.done('resp_vad');
    expect(sent.map((e) => e.request)).toEqual([TURN, text(1), text(2)]);
  });

  it("puts a request refused because a response was active back at the head: the server's detection answered first", () => {
    const { q, clock, sent } = queue();
    q.push(text(1));
    // The server's own response was created before ours arrived; ours is refused, naming it.
    q.created('resp_vad', undefined);
    q.push(text(2));
    clock.advance(700);
    q.refused('sokuji_1', ACTIVE_RESPONSE);
    expect(sent).toHaveLength(1);
    clock.advance(300);
    q.done('resp_vad');
    // The re-ask's waitedMs counts from the first push, not reset when it went back to the head.
    expect(sent[1]).toEqual({ request: text(1), eventId: 'sokuji_2', waitedMs: 1_000 });
    expect(sent.map((e) => [e.request, e.eventId])).toEqual([[text(1), 'sokuji_1'], [text(1), 'sokuji_2']]);
    q.created('resp_1', 'sokuji_2');
    q.done('resp_1');
    expect(sent.map((e) => e.request)).toEqual([text(1), text(1), text(2)]);
  });

  it('drops a request refused for another reason, or by an error that names nothing, and sends the next; an error naming another request changes nothing', () => {
    const { q, sent } = queue();
    q.push(text(1));
    q.push(text(2));
    q.push(text(3));
    q.refused('sokuji_anchor', ACTIVE_RESPONSE);
    expect(sent).toHaveLength(1);
    q.refused('sokuji_1', 'invalid_value');
    expect(sent.map((e) => e.request)).toEqual([text(1), text(2)]);
    q.refused(null, undefined);
    expect(sent.map((e) => e.request)).toEqual([text(1), text(2), text(3)]);
  });

  it("clears the request asked when any in-band response ends: by then the server has answered it", () => {
    const { q, sent } = queue();
    q.push(TURN);
    q.push(text(1));
    // A response whose metadata the server did not echo: it still ends.
    q.created('resp_1', undefined);
    q.done('resp_1');
    expect(sent.map((e) => e.request)).toEqual([TURN, text(1)]);
  });

  it('answers every release waiting behind a response with the one request asked next: their commits are in the conversation already, so its response answers them too (ruling 8)', () => {
    const { q, clock, sent, merged, queued } = queue();
    const first = turn();
    q.push(TURN);
    q.created('resp_1', 'sokuji_1');
    q.push(first);
    q.push(turn());
    q.push(turn());
    expect(queued.map((e) => e.waiting)).toEqual([1, 2, 3]);
    clock.advance(800);
    q.done('resp_1');
    // One request goes up for the three: the first, counting the two behind it.
    expect(sent.slice(1)).toEqual([{ request: first, eventId: 'sokuji_2', waitedMs: 800 }]);
    expect(merged).toEqual([0, 2]);
    q.created('resp_2', 'sokuji_2');
    q.done('resp_2');
    // Nothing is left to ask: no response with nothing new.
    expect(sent).toHaveLength(2);
    expect(q.busy).toBe(false);
  });

  it("merges the releases waiting behind a typed text into its request — their commits precede its item — and never a typed text into a release's: its item goes up only with its own request (ruling 8)", () => {
    // A text, then a release, both waiting: the text's response answers the release.
    const a = queue();
    a.q.push(TURN);
    a.q.created('resp_1', 'sokuji_1');
    a.q.push(text(1));
    a.q.push(turn());
    a.q.done('resp_1');
    expect(a.sent.map((e) => e.request)).toEqual([TURN, text(1)]);
    expect(a.merged).toEqual([0, 1]);
    a.q.created('resp_2', 'sokuji_2');
    a.q.done('resp_2');
    expect(a.sent).toHaveLength(2);

    // A release, a text, a release: the first release's request answers the second; the text waits for its own.
    const b = queue();
    const release = turn();
    b.q.push(TURN);
    b.q.created('resp_1', 'sokuji_1');
    b.q.push(release);
    b.q.push(text(1));
    b.q.push(turn());
    b.q.done('resp_1');
    expect(b.sent.map((e) => e.request)).toEqual([TURN, release]);
    expect(b.merged).toEqual([0, 1]);
    b.q.created('resp_2', 'sokuji_2');
    b.q.done('resp_2');
    expect(b.sent.map((e) => e.request)).toEqual([TURN, release, text(1)]);
    expect(b.merged).toEqual([0, 1, 0]);
    b.q.created('resp_3', 'sokuji_3');
    b.q.done('resp_3');
    expect(b.sent).toHaveLength(3);
  });

  it('asks again, still answering its merged releases, a request refused as active; re-queues one of them at the head when a refusal names it for another reason — their commits are still unanswered — and none on an error that names nothing (ruling 8; choice 10)', () => {
    const { q, clock, sent, merged } = queue();
    const r1 = turn();
    const r2 = turn();
    q.push(TURN);
    q.created('resp_1', 'sokuji_1');
    q.push(r1);
    q.push(r2);
    q.push(text(1));
    q.push(turn());
    q.done('resp_1');
    expect(merged).toEqual([0, 2]);
    // Refused as active (a response the queue did not know of): asked again once not busy, still answering the two.
    q.refused('sokuji_2', ACTIVE_RESPONSE);
    expect(sent.map((e) => [e.request, e.eventId])).toEqual([[TURN, 'sokuji_1'], [r1, 'sokuji_2'], [r1, 'sokuji_3']]);
    expect(merged).toEqual([0, 2, 2]);
    // Refused for another reason, naming it: dropped, and the first release it answered asks for the rest — at the head, ahead of the text.
    clock.advance(300);
    q.refused('sokuji_3', 'invalid_value');
    expect(sent.slice(3)).toEqual([{ request: r2, eventId: 'sokuji_4', waitedMs: 300 }]);
    expect(merged).toEqual([0, 2, 2, 1]);
    // An error naming nothing is not known to be this request's refusal, and its response may be running: dropped, as before, with nothing re-queued; the text goes up.
    q.refused(null, 'server_error');
    expect(sent.map((e) => e.request)).toEqual([TURN, r1, r1, r2, text(1)]);
    expect(merged).toEqual([0, 2, 2, 1, 0]);
    q.created('resp_2', 'sokuji_5');
    q.done('resp_2');
    expect(sent).toHaveLength(5);
    expect(q.busy).toBe(false);
  });

  it('sends nothing after stop, including a refusal of the request asked before it that arrives late', () => {
    const { q, sent } = queue();
    q.push(TURN);
    q.push(text(1));
    q.stop();
    // A refusal that would normally put the request back at the head must not reach `send` after stop.
    q.refused('sokuji_1', ACTIVE_RESPONSE);
    q.done('resp_1');
    q.push(text(2));
    expect(sent).toHaveLength(1);
  });

  /**
   * The model, a GA conversation: the server answers a `response.create` at
   * once — refused while a response is active, else created — and a response
   * answers every user item added since the previous in-band response began;
   * its events reach the client in order, late, and a response ends only once
   * the client has heard everything before it (a response lasts seconds, its
   * events arrive in milliseconds). A typed text's item goes up with its
   * request. Under manual turns a release's commit enters the conversation at
   * the release, before the queue hears of it, and the server starts no
   * response of its own. Under automatic turns its detection commits what it
   * heard and answers it at any moment, racing a request, or leaves it
   * unanswered while a response runs (`interrupt_response: false`). Under
   * either, the drift anchor's out-of-band response may run, and the server
   * may refuse an in-band one meanwhile (the live test's item 4). Half the
   * runs echo the request in the response's metadata, so only its end tells
   * the queue it was answered.
   */
  it('asks no response with nothing new under releases and typed text, answers every release and every typed text, sends typed text first in first out and asks one request at a time — whatever the interleaving (seeded)', () => {
    for (let seed = 1; seed <= 400; seed++) {
      let s = seed;
      /** mulberry32 */
      const random = () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const where = `seed ${seed}`;
      const manual = seed % 4 < 2;
      const echoes = seed % 2 === 0;
      const clock = createVirtualClock(0);
      /** What the server said, on its way back: one ordered stream, delivered with delay. */
      const outbox: Array<() => void> = [];
      const conversation: Array<{ id: string; user: boolean }> = [];
      /** The conversation's length when the last in-band response began: what the next one answers starts there. */
      let answeredFrom = 0;
      /** How often each user item was answered. */
      const answers = new Map<string, number>();
      let n = 0;
      let items = 0;
      let responses = 0;
      let inBand: string | null = null;
      let anchor = false;
      /** Requests sent whose answer — created or refused — has not reached the queue yet. */
      let unheard = 0;
      const broken: string[] = [];
      const inputless: string[] = [];
      const commits: string[] = [];
      const typed: Request[] = [];
      const itemsSent: Request[] = [];
      /** A response begins: it answers the user items since the previous one began. */
      const begin = (): { id: string; fresh: number } => {
        const id = `resp_${++responses}`;
        const fresh = conversation.slice(answeredFrom).filter((i) => i.user);
        for (const i of fresh) answers.set(i.id, (answers.get(i.id) ?? 0) + 1);
        conversation.push({ id: `${id}_out`, user: false });
        answeredFrom = conversation.length;
        inBand = id;
        return { id, fresh: fresh.length };
      };
      const q = new ResponseQueue({
        clock,
        eventId: () => `sokuji_${++n}`,
        sink: {
          send: (request, eventId, waitedMs) => {
            if (waitedMs < 0) broken.push(`waitedMs ${waitedMs}`);
            // One request at a time: the previous one's answer has reached the queue.
            if (unheard !== 0) broken.push(`${eventId} asked with ${unheard} unheard`);
            // Under manual turns no response but the queue's own runs: asking during one is asking two at once.
            if (manual && inBand) broken.push(`${eventId} asked while ${inBand} ran`);
            if (request.kind === 'text' && !itemsSent.includes(request)) {
              itemsSent.push(request);
              conversation.push({ id: request.itemId, user: true });
            }
            unheard += 1;
            if (inBand || anchor) {
              outbox.push(() => { unheard -= 1; q.refused(eventId, ACTIVE_RESPONSE); });
              return;
            }
            const { id, fresh } = begin();
            if (fresh === 0) inputless.push(`${id} for ${request.kind}`);
            outbox.push(() => { unheard -= 1; q.created(id, echoes ? eventId : undefined); });
          },
          queued: () => {},
        },
      });
      /** Manual: a release, its commit already in the conversation. Automatic: the server's detection, answering unless a response runs. */
      const speak = () => {
        const id = `input_${++items}`;
        conversation.push({ id, user: true });
        if (manual) {
          commits.push(id);
          // A fresh object each time: a mutant that loses one release while duplicating another must not pass by value.
          q.push({ kind: 'turn' });
          return;
        }
        if (inBand) return;
        const { id: responseId } = begin();
        outbox.push(() => q.created(responseId, undefined));
      };
      const type = () => {
        const request = text(++items);
        typed.push(request);
        q.push(request);
      };
      const end = () => {
        if (!inBand || outbox.length > 0) return;
        const id = inBand;
        inBand = null;
        outbox.push(() => q.done(id));
      };
      for (let step = 0; step < 80; step++) {
        const r = random();
        if (r < 0.16) speak();
        else if (r < 0.28) type();
        else if (r < 0.34) anchor = !anchor;
        else if (r < 0.52) end();
        else outbox.shift()?.();
        clock.advance(10);
      }
      // Drain: the anchor ends, every answer is delivered, every response ends.
      anchor = false;
      for (let i = 0; i < 1_000 && (outbox.length > 0 || inBand); i++) {
        while (outbox.length > 0) outbox.shift()!();
        end();
      }
      expect(broken, where).toEqual([]);
      // Nothing lost: nothing waits or is asked, and every typed text went up, once each, first in first out — by identity.
      expect(q.busy, where).toBe(false);
      expect(itemsSent.length, where).toBe(typed.length);
      expect(itemsSent.every((t, i) => t === typed[i]), where).toBe(true);
      for (const t of typed) expect(answers.get((t as { itemId: string }).itemId), `${where}: ${(t as { itemId: string }).itemId}`).toBe(1);
      if (manual) {
        // Every release answered, and no response asked for nothing new: releases waiting behind one request are its.
        for (const c of commits) expect(answers.get(c), `${where}: ${c}`).toBe(1);
        expect(inputless, where).toEqual([]);
      }
      // Under automatic turns the server's detection may answer a refused text in the round trip before it is asked again, which then asks for nothing new: outside this rule, and not asserted.
    }
  });
});
