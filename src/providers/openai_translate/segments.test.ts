import { describe, it, expect } from 'vitest';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { trackedClock } from '../../lib/contract/testing/trackedClock';
import { MID_SENTENCE_HOLD_MS } from '../../lib/segmentation/continuousSegments';
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
/** A frame at the stream's noise floor: RMS 0.0009, as the spike's near-silent frames measured. */
const floor = (n = 4_800) => new Int16Array(n).fill(30);

describe("OpenAI Translate's segments: the source on its own timer, the translation at its cuts", () => {
  it("opens each side on its first delta and sends the whole text each time; the source closes on its own pause, and the translation states that source as its origin (`OpenAITranslateGAClient.test.ts:146-638`; Stage 2 translation cuts, ruling 2)", () => {
    const { s, clock, timers, texts, opened, closed } = segments({ sourceMs: 700, translationMs: 2500, deferMidSentence: false });
    s.input('こんにちは');
    s.input('、元気');
    expect(opened()).toEqual([{ ref: 1, side: 'source', origin: 's1' }]);
    expect(texts(1)).toEqual(['こんにちは', 'こんにちは、元気']);
    clock.advance(699);
    expect(closed()).toEqual([]);
    clock.advance(1);
    expect(closed()).toEqual([{ ref: 1 }]);
    s.output('Hello.');
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
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

  it('sends output text to the translation alone, which with no cut owed waits for the source still open, then has its pause (translation cuts, choice 7)', () => {
    const { s, clock, texts, closed } = segments();
    s.input('speaking');
    s.output('translating.');
    expect(texts(1)).toEqual(['speaking']);
    expect(texts(2)).toEqual(['translating.']);
    clock.advance(1000);
    s.input(' on');
    clock.advance(600);
    expect(closed()).toEqual([]);
    clock.advance(900);
    expect(closed()).toEqual([{ ref: 1 }]);
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it('opens a new source while the translation of the last one still streams, and cuts that translation only at its sentence end', () => {
    const { s, clock, opened, texts } = segments({ sourceMs: 700, translationMs: 2500, deferMidSentence: false });
    s.input('first');
    s.output('premier');
    clock.advance(700);
    s.input('second');
    s.output(' toujours');
    expect(opened()).toEqual([{ ref: 1, side: 'source', origin: 's1' }, { ref: 2, side: 'translation', origin: 's1' }, { ref: 3, side: 'source', origin: 's3' }]);
    expect(texts(2)).toEqual(['premier', 'premier toujours']);
    s.output('.');
    s.output(' Deuxième');
    expect(opened()[3]).toEqual({ ref: 4, side: 'translation', origin: 's3' });
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

  it('a frame at the noise floor neither opens the translation nor holds it open: it plays inside one and is dropped outside one, as a heartbeat is (Stage 2 translation cuts, choice 11)', () => {
    const { s, clock, timers, opened, closed, audio } = segments();
    s.audio(floor(), true);
    expect(opened()).toEqual([]);
    expect(audio()).toEqual([]);
    expect(timers()).toBe(0);
    s.output('Hello.');
    s.audio(floor(), true);
    expect(audio()).toEqual([[1, [0, 6]]]);
    // Its pause runs from the delta: the floor's frames after it hold nothing.
    clock.advance(1000);
    s.audio(floor(), true);
    clock.advance(500);
    expect(closed()).toEqual([{ ref: 1 }]);
    s.audio(floor(), true);
    expect(opened()).toHaveLength(1);
    expect(audio()).toEqual([[1, [0, 6]], [1, [6, 6]]]);
    expect(timers()).toBe(0);
  });
});

describe("OpenAI Translate's segments: sentence mode, the .done events, stop", () => {
  it("under sentence mode the source's mid-sentence pause waits while its text grows (Gemini choice 7); the translation's mid-sentence hold is its own, in every mode (translation cuts, choice 6)", () => {
    const { s, clock, timers, closed } = segments({ sourceMs: 1000, translationMs: 1000, deferMidSentence: true });
    s.input('He said that');
    clock.advance(1000);
    expect(closed()).toEqual([]);
    s.input(' we should');
    clock.advance(1000);
    expect(closed()).toEqual([]);
    clock.advance(1000);
    // Its tail stopped growing: it closes.
    expect(closed()).toEqual([{ ref: 1 }]);
    s.output('Il a dit. Et que');
    // The translation stops mid-sentence, its stream having shown a sentence end: not the source's deferral, which would close it at its second window,
    // but its own hold, to 5 s after its last activity.
    clock.advance(2000);
    expect(closed()).toEqual([{ ref: 1 }]);
    clock.advance(MID_SENTENCE_HOLD_MS - 2000);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(timers()).toBe(0);
    s.input('Done.');
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }]);
  });

  it('without sentence mode a mid-sentence pause closes at once', () => {
    const { s, clock, closed } = segments({ sourceMs: 1000, translationMs: 1000, deferMidSentence: false });
    s.input('He said that');
    clock.advance(1000);
    expect(closed()).toEqual([{ ref: 1 }]);
  });

  it("closes the source at its .done, should one come (choice 18), owing its cut; the translation's .done settles it as its quiet would (translation cuts, choice 13)", () => {
    const { s, clock, timers, closed, opened } = segments();
    s.input('speaking');
    s.output('translating');
    s.done('translation');
    // No cut owed, its source still open: it waits for that source.
    expect(closed()).toEqual([]);
    s.done('source');
    expect(closed()).toEqual([{ ref: 1 }]);
    s.done('translation');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    s.done('translation');
    expect(closed()).toHaveLength(2);
    s.audio(pcm(), true);
    expect(opened().map((o) => o.ref)).toEqual([1, 2, 3]);
    // Audio with no text, in a stream that has shown no sentence end: its pause closes it, as the rest of the source that closed last.
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3, origin: 's1' }]);
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
    // The deferral re-armed the source's countdown; the translation, at a sentence end with no cut owed, waits for that source with no timer of its own.
    expect(timers()).toBe(1);
    // Content audio holds the translation open and arms its own timer again, so stop has both sides live to cancel.
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
