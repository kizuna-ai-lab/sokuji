import { describe, it, expect } from 'vitest';
import { recordEvents, type AdapterEvent } from '../contract/events';
import { trackedClock } from '../contract/testing/trackedClock';
import {
  atSentenceEnd, ContinuousSegments, countSentenceEnds, endsSentenceAt, MID_SENTENCE_HOLD_MS, type ContinuousSegmentsOptions, type CutSummary,
} from './continuousSegments';
import { RECORDINGS, replay, type RecordedEvent, type Recording } from './recordings/replay.testing';

const SILENCE: ContinuousSegmentsOptions['silence'] = { sourceMs: 1500, translationMs: 1500, deferMidSentence: false };

function segments(silence = SILENCE, showSource?: (text: string) => string, holdMidSentence?: boolean, countSource?: (text: string) => number) {
  // `timers()` counts what has neither fired nor been cancelled: the clock rule's proof that no timer outlives what should end it.
  const { clock, timers } = trackedClock();
  const { events, log } = recordEvents();
  const cuts: CutSummary[] = [];
  const s = new ContinuousSegments({ clock, silence, sink: events, showSource, holdMidSentence, countSource, cut: (c) => cuts.push(c) });
  const of = <K extends AdapterEvent['kind']>(k: K) => log.filter((e): e is Extract<AdapterEvent, { kind: K }> => e.kind === k);
  const texts = (ref: number) => of('segmentText').filter((e) => e.payload.ref === ref).map((e) => e.payload.text);
  const opened = () => of('segmentOpened').map((e) => e.payload);
  const closed = () => of('segmentClosed').map((e) => e.payload);
  const audio = () => of('audio').map((e) => [e.payload.ref, e.payload.range]);
  /** Advances the clock to `at`, from wherever it stands. */
  const at = (ms: number) => clock.advance(ms - clock.now());
  return { s, clock, timers, log, cuts, of, texts, opened, closed, audio, at };
}
const pcm = () => new Int16Array(4_800).fill(900);
const ACTIVE = { play: true, active: true };
const INACTIVE = { play: true, active: false };

describe('sentence ends (translation cuts, ruling 1; choice 3)', () => {
  it(`holds a translation that stops mid-sentence for ${MID_SENTENCE_HOLD_MS} ms after its last activity (choice 6)`, () => {
    expect(MID_SENTENCE_HOLD_MS).toBe(5_000);
  });

  it('counts a CJK 。？！ wherever it stands, and a Latin .?! only before whitespace or at the end — not "1.5", not "U.S"', () => {
    expect(countSentenceEnds('今天。好吗？是的！')).toBe(3);
    expect(countSentenceEnds('「行こう。」と言った。')).toBe(2);
    expect(countSentenceEnds('It costs 1.5 dollars.')).toBe(1);
    expect(countSentenceEnds('The U.S economy grew.')).toBe(1);
    // "?!" ends once, at its last mark; the ellipsis before a lowercase word ends nothing (rule C).
    expect(countSentenceEnds('Really?! Yes... fine')).toBe(1);
    expect(countSentenceEnds('No end here')).toBe(0);
    expect(countSentenceEnds('')).toBe(0);
  });

  it("counts the other scripts' own marks wherever they stand, as the CJK ones", () => {
    // Devanagari and Bengali, Urdu, Arabic, Burmese, Armenian, Ethiopic, fullwidth and halfwidth, then Khmer.
    expect(countSentenceEnds('यह पहला है। यह दूसरा है॥')).toBe(2);
    expect(countSentenceEnds('یہ پہلا ہے۔ کیا یہ دوسرا ہے؟')).toBe(2);
    expect(countSentenceEnds('ပထမ။ ဒုတိယ။')).toBe(2);
    expect(countSentenceEnds('Առաջին։ Երկրորդ։')).toBe(2);
    expect(countSentenceEnds('አንድ። ሁለት።')).toBe(2);
    expect(countSentenceEnds('一つ目．二つ目｡')).toBe(2);
    // Khmer.
    expect(countSentenceEnds('ប្រយោគទីមួយ។ ទីពីរ៕')).toBe(2);
    // Thai writes none.
    expect(countSentenceEnds('ประโยคแรก ประโยคที่สอง')).toBe(0);
  });

  it('is one rule: the mark at a place in a text — an end, none, or, for a Latin mark with nothing after it yet, what follows decides', () => {
    expect(endsSentenceAt('今天。x', 2)).toBe(true);
    expect(endsSentenceAt('ठीक।', 3)).toBe(true);
    expect(endsSentenceAt('Done. Now', 4)).toBe(true);
    expect(endsSentenceAt('It is 1.5', 7)).toBe(false);
    expect(endsSentenceAt('Done.', 4)).toBe(undefined);
    expect(endsSentenceAt('Well,', 4)).toBe(false);
  });

  it("reads abbreviations, initials and ellipses by the owner's rule C: a title or an initial never ends a sentence; another abbreviation or an ellipsis ends one when the next word is capitalised", () => {
    // Titles before a name, "vs." and "cf.", and single capital initials: never an end.
    expect(countSentenceEnds('Mr. Smith arrived at noon.')).toBe(1);
    expect(countSentenceEnds('I went to see Dr. Wang today.')).toBe(1);
    expect(countSentenceEnds("We met on St. Patrick's Day.")).toBe(1);
    expect(countSentenceEnds('Apple vs. Google won.')).toBe(1);
    expect(countSentenceEnds('J. K. Rowling wrote it.')).toBe(1);
    // Another abbreviation, or an ellipsis: an end before a capital, none before a lowercase word.
    expect(countSentenceEnds('I bought apples, pears, etc. Then we left.')).toBe(2);
    expect(countSentenceEnds('He just left... We were surprised.')).toBe(2);
    expect(countSentenceEnds('Martin Luther King Jr. He spoke.')).toBe(2);
    expect(countSentenceEnds('Well... he arrived.')).toBe(1);
    expect(countSentenceEnds('We use tools, e.g. hammers.')).toBe(1);
    // With no next word yet, the next word decides; a title does not wait.
    expect(endsSentenceAt('apples, etc.', 11)).toBe(undefined);
    expect(endsSentenceAt('apples, etc. ', 11)).toBe(undefined);
    expect(endsSentenceAt('apples, etc. Then', 11)).toBe(true);
    expect(endsSentenceAt('apples, etc. then', 11)).toBe(false);
    expect(endsSentenceAt('apples, etc. "Then', 11)).toBe(true);
    expect(endsSentenceAt('I met Mr.', 8)).toBe(false);
    // Titles in the other languages, the Spanish "Sr." among them, and the words that are always followed by more of their sentence.
    expect(countSentenceEnds('El Sr. García llegó.')).toBe(1);
    expect(countSentenceEnds('La Sra. García llegó.')).toBe(1);
    expect(countSentenceEnds('Cf. The paper.')).toBe(1);
    expect(countSentenceEnds('e.g. Paris is big.')).toBe(1);
    expect(countSentenceEnds('Sie mögen Obst, z. B. Äpfel.')).toBe(1);
    // Any script's single capital initial; an ellipsis after a title is an ellipsis.
    expect(countSentenceEnds('А. С. Пушкин написал.')).toBe(1);
    expect(endsSentenceAt('Mr... We', 4)).toBe(true);
  });

  it('leaves every other period as it was: a plain word, the pronoun "I", a word joined to a number, and any opening mark before the next word', () => {
    // A plain word ends a sentence before whitespace whatever follows, as ruling 1 (iii) reads.
    expect(countSentenceEnds('He said no. then he left.')).toBe(2);
    expect(countSentenceEnds('I bought an iPhone. iPhones are great.')).toBe(2);
    expect(endsSentenceAt('He said no. ', 10)).toBe(true);
    // The pronoun is no initial.
    expect(countSentenceEnds('So do I. Then we left.')).toBe(2);
    expect(countSentenceEnds('It ended in World War I. Then peace came.')).toBe(2);
    // Letters joined to a number are no title.
    expect(countSentenceEnds('The event is on October 1st. Tickets are cheap.')).toBe(2);
    expect(countSentenceEnds('It took 300ms. Then it stopped.')).toBe(2);
    expect(countSentenceEnds('It took 5 ms. Then it stopped.')).toBe(2);
    expect(countSentenceEnds('It took 300ms. then it stopped.')).toBe(2);
    expect(countSentenceEnds('We met in Room 5A. Then we left.')).toBe(2);
    // Any opening mark may stand before the next word.
    expect(countSentenceEnds('Se fue... ¿Por qué?')).toBe(2);
    expect(countSentenceEnds('Compré peras, etc. ¡Qué bien!')).toBe(2);
    expect(countSentenceEnds('Il est parti... « Alors ».')).toBe(2);
    expect(countSentenceEnds('Er ging... „Warum?“')).toBe(1);
  });

  it('reads a text as ending at a sentence end when its last mark, trailing whitespace and closing quotes aside, is one', () => {
    expect(atSentenceEnd('Done.  ')).toBe(true);
    expect(atSentenceEnd('好。')).toBe(true);
    expect(atSentenceEnd('Is it?')).toBe(true);
    expect(atSentenceEnd('「行こう。」')).toBe(true);
    expect(atSentenceEnd('He said "go."')).toBe(true);
    expect(atSentenceEnd('यह ठीक है।')).toBe(true);
    expect(atSentenceEnd('Waiting for')).toBe(false);
    expect(atSentenceEnd('Well,')).toBe(false);
    // Rule C: a title is mid-sentence; another abbreviation or an ellipsis at the end may be one, as a Latin mark at the end is.
    expect(atSentenceEnd('I met Mr.')).toBe(false);
    expect(atSentenceEnd('apples, pears, etc.')).toBe(true);
    expect(atSentenceEnd('He just left...')).toBe(true);
    expect(atSentenceEnd('"')).toBe(false);
    expect(atSentenceEnd('')).toBe(false);
  });
});

describe('the source: its own pause, its origin stated (translation cuts, ruling 2; choice 2)', () => {
  it('opens on its first delta stating its origin, sends the whole text, closes on its own pause without restating it, and owes the translation a cut', () => {
    const { s, clock, timers, opened, closed, texts } = segments();
    s.sourceText('今天');
    s.sourceText('好。');
    expect(opened()).toEqual([{ ref: 1, side: 'source', origin: 's1' }]);
    expect(texts(1)).toEqual(['今天', '今天好。']);
    clock.advance(1499);
    expect(closed()).toEqual([]);
    clock.advance(1);
    expect(closed()).toEqual([{ ref: 1 }]);
    // The cut it owes names the translation that follows it.
    s.translationText('Today is good.');
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(timers()).toBe(0);
  });

  it('in sentence mode a mid-sentence pause waits while the text grows (Gemini choice 7), and reads the text as shown', () => {
    const { s, clock, timers, closed, texts } = segments({ ...SILENCE, deferMidSentence: true }, (t) => t.replace(/ /g, ''));
    s.sourceText('他 说');
    expect(texts(1)).toEqual(['他说']);
    clock.advance(1500);
    expect(closed()).toEqual([]);
    s.sourceText(' 我们');
    clock.advance(1500);
    expect(closed()).toEqual([]);
    clock.advance(1500);
    expect(closed()).toEqual([{ ref: 1 }]);
    // Its pause to begin a translation, then nothing is left.
    clock.advance(1500);
    expect(timers()).toBe(0);
  });
});

describe("the translation: cut at the source's cuts (translation cuts, rulings 1, 2; choices 4, 5)", () => {
  it("the owner's case: the interpreter pauses less than the speaker, yet each source gets its own translation, stated", () => {
    const { s, at, opened, closed, texts, cuts } = segments();
    at(0);
    s.sourceText('第一句');
    at(1_000);
    s.sourceText('话。');
    at(1_200);
    s.translationText('The first');
    at(1_800);
    s.translationText(' sentence.');
    // The speaker pauses 2 s, past the source's own 1.5 s: it closes at 2 500, owing one cut.
    at(3_000);
    s.sourceText('第二句。');
    // The interpreter's pause, 1.4 s, is shorter than its own 1.5 s: it goes on in the same stream.
    at(3_200);
    s.translationText(' The second.');
    expect(opened()).toEqual([
      { ref: 1, side: 'source', origin: 's1' },
      { ref: 2, side: 'translation', origin: 's1' },
      { ref: 3, side: 'source', origin: 's3' },
      { ref: 4, side: 'translation', origin: 's3' },
    ]);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(texts(2)).toEqual(['The first', 'The first sentence.']);
    expect(texts(4)).toEqual([' The second.']);
    expect(cuts).toEqual([{ reason: 'sentences', origin: 's1', sentences: 1, owed: 0, dropped: 0 }]);
    // The second source closes at 4 500; the translation's quiet at 4 700 closes it for that cut.
    at(4_700);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
    expect(cuts[1]).toEqual({ reason: 'quiet', origin: 's3', sentences: 1, owed: 0, dropped: 0 });
  });

  it("cuts after as many sentence ends as the source had, at least one: two for a two-sentence source, one for a source with none", () => {
    const { s, at, closed, texts } = segments();
    s.sourceText('一。二。');
    at(1_500);
    s.translationText('One.');
    s.translationText(' Two.');
    expect(closed()).toEqual([{ ref: 1 }]);
    s.sourceText('三');
    s.translationText(' Three');
    // The cut came before ' Three', which opened the next translation.
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(texts(2)).toEqual(['One.', 'One. Two.']);
    expect(texts(4)).toEqual([' Three']);
    at(3_000);
    // The source with no sentence end owes one: the translation's first end after its last delta, then the next delta.
    s.translationText(' four.');
    s.translationText(' Five');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
    expect(texts(4)).toEqual([' Three', ' Three four.']);
  });

  it("a closing source owes the count `countSource` gives for its text, not the module's own count", () => {
    // The module's own count reads two ends in 'One. Two.'; the option says one, so the translation's first sentence end — confirmed by the delta after it — cuts it at once, with no quiet needed.
    const { s, at, closed } = segments(SILENCE, undefined, undefined, () => 1);
    s.sourceText('One. Two.');
    at(1_500);
    expect(closed()).toEqual([{ ref: 1 }]);
    s.translationText('First.');
    s.translationText(' Next');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it("counts only the sentence ends that arrived after the source's last delta, strictly (the guard), each at its own delta's arrival", () => {
    const { s, at, closed } = segments();
    at(0);
    s.sourceText('一。');
    at(500);
    s.translationText('One.');
    at(1_000);
    s.sourceText('还有');
    // Closed at 2 500: one sentence end, its last delta at 1 000. The translation's end came at 500, before it.
    at(2_600);
    s.translationText(' And');
    expect(closed()).toEqual([{ ref: 1 }]);
    // ' And' settled 'One.' as an end: stamped 500, its own arrival, not 2 600, it is still not due.
    at(2_700);
    s.translationText(' more.');
    expect(closed()).toEqual([{ ref: 1 }]);
    at(2_800);
    s.translationText(' Next');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);

    // An end that arrives at the same moment as the source's last delta is not after it.
    const same = segments({ ...SILENCE, translationMs: 3_000 });
    same.s.sourceText('一。');
    same.s.translationText('One.');
    same.at(1_600);
    same.s.translationText(' Two');
    expect(same.closed()).toEqual([{ ref: 1 }]);
  });

  it('compares the latest sentence end, not the first: one before the source\'s last delta and one after it make the cut due — across deltas, within them, and in CJK', () => {
    for (const [first, second, third, next] of [
      ['One.', ' Two.', ' And', ' more'],
      ['One. ', 'Two. ', 'And', ' more'],
      ['一つ目。', '二つ目。', 'そして', 'もっと'],
    ]) {
      const { s, at, closed } = segments();
      s.sourceText('一。');
      at(600);
      s.translationText(first);
      at(1_000);
      s.sourceText('二。');
      at(1_100);
      s.translationText(second);
      at(1_200);
      s.translationText(third);
      // The source closes at 2 500, owing two: the first end came at 600, before its last delta at 1 000, the second at 1 100, after it.
      at(2_600);
      expect(closed()).toEqual([{ ref: 1 }]);
      s.translationText(next);
      expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    }
  });

  it('counts a Latin mark within a delta only before whitespace, and a CJK one wherever it stands: "1.5" in one delta cuts nothing, 「一つ目。二つ目」 counts one', () => {
    const latin = segments();
    latin.s.sourceText('一。二。');
    latin.at(1_600);
    latin.s.translationText('It costs 1.5 dollars.');
    latin.at(1_700);
    latin.s.translationText(' And');
    expect(latin.closed()).toEqual([{ ref: 1 }]);
    latin.at(1_800);
    latin.s.translationText(' the rest.');
    latin.at(1_900);
    latin.s.translationText(' Next');
    expect(latin.closed()).toEqual([{ ref: 1 }, { ref: 2 }]);

    const cjk = segments();
    cjk.s.sourceText('一。二。');
    cjk.at(1_600);
    cjk.s.translationText('一つ目。二つ目');
    cjk.at(1_700);
    cjk.s.translationText('。');
    expect(cjk.closed()).toEqual([{ ref: 1 }]);
    cjk.at(1_800);
    cjk.s.translationText('三つ目');
    expect(cjk.closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(cjk.texts(2)).toEqual(['一つ目。二つ目', '一つ目。二つ目。']);
  });

  it("cuts a translation in another script at its own marks — a Hindi one at its dandas (choice 3)", () => {
    const { s, at, closed, texts } = segments();
    s.sourceText('一。二。');
    at(1_600);
    s.translationText('पहला वाक्य। दूसरा');
    at(1_700);
    s.translationText(' वाक्य।');
    at(1_800);
    s.translationText(' तीसरा');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(texts(2)).toEqual(['पहला वाक्य। दूसरा', 'पहला वाक्य। दूसरा वाक्य।']);
  });

  it('reads a Latin end that closes a delta by the next one: "1." then "5" is no end, "done." then " Next" is', () => {
    const { s, at, closed, texts } = segments();
    s.sourceText('一点五。');
    at(1_500);
    s.translationText('It is 1.');
    s.translationText('5');
    expect(closed()).toEqual([{ ref: 1 }]);
    s.translationText(' kilos, done.');
    s.translationText(' Next');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(texts(2)).toEqual(['It is 1.', 'It is 1.5', 'It is 1.5 kilos, done.']);
  });

  it('keeps the audio that arrives between the sentence end and the next delta with the segment it closes; after it, the new one ranges from 0 (ruling 1)', () => {
    const { s, at, audio } = segments();
    s.sourceText('好。');
    at(1_500);
    s.translationText('Done.');
    s.audio(pcm(), ACTIVE);
    s.translationText(' Next');
    s.audio(pcm(), ACTIVE);
    expect(audio()).toEqual([[2, [0, 5]], [3, [0, 5]]]);
  });

  it('states its origin when it opens, when known — the cut owed first, else the source still open — and never another; else it states it as it closes', () => {
    const { s, at, opened, closed } = segments();
    // Nothing owed, no source: no origin yet.
    s.translationText('Hello');
    expect(opened()).toEqual([{ ref: 1, side: 'translation' }]);
    // A source opens and closes while it is open: the cut it owes is the one it closes for, stated as it closes.
    at(100);
    s.sourceText('你好。');
    at(200);
    s.translationText('.');
    at(1_600);
    s.translationText(' Hi.');
    expect(closed()).toEqual([{ ref: 2 }, { ref: 1, origin: 's2' }]);
    at(3_100);
    // The source still open when the next translation opens: stated then, and not again.
    s.sourceText('再见。');
    s.translationText('Bye.');
    expect(opened().slice(3)).toEqual([{ ref: 4, side: 'source', origin: 's4' }, { ref: 5, side: 'translation', origin: 's4' }]);
    at(10_000);
    expect(closed().filter((c) => c.ref === 5)).toEqual([{ ref: 5 }]);

    // A cut owed from a source that closed with no translation open, and the next source already open when one begins:
    // it follows the open source, and the older cut is dropped (choice 8).
    const both = segments();
    both.s.sourceText('一。');
    both.at(1_500);
    both.s.sourceText('二。');
    both.s.translationText('Two.');
    expect(both.opened()[2]).toEqual({ ref: 3, side: 'translation', origin: 's2' });
    expect(both.cuts).toEqual([{ reason: 'idle', origin: null, sentences: 0, owed: 0, dropped: 1 }]);
  });

  it('a cut at its sentences leaves the later cuts owed: a translation running behind two sources answers each in turn', () => {
    const { s, at, opened, cuts } = segments({ ...SILENCE, translationMs: 3_000 });
    s.sourceText('一。');
    at(1_500);
    s.sourceText('二。');
    at(3_000);
    // Both closed before the interpreter began, inside its pause to begin; it keeps talking, so no quiet settles anything.
    s.translationText('One.');
    s.translationText(' Two');
    expect(opened().slice(2)).toEqual([{ ref: 3, side: 'translation', origin: 's1' }, { ref: 4, side: 'translation', origin: 's2' }]);
    expect(cuts).toEqual([{ reason: 'sentences', origin: 's1', sentences: 1, owed: 1, dropped: 0 }]);

    // Two sources behind while the speaker is on a third: the next translation follows the cut owed first, not the open source.
    const behind = segments({ ...SILENCE, translationMs: 3_000 });
    behind.s.sourceText('一。');
    behind.at(100);
    behind.s.translationText('One');
    behind.at(1_600);
    behind.s.sourceText('二。');
    behind.at(1_700);
    behind.s.translationText(' is');
    behind.at(3_200);
    behind.s.sourceText('三');
    behind.at(3_300);
    behind.s.translationText('.');
    behind.at(3_400);
    behind.s.translationText(' Two');
    expect(behind.opened().slice(3)).toEqual([{ ref: 4, side: 'source', origin: 's4' }, { ref: 5, side: 'translation', origin: 's3' }]);

    // The same, the translation beginning inside its pause to begin: once it has begun, that pause is over, and its next
    // segment still follows the cut owed first.
    const late = segments({ ...SILENCE, translationMs: 3_000 });
    late.s.sourceText('一。');
    late.at(1_500);
    // The first source closed with no translation open: the pause to begin runs; the translation begins inside it.
    late.at(1_600);
    late.s.translationText('One');
    late.at(1_700);
    late.s.sourceText('二。');
    late.at(2_500);
    late.s.translationText(' is');
    late.at(3_300);
    late.s.sourceText('三');
    late.at(3_400);
    late.s.translationText(' done.');
    late.at(3_500);
    late.s.translationText(' Two');
    expect(late.opened().slice(3)).toEqual([{ ref: 4, side: 'source', origin: 's4' }, { ref: 5, side: 'translation', origin: 's3' }]);
    expect(late.cuts).toEqual([{ reason: 'sentences', origin: 's1', sentences: 1, owed: 1, dropped: 0 }]);
  });
});

describe("the translation's own quiet (translation cuts, ruling 1; choices 6–9)", () => {
  it('at a sentence end its quiet closes it for the cut owed, which its sentences never reached (the resync)', () => {
    const { s, at, closed, cuts } = segments();
    s.sourceText('一。二。');
    at(1_500);
    s.translationText('One and two.');
    at(2_999);
    expect(closed()).toEqual([{ ref: 1 }]);
    at(3_000);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(cuts).toEqual([{ reason: 'quiet', origin: 's1', sentences: 1, owed: 0, dropped: 0 }]);
  });

  it(`mid-sentence it waits once more, to ${MID_SENTENCE_HOLD_MS} ms after its last activity, then closes`, () => {
    const { s, at, closed, timers } = segments();
    s.sourceText('一。二。');
    at(1_500);
    s.translationText('One. Waiting for');
    at(3_000);
    expect(closed()).toEqual([{ ref: 1 }]);
    expect(timers()).toBe(1);
    at(1_500 + MID_SENTENCE_HOLD_MS - 1);
    expect(closed()).toEqual([{ ref: 1 }]);
    at(1_500 + MID_SENTENCE_HOLD_MS);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(timers()).toBe(0);

    // A delta during the hold gives it its pause, and its hold, again.
    const again = segments();
    again.s.sourceText('一。二。');
    again.at(1_500);
    again.s.translationText('One. Waiting');
    again.at(3_500);
    again.s.translationText(' for');
    again.at(3_500 + 1_500);
    expect(again.closed()).toEqual([{ ref: 1 }]);
    again.at(3_500 + MID_SENTENCE_HOLD_MS);
    expect(again.closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
  });

  it('holds nothing mid-sentence until the stream has shown a sentence end: a script that writes none closes at its pause (choice 6)', () => {
    // Thai writes no sentence-final mark: every pause would read as mid-sentence, and the hold would keep one translation open for the session.
    const { s, at, closed } = segments();
    s.sourceText('一。');
    at(1_600);
    s.translationText('ประโยคแรก');
    at(3_100);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    // Once a mark has shown, the hold holds.
    s.sourceText('二。');
    at(4_600);
    s.translationText('第二句。そして');
    at(6_100);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }]);
    at(4_600 + MID_SENTENCE_HOLD_MS);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);

    // A Latin mark closing a delta shows one too, though nothing followed it before its translation closed.
    const latin = segments();
    latin.s.sourceText('一。');
    latin.at(1_600);
    latin.s.translationText('First.');
    latin.at(3_100);
    latin.s.sourceText('二。');
    latin.at(4_600);
    latin.s.translationText('Then the');
    latin.at(6_100);
    expect(latin.closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }]);
    latin.at(4_600 + MID_SENTENCE_HOLD_MS);
    expect(latin.closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
  });

  it('holds nothing mid-sentence for a target whose script writes no mark, whatever stray Latin mark its stream shows: `holdMidSentence: false` (choice 6)', () => {
    // A Thai translation with one early Latin mark — a question, an era's abbreviation — then none: with the hold, that one mark
    // would hold every later pause for 5 s, and no cut would ever come due.
    const run = (holdMidSentence: boolean) => {
      const h = segments(SILENCE, undefined, holdMidSentence);
      h.s.sourceText('一。');
      h.at(1_600);
      h.s.translationText('ใช่ไหม?');
      // Its quiet at 3 100, at a sentence end: it closes for the first source.
      h.at(3_200);
      h.s.sourceText('二。');
      h.at(4_800);
      h.s.translationText('ปี พ ศ 2567 เราไป');
      h.at(6_300);
      return h;
    };
    const off = run(false);
    expect(off.closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
    // The default holds it — the latch the option exists to keep away from such a target.
    const on = run(true);
    expect(on.closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }]);
    on.at(4_800 + MID_SENTENCE_HOLD_MS);
    expect(on.closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
  });

  it("with nothing owed and a source still open it waits for that source's cut, then has its pause again (choice 7)", () => {
    const { s, at, closed, timers, opened } = segments();
    s.sourceText('我们');
    s.translationText('We.');
    at(1_000);
    s.sourceText('走吧');
    // Its quiet at 1 500: nothing owed, the source open until 2 500. It waits, with no timer of its own.
    at(1_500);
    expect(closed()).toEqual([]);
    expect(timers()).toBe(1);
    at(2_500);
    expect(closed()).toEqual([{ ref: 1 }]);
    at(3_999);
    expect(closed()).toEqual([{ ref: 1 }]);
    at(4_000);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
    expect(timers()).toBe(0);
  });

  it('a quiet close drops every other cut still owed: a source never translated does not shift the translations after it (choice 8)', () => {
    const { s, at, opened, cuts } = segments();
    s.sourceText('第一。第二。');
    s.translationText('First. Second');
    at(1_500);
    // The first source closed; a filler the interpreter will not translate follows while it still speaks.
    s.sourceText('嗯。');
    at(1_600);
    s.translationText(' one.');
    // The filler closes at 3 000; the translation's quiet at 3 100 closes it for the first and drops the filler's cut.
    at(3_100);
    expect(cuts).toEqual([{ reason: 'quiet', origin: 's1', sentences: 2, owed: 0, dropped: 1 }]);
    s.sourceText('第三。');
    at(3_300);
    s.translationText('Third.');
    expect(opened()[4]).toEqual({ ref: 5, side: 'translation', origin: 's4' });
  });

  it('a source that closes with no translation open gives it its pause to begin; with none begun its cut is dropped (choice 8)', () => {
    const { s, at, opened, cuts, timers } = segments();
    // Spoken in the target language: the interpreter says nothing.
    s.sourceText('Hello there.');
    at(2_999);
    expect(cuts).toEqual([]);
    at(3_000);
    expect(cuts).toEqual([{ reason: 'idle', origin: null, sentences: 0, owed: 0, dropped: 1 }]);
    expect(timers()).toBe(0);
    s.sourceText('你好。');
    at(3_200);
    s.translationText('Hello.');
    expect(opened()[2]).toEqual({ ref: 3, side: 'translation', origin: 's2' });

    // One that begins within the pause takes the cut.
    const late = segments();
    late.s.sourceText('你好。');
    late.at(2_900);
    late.s.translationText('Hello.');
    expect(late.opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
  });

  it('a filler, then speech within the pause to begin: the translation that begins then follows the speech, and the filler stands alone (choice 8)', () => {
    const { s, at, opened, closed, cuts } = segments();
    s.sourceText('我觉得这个方案不错。');
    at(700);
    s.translationText('I think this plan is good.');
    // The first source closes at 1 500, the translation for it at 2 200.
    at(2_200);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    at(2_700);
    s.sourceText('嗯。');
    // The filler closes at 4 200 with no translation open: the translation's pause to begin runs to 5 700.
    at(4_600);
    s.sourceText('我们明天开始吧。');
    at(5_200);
    s.translationText("Let's start tomorrow.");
    expect(opened().slice(3)).toEqual([{ ref: 4, side: 'source', origin: 's4' }, { ref: 5, side: 'translation', origin: 's4' }]);
    expect(cuts[1]).toEqual({ reason: 'idle', origin: null, sentences: 0, owed: 0, dropped: 1 });
    at(10_000);
    expect(closed().slice(2)).toEqual([{ ref: 3 }, { ref: 4 }, { ref: 5 }]);
  });

  it('a source\'s pause to begin restarts at each later close, not just the first: a translation beginning between the two still states the older cut, the newer one still owed (choice 8)', () => {
    const { s, at, opened, cuts } = segments({ ...SILENCE, translationMs: 3_000 });
    s.sourceText('一。');
    // s1 closes at 1 500, with none open: its pause to begin runs to 4 500.
    at(1_600);
    s.sourceText('二。');
    // s2 closes at 3 100, still with none open: the pause to begin restarts from here, to 6 100.
    at(5_000);
    // Past s1's deadline (4 500) but short of s2's (6 100): nothing has been dropped yet.
    s.translationText('One.');
    expect(cuts).toEqual([]);
    expect(opened()[2]).toEqual({ ref: 3, side: 'translation', origin: 's1' });
    at(5_100);
    s.translationText(' Two.');
    // The cut owed first (s1) is taken; s2's is still owed, not dropped, and the next translation follows it.
    expect(cuts).toEqual([{ reason: 'sentences', origin: 's1', sentences: 1, owed: 1, dropped: 0 }]);
    expect(opened()[3]).toEqual({ ref: 4, side: 'translation', origin: 's2' });
  });

  it('a translation that begins more than its pause after its source closed, with no source open, closes as that source\'s (choice 9)', () => {
    const { s, at, opened, closed, cuts } = segments();
    s.sourceText('今天天气很好。');
    at(600);
    s.translationText('The weather is nice today.');
    at(5_000);
    s.sourceText('好。');
    // It closes at 6 500; nothing begins within the pause, and its cut is dropped at 8 000.
    at(8_000);
    expect(cuts[1]).toEqual({ reason: 'idle', origin: null, sentences: 0, owed: 0, dropped: 1 });
    at(8_500);
    s.translationText('OK.');
    expect(opened()[3]).toEqual({ ref: 4, side: 'translation' });
    at(10_000);
    expect(closed().slice(3)).toEqual([{ ref: 4, origin: 's3' }]);
  });

  it('a quiet close with a cut owed takes that cut even while the next source is open: only a translation with nothing owed waits (choices 7, 8)', () => {
    const { s, at, closed, cuts } = segments();
    s.sourceText('一。');
    at(1_600);
    s.translationText('One.');
    at(2_000);
    s.sourceText('二');
    // Its quiet at 3 100: the first source's cut is owed, the second source open. It closes for the first.
    at(3_100);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(cuts).toEqual([{ reason: 'quiet', origin: 's1', sentences: 1, owed: 0, dropped: 0 }]);
  });

  it('with nothing owed and no source open it closes as the rest of the spoken source that closed last; before any, stating none (choice 9)', () => {
    const { s, at, closed } = segments();
    s.translationText('Before anything.');
    at(1_500);
    expect(closed()).toEqual([{ ref: 1 }]);
    s.sourceText('你好。');
    s.translationText('Hello.');
    at(3_000);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }]);
    // The rest of that translation, after its cut: no source to follow, so the one that closed last.
    s.translationText(' And welcome.');
    at(4_500);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4, origin: 's2' }]);
    // A second source, paid: the rest after it is its own, not the first's.
    s.sourceText('再见。');
    s.translationText('Goodbye.');
    at(6_000);
    s.translationText(' See you.');
    at(7_500);
    expect(closed().slice(4)).toEqual([{ ref: 5 }, { ref: 6 }, { ref: 7, origin: 's5' }]);
  });
});

describe("the translation's audio", () => {
  it('audio that counts opens a translation and is its activity; audio that does not neither, and plays with no ref outside one; play off emits none', () => {
    const { s, at, opened, audio, timers, closed } = segments();
    s.audio(pcm(), INACTIVE);
    expect(opened()).toEqual([]);
    expect(timers()).toBe(0);
    s.audio(pcm(), ACTIVE);
    expect(opened()).toEqual([{ ref: 1, side: 'translation' }]);
    expect(timers()).toBe(1);
    s.translationText('Hello.');
    at(1_000);
    s.audio(pcm(), INACTIVE);
    // Its pause runs from the last delta: audio that does not count does not hold it.
    at(1_500);
    expect(closed()).toEqual([{ ref: 1 }]);
    s.audio(pcm(), { play: false, active: true });
    expect(opened()).toEqual([{ ref: 1, side: 'translation' }, { ref: 2, side: 'translation' }]);
    expect(audio()).toEqual([[undefined, undefined], [1, [0, 0]], [1, [0, 6]]]);
    // Held by audio that counts: its pause starts again with each frame.
    at(2_900);
    s.audio(pcm(), { play: false, active: true });
    at(4_399);
    expect(closed()).toEqual([{ ref: 1 }]);
  });
});

describe('typed text, .done, a turn end, stop (translation cuts, choices 12, 13)', () => {
  it('typed text is a source row of its own: no origin, no cut', () => {
    const { s, opened, closed, texts, timers } = segments();
    s.typed('typed words');
    expect(opened()).toEqual([{ ref: 1, side: 'source' }]);
    expect(texts(1)).toEqual(['typed words']);
    expect(closed()).toEqual([{ ref: 1 }]);
    expect(timers()).toBe(0);
    s.translationText('Typed.');
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation' });
  });

  it("an answer to typed text states no origin, even after a spoken exchange: it follows no spoken source, so L2 pairs it with its typed row (choices 9, 12)", () => {
    const { s, at, closed } = segments();
    s.sourceText('你好。');
    s.translationText('Hello.');
    at(1_500);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    s.typed('谢谢');
    at(2_000);
    s.translationText('Thank you.');
    at(3_500);
    expect(closed().slice(2)).toEqual([{ ref: 3 }, { ref: 4 }]);
  });

  it("a source's .done closes it now, owing its cut; the translation's settles it as its quiet would, without the hold", () => {
    const { s, closed, cuts } = segments();
    s.sourceText('你好');
    s.translationText('Hello and');
    s.done('translation');
    // Nothing owed, the source open: the translation waits for it.
    expect(closed()).toEqual([]);
    s.done('source');
    expect(closed()).toEqual([{ ref: 1 }]);
    s.done('translation');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(cuts).toEqual([{ reason: 'done', origin: 's1', sentences: 0, owed: 0, dropped: 0 }]);
  });

  it("a translation .done mid-sentence with nothing owed and its source still open settles at the source's pause after it closes, not the 5 s hold (choice 13)", () => {
    const { s, at, closed, cuts } = segments();
    // A first exchange, so the stream has shown a sentence end (choice 6): it stays shown for the session.
    s.sourceText('你好。');
    at(200);
    s.translationText('Hello.');
    at(1_700);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);

    // The second exchange: nothing owed yet, its source still open, when the translation's .done arrives mid-sentence.
    at(6_700);
    s.sourceText('第二');
    at(6_900);
    s.translationText('The second');
    at(7_000);
    s.done('translation');
    // Nothing owed, the source open: it waits (choice 7).
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    // The source closes on its own pause at 8 200 (its last delta at 6 700, plus 1 500).
    at(8_199);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    at(8_200);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }]);
    // Without the fix it would wait a further 5 s hold from here (to 13 200). With it, it settles at once at its own
    // pause after the source's close: 9 700 — not 13 200.
    at(9_699);
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }]);
    at(9_700);
    // Its origin was already stated when it opened (the source was still open then), so it is not restated here (choice 5).
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }, { ref: 3 }, { ref: 4 }]);
    expect(cuts[cuts.length - 1]).toEqual({ reason: 'quiet', origin: 's3', sentences: 0, owed: 0, dropped: 0 });
  });

  it('a turn end closes the source and settles the translation for it', () => {
    const { s, closed, cuts, timers } = segments();
    s.sourceText('你好');
    s.translationText('Hello');
    s.endTurn();
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(cuts).toEqual([{ reason: 'turn', origin: 's1', sentences: 0, owed: 0, dropped: 0 }]);
    expect(timers()).toBe(0);
  });

  it('stop cancels every timer — a hold, a wait, the pause to begin — and says nothing after it', () => {
    type Harness = ReturnType<typeof segments>;
    for (const setUp of [
      // The mid-sentence hold.
      ({ s, at }: Harness) => { s.sourceText('一。'); s.translationText('One. Waiting for'); at(3_000); },
      // The wait for a source still open.
      ({ s, at }: Harness) => { s.sourceText('我们'); s.translationText('We.'); at(1_000); s.sourceText('走吧'); at(2_000); },
      // The pause to begin, after a source closed.
      ({ s, at }: Harness) => { s.sourceText('你好。'); at(2_000); },
    ]) {
      const h = segments();
      const { s, at, timers, log, cuts } = h;
      setUp(h);
      expect(timers()).toBe(1);
      const n = log.length;
      const c = cuts.length;
      s.stop();
      expect(timers()).toBe(0);
      at(20_000);
      s.sourceText('late');
      s.translationText('late.');
      s.audio(pcm(), ACTIVE);
      s.typed('late');
      s.done('source');
      s.endTurn();
      s.cutSource();
      s.translationContinues('.');
      s.closeAll();
      expect(timers()).toBe(0);
      expect(log.length).toBe(n);
      expect(cuts.length).toBe(c);
    }
  });
});

describe("an adapter's own source rules and a lost connection (Stage 2 OpenAI Live, choice 5)", () => {
  it('cutSource closes the open source now, owing its cut as its pause would; with none open it does nothing', () => {
    const { s, closed, opened, timers } = segments();
    s.cutSource();
    expect(closed()).toEqual([]);
    s.sourceText('今天我吃了');
    s.cutSource();
    expect(closed()).toEqual([{ ref: 1 }]);
    // Owed: the translation that begins now states that source; its pause to begin runs.
    expect(timers()).toBe(1);
    s.translationText('Today I ate');
    expect(opened()[1]).toEqual({ ref: 2, side: 'translation', origin: 's1' });
  });

  it('translationContinues ends the open translation with its marks before a cut due is taken — counted, shown, its activity — and with none open does nothing', () => {
    const { s, at, texts, closed, opened } = segments();
    s.sourceText('你好');
    s.cutSource();
    at(100);
    s.translationText('Hello there');
    s.translationContinues('.');
    expect(texts(2)).toEqual(['Hello there', 'Hello there.']);
    s.translationText(' Bye');
    expect(closed()).toEqual([{ ref: 1 }, { ref: 2 }]);
    expect(opened()[2]).toEqual({ ref: 3, side: 'translation' });
    const none = segments();
    none.s.translationContinues('.');
    expect(none.log).toEqual([]);
  });

  it('closeAll closes both sides as they stand, drops every cut owed, leaves no timer; the refs count on, and the next translation follows no source before it', () => {
    const { s, at, closed, opened, cuts, timers } = segments();
    s.sourceText('一。');
    s.cutSource();
    at(100);
    s.translationText('One');
    s.sourceText('二');
    s.closeAll();
    expect(closed()).toEqual([{ ref: 1 }, { ref: 3 }, { ref: 2 }]);
    expect(cuts).toEqual([{ reason: 'lost', origin: 's1', sentences: 0, owed: 0, dropped: 1 }]);
    expect(timers()).toBe(0);
    s.translationText('Again.');
    expect(opened()[3]).toEqual({ ref: 4, side: 'translation' });
    at(1_600);
    expect(closed()[3]).toEqual({ ref: 4 });
    // With no translation open, what is owed is dropped as idle.
    const idle = segments();
    idle.s.sourceText('你好');
    idle.s.closeAll();
    expect(idle.cuts).toEqual([{ reason: 'idle', origin: null, sentences: 0, owed: 0, dropped: 1 }]);
    expect(idle.timers()).toBe(0);
  });
});

describe("abbreviations, initials and ellipses in an English translation (the owner's rule C, 2026-09-30)", () => {
  /**
   * Three zh → en sentences as a continuous interpreter delivers them, each
   * source said whole: `paused`, a sentence every 3.5 s, its translation 2 s
   * behind in deltas 300 ms apart; `continuous`, a sentence every 1.8 s, its
   * translation 1.6 s behind in deltas 800 ms apart, so the interpreter never
   * pauses its 1.5 s.
   */
  const session = (timing: 'paused' | 'continuous', sentences: Array<[string, string[]]>): Recording => {
    const [every, lag, step] = timing === 'paused' ? [3_500, 2_000, 300] : [1_800, 1_600, 800];
    const events: RecordedEvent[] = [];
    sentences.forEach(([source, deltas], k) => {
      events.push([k * every, 's', source]);
      deltas.forEach((d, j) => events.push([k * every + lag + j * step, 't', d]));
    });
    return { run: timing, events: events.sort((a, b) => a[0] - b[0]) };
  };
  const exchanges = (rec: Recording) => replay(rec, (clock, sink) => {
    const s = new ContinuousSegments({ clock, silence: SILENCE, sink });
    return { input: (d) => s.sourceText(d), output: (d) => s.translationText(d), audio: (p) => s.audio(p, INACTIVE) };
  }).exchanges;

  it.each(['paused', 'continuous'] as const)("a title, an initial or an ellipsis inside a sentence ends nothing, though the source has closed before it arrives — %s", (timing) => {
    expect(exchanges(session(timing, [['史密斯先生今天到了。', ['Mr.', ' Smith arrived today.']], ['他坐下了。', [' He sat', ' down.']], ['然后他走了。', [' Then he', ' left.']]])))
      .toEqual([['史密斯先生今天到了。', 'Mr. Smith arrived today.'], ['他坐下了。', 'He sat down.'], ['然后他走了。', 'Then he left.']]);
    expect(exchanges(session(timing, [['我去看了医生。', ['I went to see', ' Dr.', ' Wang today.']], ['他说没事。', [' He said', " it's fine."]], ['然后我回家了。', [' Then I', ' went home.']]])))
      .toEqual([['我去看了医生。', 'I went to see Dr. Wang today.'], ['他说没事。', "He said it's fine."], ['然后我回家了。', 'Then I went home.']]);
    expect(exchanges(session(timing, [['这本书是罗琳写的。', ['J.', ' K.', ' Rowling wrote this book.']], ['我很喜欢。', [' I', ' love it.']], ['你读过吗？', [' Have you', ' read it?']]])))
      .toEqual([['这本书是罗琳写的。', 'J. K. Rowling wrote this book.'], ['我很喜欢。', 'I love it.'], ['你读过吗？', 'Have you read it?']]);
    expect(exchanges(session(timing, [['嗯，他到了。', ['Well...', ' he arrived.']], ['他坐下了。', [' He sat', ' down.']], ['然后他走了。', [' Then he', ' left.']]])))
      .toEqual([['嗯，他到了。', 'Well... he arrived.'], ['他坐下了。', 'He sat down.'], ['然后他走了。', 'Then he left.']]);
  });

  it.each(['paused', 'continuous'] as const)('another abbreviation or an ellipsis at a real sentence end still ends it, the next sentence following at once — %s', (timing) => {
    expect(exchanges(session(timing, [['我买了苹果、梨等等。', ['I bought apples, pears,', ' etc.']], ['然后我们走了。', [' Then we', ' left.']], ['天气很好。', [' The weather', ' was nice.']]])))
      .toEqual([['我买了苹果、梨等等。', 'I bought apples, pears, etc.'], ['然后我们走了。', 'Then we left.'], ['天气很好。', 'The weather was nice.']]);
    expect(exchanges(session(timing, [['他就这么走了……', ['He just', ' left...']], ['我们都很惊讶。', [' We were all', ' surprised.']], ['天气很好。', [' The weather', ' was nice.']]])))
      .toEqual([['他就这么走了……', 'He just left...'], ['我们都很惊讶。', 'We were all surprised.'], ['天气很好。', 'The weather was nice.']]);
    // The pronoun, and a date, end their sentences as before.
    expect(exchanges(session(timing, [['我也是。', ['So do', ' I.']], ['然后他们走了。', [' Then they', ' left.']], ['天气很好。', [' The weather', ' was nice.']]])))
      .toEqual([['我也是。', 'So do I.'], ['然后他们走了。', 'Then they left.'], ['天气很好。', 'The weather was nice.']]);
    expect(exchanges(session(timing, [['活动在十月一日。', ['The event is on', ' October 1st.']], ['票很便宜。', [' Tickets are', ' cheap.']], ['天气很好。', [' The weather', ' was nice.']]])))
      .toEqual([['活动在十月一日。', 'The event is on October 1st.'], ['票很便宜。', 'Tickets are cheap.'], ['天气很好。', 'The weather was nice.']]);
  });
});

describe("the spike's three recorded sessions (translation cuts, ruling 1; choice 15)", () => {
  it.each([
    ['at the default pauses', SILENCE],
    ["with the translation's pause at 3 s, past every pause of the interpreter's: the cuts alone", { ...SILENCE, translationMs: 3_000 }],
  ])('pairs every source with its own translation, stated, none alone — the text alone, audio holding nothing — %s', (_name, silence) => {
    for (const [name, sources] of [['user', 6], ['tight', 6], ['long', 7]] as const) {
      const r = replay(RECORDINGS[name], (clock, sink) => {
        const s = new ContinuousSegments({ clock, silence, sink });
        return { input: (d) => s.sourceText(d), output: (d) => s.translationText(d), audio: (p) => s.audio(p, INACTIVE) };
      });
      expect({ name, sources: r.sources, paired: r.paired, orphans: r.orphans }).toEqual({ name, sources, paired: sources, orphans: 0 });
      expect(r.pairings).toEqual(new Array(sources).fill('stated'));
    }
  });

  /** A recording whose translation writes other marks: each of its deltas mapped. */
  const retarget = (r: Recording, map: (text: string) => string): Recording =>
    ({ run: r.run, events: r.events.map((e) => (e[1] === 't' ? [e[0], 't', map(e[2])] : e)) as RecordedEvent[] });

  /** A target that writes no mark whose stream still shows one, early — a question, an abbreviation — as Thai text may: the first delta's first mark kept, every other removed. */
  const oneEarlyMark = () => {
    let seen = false;
    return (t: string) => {
      const i = t.search(/[.?!]/);
      if (seen || i < 0) return t.replace(/[.?!]/g, '');
      seen = true;
      return t.slice(0, i + 1) + t.slice(i + 1).replace(/[.?!]/g, '');
    };
  };

  it.each([
    ['a target that ends its sentences with dandas, as Hindi does, pairs them all', () => (t: string) => t.replace(/[.?!]/g, '।'), [6, 6, 7], true],
    ['a target that writes no sentence-final mark, as Thai does, leaves none alone', () => (t: string) => t.replace(/[.?!]/g, ''), [6, 6, 6], true],
    ['the same, its stream showing one early Latin mark, with no mid-sentence hold for such a target', oneEarlyMark, [6, 6, 6], false],
  ] as const)('the same sessions, their translation in another script: %s (choices 3, 6)', (_name, make, paired, holdMidSentence) => {
    (['user', 'tight', 'long'] as const).forEach((name, i) => {
      const r = replay(retarget(RECORDINGS[name], make()), (clock, sink) => {
        const s = new ContinuousSegments({ clock, silence: SILENCE, sink, holdMidSentence });
        return { input: (d) => s.sourceText(d), output: (d) => s.translationText(d), audio: (p) => s.audio(p, INACTIVE) };
      });
      expect({ name, paired: r.paired, orphans: r.orphans }).toEqual({ name, paired: paired[i], orphans: 0 });
    });
  });
});
