import { describe, it, expect } from 'vitest';
import type { Playing, QueueView } from '../audio/clipQueue';
import type { ClipKey } from '../audio/playback';
import { createVirtualClock } from '../contract/clock';
import type { Leg, Segment } from '../conversation/types';
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
  const listeners = new Set<() => void>();
  const view: QueueView<ClipKey> = {
    position: () => playing,
    get pending() { return pending; },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    view,
    /** A clip starts, ends or the queue clears: the queue tells its listeners. */
    set(next: Playing<ClipKey> | null, n: number) { playing = next; pending = n; listeners.forEach((listener) => listener()); },
    /** Playback moves on without telling anyone. */
    move(t: number) { if (playing) playing = { ...playing, t }; },
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
    expect(litFor({ key: 'speaker:2:0', t: 500 }, legs(segment()))).toEqual({ segmentId: 's:speaker:2', leg: 'speaker', upTo: 3 });
    expect(litFor({ key: 'speaker:2:1', t: 1000 }, legs(segment()))).toMatchObject({ upTo: 13 });
  });

  it('lights nothing for a clip without a range, a segment it cannot find, or audio that names none', () => {
    expect(litFor({ key: 'speaker:2:0', t: 500 }, legs(segment({ speech: [{ pcm: SECOND }] })))).toBeNull();
    expect(litFor({ key: 'speaker:9:0', t: 500 }, legs(segment()))).toBeNull();
    expect(litFor({ key: 'speaker:none:0', t: 500 }, legs(segment()))).toBeNull();
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
});

describe('createKaraoke', () => {
  it('samples positions while clips are queued and someone listens', () => {
    const { clock, queues, karaoke } = setup(segment({ final: false }));
    karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 0 }, 2);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(0);
    queues.speaker.move(500);
    clock.advance(KARAOKE_INTERVAL_MS);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(3);
  });

  it('holds through a gap, and lets go once the segment is final and spoken to its end', () => {
    const { queues, karaoke, setSegment } = setup(segment({ final: false, speech: [{ range: [0, 6], pcm: SECOND }] }));
    karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 1000 }, 1);
    queues.speaker.set(null, 0);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(6);
    setSegment(segment());
    expect(karaoke.get().lit.size).toBe(0);
  });

  it('names the segment a replay is playing, and ends with the replay', () => {
    const { queues, karaoke } = setup(segment());
    karaoke.subscribe(() => {});
    queues.replay.set({ key: 'speaker:2:0', t: 0 }, 2);
    expect(karaoke.get().replaying).toBe('s:speaker:2');
    queues.replay.set(null, 0);
    expect(karaoke.get()).toMatchObject({ replaying: null });
    expect(karaoke.get().lit.size).toBe(0);
  });

  it('reads nothing while no one listens', () => {
    const { clock, queues, karaoke } = setup(segment({ final: false }));
    const off = karaoke.subscribe(() => {});
    queues.speaker.set({ key: 'speaker:2:0', t: 0 }, 2);
    off();
    queues.speaker.move(500);
    clock.advance(KARAOKE_INTERVAL_MS * 5);
    expect(karaoke.get().lit.get('s:speaker:2')).toBe(0);
  });
});
