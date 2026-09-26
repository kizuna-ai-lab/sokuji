import { describe, it, expect } from 'vitest';
import type { Playing, QueueView } from '../audio/clipQueue';
import type { ClipKey } from '../audio/playback';
import { createVirtualClock } from '../contract/clock';
import type { Leg, Segment } from '../conversation/types';
import { EMPTY_PCM } from '../conversation/types';
import type { Readable } from './conversationView';
import { createKaraoke, KARAOKE_INTERVAL_MS, litFor, nextLit, type QueueName } from './karaoke';

const SECOND = new Int16Array(24_000);
// 13 characters: こんにちは、お元気ですか？
const TEXT = 'こんにちは、お元気ですか？';
const segment = (over: Partial<Segment> = {}): Segment => ({
  id: 's:speaker:2', ref: 2, side: 'translation', text: TEXT, final: true, openedAt: 0, marks: [],
  speech: [{ range: [0, 6], pcm: SECOND }, { range: [6, 13], pcm: SECOND }],
  ...over,
});
const legs = (s: Segment): readonly Leg[] => [{ leg: 'speaker', session: 's', languages: { source: 'en', target: 'ja' }, segments: [s], notices: [] }];

function fakeQueue() {
  let playing: Playing<ClipKey> | null = null;
  let pending = 0;
  let clears = 0;
  const listeners = new Set<() => void>();
  const view: QueueView<ClipKey> = {
    position: () => playing,
    get pending() { return pending; },
    get clears() { return clears; },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    view,
    /** A clip starts or ends: the queue tells its listeners. */
    set(next: Playing<ClipKey> | null, n: number) { playing = next; pending = n; listeners.forEach((listener) => listener()); },
    /** Playback moves on without telling anyone. */
    move(t: number) { if (playing) playing = { ...playing, t }; },
    /** The queue was cleared (Stop): stops what plays, drops what is queued, and counts. */
    clear() { playing = null; pending = 0; clears += 1; listeners.forEach((listener) => listener()); },
  };
}

function setup(s: Segment) {
  const clock = createVirtualClock(0);
  const queues = { speaker: fakeQueue(), participant: fakeQueue(), replay: fakeQueue() };
  let current = legs(s);
  const listeners = new Set<() => void>();
  const view: Readable<{ legs: readonly Leg[] }> = {
    get: () => ({ legs: current }),
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const karaoke = createKaraoke(
    { speaker: queues.speaker.view, participant: queues.participant.view, replay: queues.replay.view } as Record<QueueName, QueueView<ClipKey>>,
    view,
    clock,
  );
  const setSegment = (next: Segment) => { current = legs(next); listeners.forEach((listener) => listener()); };
  return { clock, queues, karaoke, setSegment };
}

describe('litFor', () => {
  it("lights a clip's range in proportion to how far into the clip playback is", () => {
    expect(litFor({ key: 'speaker:2:0', t: 500, ms: 1000 }, legs(segment()))).toEqual({ segmentId: 's:speaker:2', leg: 'speaker', upTo: 3 });
    expect(litFor({ key: 'speaker:2:1', t: 1000, ms: 1000 }, legs(segment()))).toMatchObject({ upTo: 13 });
  });

  it('lights nothing for a clip without a range, a segment it cannot find, or audio that names none', () => {
    expect(litFor({ key: 'speaker:2:0', t: 500, ms: 1000 }, legs(segment({ speech: [{ pcm: SECOND }] })))).toBeNull();
    expect(litFor({ key: 'speaker:9:0', t: 500, ms: 1000 }, legs(segment()))).toBeNull();
    expect(litFor({ key: 'speaker:none:0', t: 500, ms: 1000 }, legs(segment()))).toBeNull();
  });

  it('sweeps proportionally from the queue\'s ms even when retention dropped the clip\'s pcm (the default: "Keep audio for replay" off)', () => {
    const dropped = segment({ speech: [{ range: [0, 8], pcm: EMPTY_PCM }] });
    expect(litFor({ key: 'speaker:2:0', t: 250, ms: 1000 }, legs(dropped))).toEqual({ segmentId: 's:speaker:2', leg: 'speaker', upTo: 2 });
  });

  it('lights the whole range at once for a clip with no duration', () => {
    expect(litFor({ key: 'speaker:2:0', t: 0, ms: 0 }, legs(segment()))).toEqual({ segmentId: 's:speaker:2', leg: 'speaker', upTo: 6 });
  });
});

describe('nextLit in a gap', () => {
  const prev = { segmentId: 's:speaker:2', leg: 'speaker' as const, upTo: 6 };

  it('holds while the segment is open', () => {
    expect(nextLit(prev, null, legs(segment({ final: false, speech: [{ range: [0, 6], pcm: SECOND }] })))).toBe(prev);
  });

  it('holds while the speech has not reached its last letter', () => {
    expect(nextLit(prev, null, legs(segment({ speech: [{ range: [0, 6], pcm: SECOND }] })))).toBe(prev);
  });

  it('ends once the segment is final and its speech reached its last letter', () => {
    expect(nextLit(prev, null, legs(segment()))).toBeNull();
    // Only the closing punctuation is left unspoken: that is the end.
    expect(nextLit(prev, null, legs(segment({ speech: [{ range: [0, 6], pcm: SECOND }, { range: [6, 12], pcm: SECOND }] })))).toBeNull();
  });

  it('ends when the segment kept pcm but every range was dropped (a letters-changed rewrite): the held offset would name the old text', () => {
    expect(nextLit(prev, null, legs(segment({ final: false, speech: [{ pcm: SECOND }] })))).toBeNull();
  });

  it('holds via the reached-based rule when only some ranges were dropped, not every one', () => {
    expect(nextLit(prev, null, legs(segment({ speech: [{ range: [0, 6], pcm: SECOND }, { pcm: SECOND }] })))).toBe(prev);
  });

  it("clamps a held upTo to the segment's current, shorter text", () => {
    const shorter = segment({ final: false, text: 'あい', speech: [{ range: [0, 1], pcm: SECOND }] });
    expect(nextLit(prev, null, legs(shorter))).toEqual({ segmentId: 's:speaker:2', leg: 'speaker', upTo: 2 });
  });
});

describe('createKaraoke', () => {
  it('samples positions while clips are queued and someone listens', () => {
    const { clock, queues, karaoke } = setup(segment({ final: false }));
    karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 0, ms: 1000 }, 2);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(0);
    queues.speaker.move(500);
    clock.advance(KARAOKE_INTERVAL_MS);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(3);
  });

  it('holds through a gap, and lets go once the segment is final and spoken to its end', () => {
    const { queues, karaoke, setSegment } = setup(segment({ final: false, speech: [{ range: [0, 6], pcm: SECOND }] }));
    karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 1000, ms: 1000 }, 1);
    queues.speaker.set(null, 0);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(6);
    setSegment(segment());
    expect(karaoke.get().lit.size).toBe(0);
  });

  it('ends a hold when the queue is cleared (Stop mid-speech), rather than keeping it lit until the next Start', () => {
    const { queues, karaoke } = setup(segment({ final: false, speech: [{ range: [0, 6], pcm: SECOND }] }));
    karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 1000, ms: 1000 }, 1);
    queues.speaker.set(null, 0);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(6);
    queues.speaker.clear();
    expect(karaoke.get().lit.size).toBe(0);
  });

  it('names the segment a replay is playing, and ends with the replay', () => {
    const { queues, karaoke } = setup(segment());
    karaoke.subscribe(() => {});
    queues.replay.set({ key: 'speaker:2:0', t: 0, ms: 1000 }, 2);
    expect(karaoke.get().replaying).toBe('s:speaker:2');
    queues.replay.set(null, 0);
    expect(karaoke.get()).toMatchObject({ replaying: null });
    expect(karaoke.get().lit.size).toBe(0);
  });

  it('reads nothing while no one listens', () => {
    const { clock, queues, karaoke } = setup(segment({ final: false }));
    const off = karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 0, ms: 1000 }, 2);
    off();
    queues.speaker.move(500);
    clock.advance(KARAOKE_INTERVAL_MS * 5);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(0);
  });

  it('lights a playing clip only once its range is filled in, from where playback is (ruling 2)', () => {
    const { clock, queues, karaoke, setSegment } = setup(segment({ speech: [{ pcm: SECOND }, { pcm: SECOND }] }));
    karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 500, ms: 1000 }, 2);
    expect(karaoke.get().lit.size).toBe(0);                    // (a): no range, not highlighted
    setSegment(segment({ speech: [{ range: [0, 6], pcm: SECOND }, { range: [6, 13], pcm: SECOND }] }));
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(3);      // mid-clip: half of [0, 6]
    queues.speaker.move(1000);
    clock.advance(KARAOKE_INTERVAL_MS);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(6);
  });

  it("keeps a lit sentence lit while the row's next, rangeless clip plays, and sweeps on once that clip's range is filled in (choice 18)", () => {
    const { queues, karaoke, setSegment } = setup(segment({ speech: [{ range: [0, 6], pcm: SECOND }, { pcm: SECOND }] }));
    karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 1000, ms: 1000 }, 2);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(6);      // sentence A spoken, lit
    queues.speaker.set({ key: 'speaker:2:1', t: 0, ms: 1000 }, 1);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(6);      // B plays rangeless: A stays lit
    queues.speaker.move(500);
    setSegment(segment({ speech: [{ range: [0, 6], pcm: SECOND }, { range: [6, 13], pcm: SECOND }] }));
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(10);     // B's fill-in: from mid-clip, 6 + round(7 × 0.5)
  });

  it('a fill-in that lands after the queue emptied lights nothing live; a replay lights it', () => {
    const { queues, karaoke, setSegment } = setup(segment({ speech: [{ pcm: SECOND }] }));
    karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 0, ms: 1000 }, 1);
    queues.speaker.set(null, 0);                               // played out before its range arrived
    setSegment(segment({ speech: [{ range: [0, 13], pcm: SECOND }] }));
    expect(karaoke.get().lit.size).toBe(0);                    // nothing plays, nothing was lit: nothing to hold
    queues.replay.set({ key: 'speaker:2:0', t: 500, ms: 1000 }, 1);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(7);      // replay reads the filled range: round(13 × 0.5)
  });
});

describe('nextLit while a rangeless clip plays', () => {
  const prev = { segmentId: 's:speaker:2', leg: 'speaker' as const, upTo: 6 };
  const B: Playing<ClipKey> = { key: 'speaker:2:1', t: 0, ms: 1000 };

  it("holds prev while a rangeless clip of prev's segment plays", () => {
    expect(nextLit(prev, B, legs(segment({ speech: [{ range: [0, 6], pcm: SECOND }, { pcm: SECOND }] })))).toBe(prev);
  });

  it('lights nothing for a rangeless clip of another segment', () => {
    const two: readonly Leg[] = [{
      ...legs(segment())[0],
      segments: [segment({ speech: [{ range: [0, 6], pcm: SECOND }, { pcm: SECOND }] }), segment({ id: 's:speaker:4', ref: 4, speech: [{ pcm: SECOND }] })],
    }];
    expect(nextLit(prev, { key: 'speaker:4:0', t: 0, ms: 1000 }, two)).toBeNull();
  });

  it('the hold keeps the gap rules: it ends when every range was dropped, and clamps to a shorter text', () => {
    expect(nextLit(prev, B, legs(segment({ speech: [{ pcm: SECOND }, { pcm: SECOND }] })))).toBeNull();
    expect(nextLit(prev, B, legs(segment({ text: 'あいう', final: false, speech: [{ range: [0, 1], pcm: SECOND }, { pcm: SECOND }] })))).toEqual({ ...prev, upTo: 3 });
  });
});
