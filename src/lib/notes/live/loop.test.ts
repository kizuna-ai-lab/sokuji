// The live notes' loop on the app clock: one update at a time, at most every 20 s, a slow one given up, the last at Stop.
import { describe, it, expect, vi } from 'vitest';
import { createVirtualClock } from '../../contract/clock';
import type { ChatPort, ChatRequest } from '../chat';
import { createLiveNotes, LIVE_INTERVAL_MS } from './loop';
import type { LiveSentence, LiveState } from './state';

const s = (n: number, o: Partial<LiveSentence> = {}): LiveSentence => ({
  n, side: 'other', sideCertain: true, track: 'other', speaker: '1.1', startMs: n * 5_000, endMs: n * 5_000 + 4_000,
  text: `sentence ${n}`, timeKind: 'given', fromOpen: false, ...o,
});
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

/** A model the test answers by hand: each call waits until told. */
function handModel() {
  const calls: Array<{ r: ChatRequest; answer(v: unknown): void; fail(e: unknown): void }> = [];
  const chat: ChatPort = (r) => new Promise((resolve, reject) => {
    calls.push({ r, answer: resolve, fail: reject });
    r.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  return { chat, calls, fresh: (i: number) => (calls[i].r.user as { new: Array<{ sid: number }> }).new.map((x) => x.sid) };
}
const topicWith = (sid: number, text = `point ${sid}`) => ({ title: 'T', new_topic: { title: 'A', summary: 'a', points: [{ text, sid, kinds: [] }] } });
const addTo = (sid: number, text = `point ${sid}`) => ({ current_topic: { add: [{ text, sid, kinds: [] }] } });

function setup(from?: { state: LiveState; seen: LiveSentence[] }) {
  const clock = createVirtualClock(0);
  const model = handModel();
  const states: LiveState[] = [];
  const hints: boolean[] = [];
  const lines: Array<Record<string, unknown>> = [];
  const live = createLiveNotes({
    chat: model.chat, clock, language: { code: 'en', name: 'English' }, speakerLabel: () => 'Other side',
    onState: (st) => states.push(st), onHint: (h) => hints.push(h), log: (l) => lines.push(l),
    ...(from ? { from } : {}),
  });
  return { clock, model, states, hints, lines, live };
}

describe('the live notes loop', () => {
  it('sends nothing before a sentence arrives', async () => {
    const { clock, model } = setup();
    clock.advance(3 * LIVE_INTERVAL_MS);
    await flush();
    expect(model.calls).toHaveLength(0);
  });

  it('sends the new sentences at most every 20 seconds, and shows each answer it can use', async () => {
    const { clock, model, live, states } = setup();
    live.sentences([s(1)]);
    clock.advance(LIVE_INTERVAL_MS - 1);
    expect(model.calls).toHaveLength(0);
    clock.advance(1);
    expect(model.fresh(0)).toEqual([1]);
    model.calls[0].answer(topicWith(1));
    await flush();
    expect(states[states.length - 1]?.topics[0].points.map((p) => p.n)).toEqual([1]);
    live.sentences([s(2), s(3)]);
    clock.advance(LIVE_INTERVAL_MS);
    expect(model.fresh(1)).toEqual([2, 3]);
    expect((model.calls[1].r.user as { context: unknown[] }).context).toHaveLength(1);
  });

  it('gives up a request still open when the next is due, and sends its sentences with the next', async () => {
    const { clock, model, live, states } = setup();
    live.sentences([s(1)]);
    clock.advance(LIVE_INTERVAL_MS);
    live.sentences([s(2)]);
    clock.advance(LIVE_INTERVAL_MS);
    await flush();
    expect(model.calls[0].r.signal.aborted).toBe(true);
    expect(model.fresh(1)).toEqual([1, 2]);
    model.calls[0].answer(topicWith(1, 'late'));
    await flush();
    expect(states).toHaveLength(0);
  });

  it('counts a request over 20 seconds as a failure; three in a row show the hint, a success hides it', async () => {
    const { clock, model, live, hints, states } = setup();
    live.sentences([s(1)]);
    for (let i = 0; i < 3; i++) {
      clock.advance(LIVE_INTERVAL_MS);
      await flush();
    }
    clock.advance(LIVE_INTERVAL_MS);
    await flush();
    expect(hints).toEqual([true]);
    expect(states).toHaveLength(0);
    model.calls[model.calls.length - 1].answer(topicWith(1));
    await flush();
    expect(hints).toEqual([true, false]);
    expect(states).toHaveLength(1);
  });

  it('changes nothing on screen for an update that fails or cannot be used', async () => {
    const { clock, model, live, states } = setup();
    live.sentences([s(1)]);
    clock.advance(LIVE_INTERVAL_MS);
    model.calls[0].fail(new Error('Bad gateway'));
    await flush();
    clock.advance(LIVE_INTERVAL_MS);
    model.calls[1].answer({ current_topic: { add: [] } });
    await flush();
    expect(states).toHaveLength(0);
    clock.advance(LIVE_INTERVAL_MS);
    expect(model.fresh(2)).toEqual([1]);
  });

  it('at Stop waits for the open request, sends the rest once, and then nothing runs', async () => {
    const { clock, model, live, states } = setup();
    live.sentences([s(1)]);
    clock.advance(LIVE_INTERVAL_MS);
    live.sentences([s(2)]);
    const stopped = live.stop();
    model.calls[0].answer(topicWith(1));
    await flush();
    expect(model.fresh(1)).toEqual([2]);
    model.calls[1].answer(addTo(2));
    await stopped;
    expect(states[states.length - 1]?.topics[0].points.map((p) => p.n)).toEqual([1, 2]);
    live.sentences([s(3)]);
    clock.advance(3 * LIVE_INTERVAL_MS);
    await flush();
    expect(model.calls).toHaveLength(2);
  });

  it('writes one log line per update', async () => {
    const { clock, model, live, lines } = setup();
    live.sentences([s(1, { fromOpen: true })]);
    clock.advance(LIVE_INTERVAL_MS);
    clock.advance(5_000);
    model.calls[0].answer(topicWith(1));
    await flush();
    expect(lines).toEqual([{ sentences: 1, latencyMs: 5_000, accepted: true, givenUp: false, unstablePoints: 1 }]);
  });

  it('stops everything when disposed', async () => {
    const { clock, model, live, states } = setup();
    live.sentences([s(1)]);
    clock.advance(LIVE_INTERVAL_MS);
    live.dispose();
    expect(model.calls[0].r.signal.aborted).toBe(true);
    clock.advance(3 * LIVE_INTERVAL_MS);
    await flush();
    expect(model.calls).toHaveLength(1);
    expect(states).toHaveLength(0);
    vi.restoreAllMocks();
  });
  it('sends nothing more on its own once quiet, and still takes the sentences for the last update', async () => {
    const { clock, model, live } = setup();
    live.sentences([s(1)]);
    live.quiet();
    live.sentences([s(2)]);
    clock.advance(3 * LIVE_INTERVAL_MS);
    await flush();
    expect(model.calls).toHaveLength(0);
    const stopped = live.stop();
    await flush();
    expect(model.fresh(0)).toEqual([1, 2]);
    model.calls[0].answer(topicWith(1));
    await stopped;
    expect(model.calls).toHaveLength(1);
  });

  it('goes on from earlier notes: their sentences are context, not new, and the answer adds to them', async () => {
    const earlier: LiveState = { title: 'Weekly', topics: [{ n: 1, title: 'A', summary: 'a', points: [{ n: 1, text: 'point 1', kinds: [] }] }] };
    const { clock, model, live, states } = setup({ state: earlier, seen: [s(1), s(2)] });
    live.sentences([s(2), s(3)]);
    clock.advance(LIVE_INTERVAL_MS);
    expect(model.fresh(0)).toEqual([3]);
    const user = model.calls[0].r.user as { title: string; context: unknown[] };
    expect(user.title).toBe('Weekly');
    expect(user.context).toHaveLength(2);
    model.calls[0].answer(addTo(3));
    await flush();
    expect(states[states.length - 1].topics[0].points.map((p) => p.n)).toEqual([1, 3]);
  });
});
