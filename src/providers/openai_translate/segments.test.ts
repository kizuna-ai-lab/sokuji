import { describe, it, expect } from 'vitest';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import type { TranslateConfig } from './config';
import { TranslateSegments } from './segments';

function segments(silence: TranslateConfig['silence'] = { sourceMs: 1500, translationMs: 1500, deferMidSentence: false }) {
  // `timers()` counts what has neither fired nor been cancelled: the clock rule's proof that no timer outlives what should end it.
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const s = new TranslateSegments({ clock, silence, sink: events });
  const of = <K extends AdapterEvent['kind']>(k: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === k);
  const texts = (ref: number) => of('segmentText').filter((e) => e.payload.ref === ref).map((e) => e.payload.text);
  const opened = () => of('segmentOpened').map((e) => e.payload);
  const closed = () => of('segmentClosed').map((e) => e.payload);
  const audio = () => of('audio').map((e) => [e.payload.ref, e.payload.range]);
  return { s, clock, timers, log, of, texts, opened, closed, audio };
}
const pcm = (n = 4_800) => new Int16Array(n).fill(900);

describe("OpenAI Translate's segments: each side on its own timer", () => {
  it('opens each side on its first delta, sends the whole text each time, and closes each on its own pause, stating no origin (`OpenAITranslateGAClient.test.ts:146-638`)', () => {
    const { s, clock, timers, texts, opened, closed } = segments({ sourceMs: 700, translationMs: 2500, deferMidSentence: false });
    s.input('こんにちは');
    s.input('、元気');
    expect(opened()).toEqual([{ ref: 1, side: 'source' }]);
    expect(texts(1)).toEqual(['こんにちは', 'こんにちは、元気']);
    clock.advance(699);
    expect(closed()).toEqual([]);
    clock.advance(1);
    expect(closed()).toEqual([{ ref: 1 }]);
    s.output('Hello');
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation' });
    clock.advance(2499);
    expect(closed()).toHaveLength(1);
    clock.advance(1);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(timers()).toBe(0);
  });

  it('keeps one segment while the deltas keep coming, and opens a new one after quiet', () => {
    const { s, clock, timers, texts, opened } = segments();
    s.input('one ');
    clock.advance(1400);
    s.input('two');
    expect(timers()).toBe(1);
    expect(texts(1)).toEqual(['one ', 'one two']);
    clock.advance(1500);
    s.input('again');
    expect(opened().map((o) => o.ref)).toEqual([1, 2]);
  });

  it('times the two sides independently: output text goes to the translation alone', () => {
    const { s, clock, texts, closed } = segments();
    s.input('speaking');
    s.output('translating');
    expect(texts(1)).toEqual(['speaking']);
    expect(texts(2)).toEqual(['translating']);
    clock.advance(1000);
    s.input(' on');
    clock.advance(600);
    expect(closed()).toEqual([{ ref: 2 }]);
  });

  it('opens a new source while the translation of the last one still streams', () => {
    const { s, clock, opened, texts } = segments({ sourceMs: 700, translationMs: 2500, deferMidSentence: false });
    s.input('first');
    s.output('premier');
    clock.advance(700);
    s.input('second');
    s.output(' toujours');
    expect(opened()).toEqual([{ ref: 1, side: 'source' }, { ref: 2, side: 'translation' }, { ref: 3, side: 'source' }]);
    expect(texts(2)).toEqual(['premier', 'premier toujours']);
  });

  it('ignores an empty delta and an empty frame', () => {
    const { s, log, timers } = segments();
    s.input('');
    s.output('');
    s.audio(new Int16Array(0), true);
    expect(log).toEqual([]);
    expect(timers()).toBe(0);
  });
});

describe("OpenAI Translate's segments: the translation's audio", () => {
  it('opens the translation when audio comes before its text (`OpenAITranslateGAClient.test.ts:308-328`), and plays under it', () => {
    const { s, opened, audio, texts } = segments();
    s.audio(pcm(), true);
    expect(opened()).toEqual([{ ref: 1, side: 'translation' }]);
    s.output('Hello');
    s.audio(pcm(), true);
    expect(audio()).toEqual([[1, [0, 0]], [1, [0, 5]]]);
    expect(texts(1)).toEqual(['Hello']);
  });

  it("ranges each frame over the text as it stands when the frame arrives, from the previous frame's end: ascending, never overlapping (ruling 6)", () => {
    const { s, audio } = segments();
    s.output('Hello');
    s.audio(pcm(), true);
    s.output(' there,');
    s.output(' friend.');
    s.audio(pcm(), true);
    s.audio(pcm(), true);
    expect(audio()).toEqual([[1, [0, 5]], [1, [5, 20]], [1, [20, 20]]]);
  });

  it('holds the translation open while its audio plays past its text (`OpenAITranslateGAClient.test.ts:450-471`), and closes it a pause after the last frame', () => {
    const { s, clock, timers, closed } = segments();
    s.output('A long sentence.');
    for (let i = 0; i < 6; i++) {
      clock.advance(500);
      s.audio(pcm(), true);
    }
    expect(closed()).toEqual([]);
    clock.advance(1499);
    expect(closed()).toEqual([]);
    clock.advance(1);
    expect(closed()).toEqual([{ ref: 1 }]);
    expect(timers()).toBe(0);
  });

  it('runs the same segments for audio it does not play, emitting none: Text only changes playback and nothing else (choice 5)', () => {
    const played = segments();
    const silent = segments();
    for (const { s, clock } of [played, silent]) {
      s.output('Hello');
      clock.advance(1000);
      s.audio(pcm(), s === played.s);
      clock.advance(1000);
      s.output(' again');
      clock.advance(1500);
    }
    const shape = (h: ReturnType<typeof segments>) => h.log.filter((e) => e.kind !== 'audio');
    expect(shape(silent)).toEqual(shape(played));
    expect(played.audio()).toEqual([[1, [0, 5]]]);
    expect(silent.audio()).toEqual([]);
  });

  it("opens the next translation for audio that comes after the last one closed, its ranges from 0 (the old client's new item)", () => {
    const { s, clock, opened, audio } = segments();
    s.output('Done.');
    s.audio(pcm(), true);
    clock.advance(1500);
    s.audio(pcm(), true);
    expect(opened().map((o) => o.ref)).toEqual([1, 2]);
    expect(audio()).toEqual([[1, [0, 5]], [2, [0, 0]]]);
  });
});

describe("OpenAI Translate's segments: sentence mode, the .done events, stop", () => {
  it('under sentence mode a mid-sentence pause waits while the text grows, on each side, and closes once it stops (Gemini choice 7)', () => {
    const { s, clock, timers, closed } = segments({ sourceMs: 1000, translationMs: 1000, deferMidSentence: true });
    s.input('He said that');
    s.output('Il a dit que');
    clock.advance(1000);
    expect(closed()).toEqual([]);
    s.input(' we should');
    clock.advance(1000);
    // The translation's tail did not grow: it closes; the source's did, and waits once more.
    expect(closed()).toEqual([{ ref: 2 }]);
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 2 }, { ref: 1 }]);
    expect(timers()).toBe(0);
    s.input('Done.');
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 2 }, { ref: 1 }, { ref: 3 }]);
  });

  it('without sentence mode a mid-sentence pause closes at once', () => {
    const { s, clock, closed } = segments({ sourceMs: 1000, translationMs: 1000, deferMidSentence: false });
    s.input('He said that');
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 1 }]);
  });

  it('closes a side at a .done event, should one come (choice 18), and leaves the other on its timer', () => {
    const { s, clock, timers, closed, opened } = segments();
    s.input('speaking');
    s.output('translating');
    s.done('translation');
    expect(closed()).toEqual([{ ref: 2 }]);
    expect(timers()).toBe(1);
    s.done('translation');
    expect(closed()).toHaveLength(1);
    s.audio(pcm(), true);
    expect(opened().map((o) => o.ref)).toEqual([1, 2, 3]);
    s.done('source');
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 2 }, { ref: 1 }, { ref: 3 }]);
    expect(timers()).toBe(0);
  });

  it("forgets a closed segment's deferred tail, so the next segment on that side gets its own first deferral even with the same tail", () => {
    const { s, clock, closed } = segments({ sourceMs: 1000, translationMs: 1000, deferMidSentence: true });
    s.input('So,');
    clock.advance(1000);
    // Mid-sentence at the first expiry: defers.
    expect(closed()).toEqual([]);
    clock.advance(1000);
    // The tail did not grow since the last expiry: the speaker stopped, closes.
    expect(closed()).toEqual([{ ref: 1 }]);
    s.input('So,');
    clock.advance(1000);
    // A new segment, the same tail: it still gets its own first deferral, not read as unchanged from the last one's.
    expect(closed()).toEqual([{ ref: 1 }]);
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it('stop cancels every timer, a deferred one included, and emits nothing after it', () => {
    const { s, clock, timers, log } = segments({ sourceMs: 1000, translationMs: 1000, deferMidSentence: true });
    s.input('He said that');
    s.output('Translated.');
    clock.advance(1000);
    // The deferral re-armed the source's countdown; the translation, at a sentence end, closed.
    expect(timers()).toBe(1);
    // Content audio reopens the translation and arms its own timer again, so stop has both sides live to cancel.
    s.audio(pcm(), true);
    expect(timers()).toBe(2);
    const n = log.length;
    s.stop();
    expect(timers()).toBe(0);
    clock.advance(10_000);
    s.input('late');
    s.output('late');
    s.audio(pcm(), true);
    s.done('source');
    expect(timers()).toBe(0);
    expect(log.length).toBe(n);
  });
});
