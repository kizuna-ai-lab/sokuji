import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import { ACTIVE_RESPONSE, ResponseQueue, type Request } from './queue';

function queue() {
  const clock = createVirtualClock(0);
  const sent: Array<{ request: Request; eventId: string; waitedMs: number }> = [];
  const queued: Array<{ request: Request; waiting: number }> = [];
  let n = 0;
  const q = new ResponseQueue({
    clock,
    eventId: () => `sokuji_${++n}`,
    sink: { send: (request, eventId, waitedMs) => sent.push({ request, eventId, waitedMs }), queued: (request, waiting) => queued.push({ request, waiting }) },
  });
  return { q, clock, sent, queued };
}
const TURN: Request = { kind: 'turn' };
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
   * The model: the server answers a `response.create` at once (refused
   * while a response is active, else created), and its events reach the
   * client in order, late; its own detection may create a response at any
   * moment — racing a request — but a response ends only once the client
   * has heard everything before it (a response lasts seconds, its events
   * arrive in milliseconds).
   */
  it("answers every request exactly once, in the order pushed, whatever the server's own detection and the delay of its answers — echoing the request or not (seeded)", () => {
    for (let seed = 1; seed <= 400; seed++) {
      let s = seed;
      /** mulberry32 */
      const random = () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      /** Half the runs: a server that does not echo a response's metadata, so only its end tells the queue it was answered. */
      const echoes = seed % 2 === 0;
      const clock = createVirtualClock(0);
      /** What the server said, on its way back: one ordered stream, delivered with delay. */
      const outbox: Array<() => void> = [];
      let n = 0;
      let responses = 0;
      let serverActive: string | null = null;
      const answered: Request[] = [];
      const pushed: Request[] = [];
      const q = new ResponseQueue({
        clock,
        eventId: () => `sokuji_${++n}`,
        sink: {
          // The server answers a `response.create` at once: refused while a response is active, else created.
          send: (request, eventId, waitedMs) => {
            expect(waitedMs).toBeGreaterThanOrEqual(0);
            if (serverActive) {
              outbox.push(() => q.refused(eventId, ACTIVE_RESPONSE));
              return;
            }
            const id = `resp_${++responses}`;
            serverActive = id;
            answered.push(request);
            outbox.push(() => q.created(id, echoes ? eventId : undefined));
          },
          queued: () => {},
        },
      });
      const detect = () => {
        if (serverActive) return;
        const id = `resp_${++responses}`;
        serverActive = id;
        outbox.push(() => q.created(id, undefined));
      };
      const end = () => {
        if (!serverActive || outbox.length > 0) return;
        const id = serverActive;
        serverActive = null;
        outbox.push(() => q.done(id));
      };
      for (let step = 0; step < 80; step++) {
        const r = random();
        if (r < 0.25) {
          // A fresh object each time (not the shared TURN): two turns are
          // otherwise indistinguishable by value, so a mutant that answers
          // the wrong one — losing one turn while duplicating another —
          // would still pass a value comparison.
          const request: Request = random() < 0.5 ? { kind: 'turn' } : text(step);
          pushed.push(request);
          q.push(request);
        } else if (r < 0.4) detect();
        else if (r < 0.6) end();
        else outbox.shift()?.();
        clock.advance(10);
      }
      // Drain: every answer delivered, every response ended; nothing is left waiting.
      for (let i = 0; i < 1_000 && (outbox.length > 0 || serverActive); i++) {
        while (outbox.length > 0) outbox.shift()!();
        end();
      }
      // By identity, not just by value: a lost turn papered over by a
      // duplicated one elsewhere must not read as "the same sequence".
      expect(answered.length, `seed ${seed}`).toBe(pushed.length);
      expect(answered.every((a, i) => a === pushed[i]), `seed ${seed}`).toBe(true);
      expect(q.busy, `seed ${seed}`).toBe(false);
    }
  });
});
