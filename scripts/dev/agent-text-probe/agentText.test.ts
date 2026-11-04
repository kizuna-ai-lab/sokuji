import { describe, expect, it } from 'vitest';
import { createVirtualClock } from '../../../src/lib/contract/clock';
import { AgentTextPlanner, type AgentSend, type Condition } from './agentText';

/** A planner on a virtual clock whose session began at 1000; each send recorded with its session time. */
function planner(condition: Condition, o: { leadMs?: number; closeSegments?: boolean } = {}) {
  const clock = createVirtualClock(1000);
  const sent: Array<AgentSend & { at: number }> = [];
  const p = new AgentTextPlanner({ condition, leadMs: o.leadMs ?? 700, closeSegments: o.closeSegments ?? true, clock, t0: 1000, send: (s) => sent.push({ ...s, at: clock.now() - 1000 }) });
  return { p, clock, sent, texts: () => sent.map((s) => (s.end ? `<${s.voice} end>` : s.text)) };
}

const ROW = 'Hello there. How are you?';

describe('AgentTextPlanner: none', () => {
  it('sends nothing, whatever happens', () => {
    const h = planner('none');
    h.p.speak('speaker', 1, ROW, [0, ROW.length]);
    h.p.endUtterance('speaker');
    h.p.enqueue('speaker', 1, ROW, [0, 5], 100);
    h.p.fillIn('speaker', 1, ROW, [0, 12], 100);
    h.p.idle('speaker');
    h.clock.advance(5000);
    expect(h.sent).toEqual([]);
  });
});

describe('AgentTextPlanner: speak', () => {
  it('sends the text handed to synthesis at once, and ends the segment at the end of the utterance', () => {
    const h = planner('speak');
    h.clock.advance(200);
    h.p.speak('speaker', 1, 'Hello there.', [0, 12]);
    h.p.speak('speaker', 1, ' How are you?', [12, 25]);
    h.clock.advance(300);
    h.p.endUtterance('speaker');
    expect(h.sent).toEqual([
      { voice: 'speaker', ref: 1, span: [0, 12], text: 'Hello there.', end: false, at: 200 },
      { voice: 'speaker', ref: 1, span: [12, 25], text: ' How are you?', end: false, at: 200 },
      { voice: 'speaker', text: '', end: true, at: 500 },
    ]);
  });

  it('ignores the chunk and queue hooks, and ends no segment it never opened', () => {
    const h = planner('speak');
    h.p.enqueue('speaker', 1, ROW, [0, 5], 100);
    h.p.idle('speaker');
    h.p.endUtterance('participant');
    expect(h.sent).toEqual([]);
  });

  it('with segment ends off, never sends end_of_segment', () => {
    const h = planner('speak', { closeSegments: false });
    h.p.speak('speaker', 1, 'Hi.', [0, 3]);
    h.p.endUtterance('speaker');
    expect(h.texts()).toEqual(['Hi.']);
  });
});

describe('AgentTextPlanner: enqueue', () => {
  it("sends each queued chunk's provisional text as it is queued, never twice, and ends the segment when the voice's queue goes idle", () => {
    const h = planner('enqueue');
    h.clock.advance(100);
    h.p.enqueue('speaker', 1, ROW, [0, 6], 150);
    // A chunk with no range yet: nothing to send.
    h.p.enqueue('speaker', 1, ROW, undefined, 500);
    h.clock.advance(100);
    // Overlapping what was sent: only the rest goes.
    h.p.enqueue('speaker', 1, ROW, [3, 13], 900);
    h.p.idle('speaker');
    expect(h.sent).toEqual([
      { voice: 'speaker', ref: 1, span: [0, 6], text: 'Hello ', end: false, at: 100 },
      { voice: 'speaker', ref: 1, span: [6, 13], text: 'there. ', end: false, at: 200 },
      { voice: 'speaker', text: '', end: true, at: 200 },
    ]);
  });

  it('sends a fill-in beyond what the provisional ranges reached, and nothing a fill-in already covers', () => {
    const h = planner('enqueue');
    h.p.enqueue('speaker', 1, ROW, [0, 10], 100);
    h.p.fillIn('speaker', 1, ROW, [0, 12], 100);
    h.p.fillIn('speaker', 1, ROW, [12, 25], 400);
    h.p.fillIn('speaker', 1, ROW, [12, 25], 400);
    expect(h.texts()).toEqual(['Hello ther', 'e.', ' How are you?']);
    expect(h.p.stats.fillInTexts).toBe(2);
  });

  it('keeps each voice to its own text, and counts the sends and ends that interleave with the other voice', () => {
    const h = planner('enqueue');
    h.p.enqueue('speaker', 1, ROW, [0, 5], 100);
    h.p.enqueue('participant', 2, '你好。', [0, 3], 100);
    h.p.enqueue('speaker', 1, ROW, [5, 12], 400);
    h.p.idle('participant');
    h.p.idle('speaker');
    expect(h.texts()).toEqual(['Hello', '你好。', ' there.', '<participant end>', '<speaker end>']);
    expect(h.p.stats).toMatchObject({ texts: 3, ends: 2, interleaved: 2, endsWhileOtherOpen: 1 });
  });
});

describe('AgentTextPlanner: lead', () => {
  it('sends each chunk at its play time minus the lead, at once when that is past', () => {
    const h = planner('lead', { leadMs: 700 });
    h.clock.advance(100);
    // Plays at 150: its send time (-550) is past.
    h.p.enqueue('speaker', 1, ROW, [0, 6], 150);
    // Plays at 2000: sent at 1300.
    h.p.enqueue('speaker', 1, ROW, [6, 13], 2000);
    expect(h.sent.map((s) => [s.text, s.at, s.playAt])).toEqual([['Hello ', 100, 150]]);
    h.clock.advance(1199);
    expect(h.sent).toHaveLength(1);
    h.clock.advance(1);
    expect(h.sent.map((s) => [s.text, s.at, s.playAt])).toEqual([['Hello ', 100, 150], ['there. ', 1300, 2000]]);
  });

  it("at idle, sends what is still timed before the segment's end", () => {
    const h = planner('lead', { leadMs: 700 });
    h.p.enqueue('participant', 3, '你好。', [0, 3], 5000);
    h.clock.advance(1000);
    h.p.idle('participant');
    expect(h.sent.map((s) => [s.end ? 'end' : s.text, s.at])).toEqual([['你好。', 1000], ['end', 1000]]);
    h.clock.advance(10_000);
    expect(h.sent).toHaveLength(2);
  });

  it('sends nothing more once stopped', () => {
    const h = planner('lead', { leadMs: 700 });
    h.p.enqueue('speaker', 1, ROW, [0, 6], 5000);
    h.p.stop();
    h.clock.advance(10_000);
    h.p.idle('speaker');
    expect(h.sent).toEqual([]);
  });
});
