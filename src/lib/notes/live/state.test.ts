// The live notes' state and the program's rules that fold an answer into it.
import { describe, it, expect } from 'vitest';
import { applyLive, emptyLive, livePayload, type LiveSentence, type LiveState } from './state';

const s = (n: number, o: Partial<LiveSentence> = {}): LiveSentence => ({
  n, side: 'other', sideCertain: true, track: 'other', speaker: '1.1', startMs: n * 10_000, endMs: n * 10_000 + 8_000,
  text: `sentence ${n}`, timeKind: 'given', fromOpen: false, ...o,
});
const label = (x: LiveSentence) => (x.side === 'mine' ? 'My side' : x.speaker === '1.2' ? 'Other side 2' : 'Other side 1');
const apply = (state: LiveState, answer: unknown, fresh: LiveSentence[], seen: LiveSentence[] = fresh) =>
  applyLive(state, answer, { fresh, seen, speakerLabel: label });
const texts = (st: LiveState | null) => st?.topics.map((t) => [t.title, t.points.map((p) => p.text)]);

const opened = (): LiveState => apply(emptyLive(), { title: 'Weekly', new_topic: { title: 'Delivery', summary: 'd', points: [{ text: 'Ships Tuesday', sid: 1, kinds: ['decision'] }] } }, [s(1)])!;

describe('the live notes rules', () => {
  it('opens the first topic with its points, and adds to the open topic after that', () => {
    const one = opened();
    expect(one.title).toBe('Weekly');
    expect(one.topics[0].points[0]).toEqual({ n: 1, text: 'Ships Tuesday', kinds: ['decision'] });
    const two = apply(one, { current_topic: { summary: 'd2', add: [{ text: 'Boxes redone', sid: 2, kinds: [] }] } }, [s(2)])!;
    expect(texts(two)).toEqual([['Delivery', ['Ships Tuesday', 'Boxes redone']]]);
    expect(two.topics[0].summary).toBe('d2');
  });

  it('opens a new topic and freezes the old one; a title without points opens nothing', () => {
    const two = apply(opened(), { new_topic: { title: 'Budget', summary: 'b', points: [{ text: 'Travel down', sid: 2, kinds: [] }] } }, [s(2)])!;
    expect(texts(two)).toEqual([['Delivery', ['Ships Tuesday']], ['Budget', ['Travel down']]]);
    expect(apply(opened(), { new_topic: { title: 'Nothing', points: [] } }, [s(2)])).toEqual(opened());
  });

  it('closes a topic at 12 points: the payload shows it just closed, and the next points open a new topic', () => {
    let st = opened();
    for (let n = 2; n <= 12; n++) st = apply(st, { current_topic: { add: [{ text: `p${n}`, sid: n, kinds: [] }] } }, [s(n)])!;
    expect(st.topics[0].points).toHaveLength(12);
    const payload = livePayload({ state: st, fresh: [s(13)], seen: [s(13)], language: { code: 'en' }, speakerLabel: label }) as Record<string, unknown>;
    expect(payload.current_topic).toBeNull();
    expect(payload.just_closed).toEqual({ title: 'Delivery', summary: 'd' });
    const next = apply(st, { new_topic: { title: 'Delivery', summary: 'more', points: [{ text: 'p13', sid: 13, kinds: [] }] } }, [s(13)])!;
    expect(texts(next)?.map((t) => t[0])).toEqual(['Delivery', 'Delivery (2)']);
  });

  it('keeps the same text once, and moves a point whose sentence is not new to the nearest new one', () => {
    const st = apply(opened(), { current_topic: { add: [
      { text: 'Ships Tuesday', sid: 2, kinds: [] }, { text: 'Far', sid: 99, kinds: [] }, { text: 'No number', kinds: [] },
    ] } }, [s(2), s(3)])!;
    expect(st.topics[0].points.slice(1)).toEqual([
      { n: 3, text: 'Far', kinds: [], anchorMoved: true },
      { n: 2, text: 'No number', kinds: [], anchorMoved: true },
    ]);
  });

  it('withdraws a to-do by its id, keeping the text', () => {
    const st = apply(opened(), { current_topic: { add: [{ text: 'Send the draft', sid: 2, kinds: ['todo'], owner: null, due: 'Friday' }] } }, [s(2)])!;
    const payload = livePayload({ state: st, fresh: [s(3)], seen: [s(2), s(3)], language: { code: 'en' }, speakerLabel: label }) as { todos: unknown };
    expect(payload.todos).toEqual([{ id: 't1', text: 'Send the draft' }]);
    const after = apply(st, { withdraw: ['t1'] }, [s(3)], [s(2), s(3)])!;
    expect(after.topics[0].points[1]).toMatchObject({ text: 'Send the draft', kinds: [], wasTodo: true });
  });

  it("cuts an owner that is a speaker's label to the side, and empties it where the side was inferred", () => {
    const fresh = [s(2, { speaker: '1.2' }), s(3, { side: 'mine', speaker: '1', sideCertain: false })];
    const st = apply(opened(), { current_topic: { add: [
      { text: 'A', sid: 2, kinds: ['todo'], owner: 'Other side 2' }, { text: 'B', sid: 3, kinds: ['todo'], owner: 'My side' },
      { text: 'C', sid: 2, kinds: ['todo'], owner: 'Bob' },
    ] } }, fresh)!;
    expect(st.topics[0].points.slice(1).map((p) => p.owner)).toEqual(['Other side', null, 'Bob']);
  });

  it('marks a point written from text the recognizer had not finished', () => {
    const st = apply(opened(), { current_topic: { add: [{ text: 'Open', sid: 2, kinds: [] }] } }, [s(2, { fromOpen: true })])!;
    expect(st.topics[0].points[1]).toEqual({ n: 2, text: 'Open', kinds: [], unstable: true });
  });

  it('adds an earlier point to a closed topic', () => {
    const two = apply(opened(), { new_topic: { title: 'Budget', points: [{ text: 'Travel down', sid: 2, kinds: [] }] } }, [s(2)])!;
    const st = apply(two, { earlier: [{ topic: 1, text: 'Also Wednesday', sid: 3 }] }, [s(3)])!;
    expect(texts(st)).toEqual([['Delivery', ['Ships Tuesday', 'Also Wednesday']], ['Budget', ['Travel down']]]);
  });

  it('gives back null for an answer it cannot use, and never changes the state it was given', () => {
    const before = opened();
    const copy = structuredClone(before);
    expect(apply(emptyLive(), { current_topic: { add: [{ text: 'x', sid: 1 }] } }, [s(1)])).toBeNull();
    apply(before, { current_topic: { add: [{ text: 'y', sid: 2, kinds: [] }] } }, [s(2)]);
    expect(before).toEqual(copy);
  });

  it("builds the script's payload: notes so far in short form, context, the new sentences and how many points may come", () => {
    const st = apply(opened(), { new_topic: { title: 'Budget', summary: 'b', points: [{ text: 'Risky', sid: 2, kinds: ['risk'] }] } }, [s(2)])!;
    const seen = [s(1), s(2), s(3), s(4), s(5, { startMs: 60_000 })];
    expect(livePayload({ state: st, fresh: [s(5, { startMs: 60_000 })], seen, language: { code: 'ja' }, speakerLabel: label })).toEqual({
      output_language: 'ja',
      title: 'Weekly',
      closed_topics: [{ n: 1, title: 'Delivery' }],
      current_topic: { title: 'Budget', summary: 'b', points: [{ text: 'Risky', kinds: ['risk'] }] },
      recorded: { decisions: ['Ships Tuesday'], risks: [] },
      context: [2, 3, 4].map((n) => ({ speaker: 'Other side 1', text: `sentence ${n}` })),
      new: [{ sid: 5, speaker: 'Other side 1', text: 'sentence 5', pause_before_s: 12 }],
      todos: [],
      max_points: 1,
    });
  });
});
