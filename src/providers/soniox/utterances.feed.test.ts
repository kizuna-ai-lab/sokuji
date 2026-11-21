/**
 * What the utterances hand to speech, read two ways: the sink's `speak` and
 * `endSpeech` calls, and what a speech feed makes of the translation
 * segments alone (their `stableLen` and `language`). For the same tokens the
 * two are the same calls in the same order. The places where they are not
 * are pinned here, each marked `DIFFERENCE:`.
 */
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { Ref, TextRange } from '../../lib/contract/adapter';
import type { LegName } from '../../lib/conversation/types';
import { createSpeechFeed, type SpeechFeed } from '../../lib/plan/speechFeed';
import type { SonioxToken } from './sttStream';
import { FIN_TRANSLATION_GRACE_MS, Utterances, type SegmentEvent } from './utterances';

const orig = (text: string, is_final = true, more: Partial<SonioxToken> = {}): SonioxToken => ({ text, is_final, translation_status: 'original', language: 'en', ...more });
const tr = (text: string, is_final = true, language = 'ja'): SonioxToken => ({ text, is_final, translation_status: 'translation', language, source_language: 'en' });
const END: SonioxToken = { text: '<end>', is_final: true };
const FIN: SonioxToken = { text: '<fin>', is_final: true };

/** One thing speech is asked: a chunk to read, or the end of a row's utterance. */
type Asked = { leg: LegName; speak: [Ref, string, TextRange, string] } | { leg: LegName; end: Ref };

const TARGETS: Record<LegName, string> = { speaker: 'ja', participant: 'en' };

/** The utterances with both readers attached: `sink` is what the sink is told, `feed` what a feed per leg makes of the segments. */
function setup(legFor: (t: SonioxToken) => LegName = () => 'speaker') {
  const clock = createVirtualClock(0);
  const sink: Asked[] = [];
  const feed: Asked[] = [];
  const segments: Array<{ leg: LegName; event: SegmentEvent }> = [];
  const feedOf = (leg: LegName): SpeechFeed => createSpeechFeed({
    speak: (ref, text, span, language) => feed.push({ leg, speak: [ref, text, span, language] }),
    end: (ref) => feed.push({ leg, end: ref }),
  }, () => TARGETS[leg]);
  const feeds: Record<LegName, SpeechFeed> = { speaker: feedOf('speaker'), participant: feedOf('participant') };
  const machine = new Utterances({
    clock, legFor, targetFor: (leg) => TARGETS[leg],
    sink: {
      segment: (leg, event) => {
        segments.push({ leg, event });
        if (event.kind === 'segmentOpened') feeds[leg].opened(event.payload);
        else if (event.kind === 'segmentText') feeds[leg].text(event.payload);
        else feeds[leg].closed(event.payload);
      },
      speak: (leg, ...speak) => sink.push({ leg, speak }),
      endSpeech: (leg, end) => sink.push({ leg, end }),
    },
  });
  /** Every `segmentText` payload sent for `ref`, in order. */
  const textsOf = (ref: Ref) => segments.flatMap(({ event }) => (event.kind === 'segmentText' && event.payload.ref === ref ? [event.payload] : []));
  return { clock, machine, sink, feed, textsOf };
}

describe('the utterances, read by a speech feed', () => {
  it('partials, then finals: one chunk, and the end at <end>', () => {
    const { machine, sink, feed } = setup();
    machine.message([orig('How are you', false), tr('お元', false)]);
    machine.message([orig('How are you?'), tr('お元気ですか？')]);
    machine.message([END]);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [2, 'お元気ですか？', [0, 7], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
    expect(feed).toEqual(sink);
  });

  it('finals arriving in several messages: a chunk a message, each with its span', () => {
    const { machine, sink, feed } = setup();
    machine.message([orig('How are'), tr('お元気'), tr('です', false)]);
    machine.message([orig(' you?'), tr('です'), tr('か', false)]);
    machine.message([tr('か？'), END]);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [2, 'お元気', [0, 3], 'ja'] },
      { leg: 'speaker', speak: [2, 'です', [3, 5], 'ja'] },
      { leg: 'speaker', speak: [2, 'か？', [5, 7], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
    expect(feed).toEqual(sink);
  });

  it('a partial that turns final with the same words is spoken: the text is the same, its stable length is not', () => {
    const { machine, sink, feed, textsOf } = setup();
    machine.message([orig('Hi.'), tr('やあ。', false)]);
    machine.message([tr('やあ。')]);
    expect(textsOf(2).map((p) => [p.text, p.stableLen])).toEqual([['やあ。', 0], ['やあ。', 3]]);
    expect(sink).toEqual([{ leg: 'speaker', speak: [2, 'やあ。', [0, 3], 'ja'] }]);
    expect(feed).toEqual(sink);
  });

  it('a partial after the finals is shown and not spoken, by either', () => {
    const { machine, sink, feed, textsOf } = setup();
    machine.message([orig('One two'), tr('一'), tr('二', false)]);
    expect(textsOf(2)).toEqual([{ ref: 2, text: '一二', stableLen: 1, language: 'ja' }]);
    expect(sink).toEqual([{ leg: 'speaker', speak: [2, '一', [0, 1], 'ja'] }]);
    expect(feed).toEqual(sink);
    machine.message([END]);
    // <end> lets the partial go: the row's text is its finals, and nothing more is read.
    expect(sink.slice(1)).toEqual([{ leg: 'speaker', end: 2 }]);
    expect(feed).toEqual(sink);
  });

  it('<fin>, then a late translation within the grace, then the grace running out', () => {
    const { clock, machine, sink, feed } = setup();
    machine.message([orig('Hi there.'), tr('や'), FIN]);
    clock.advance(1_000);
    machine.message([tr('あ。')]);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [2, 'や', [0, 1], 'ja'] },
      { leg: 'speaker', speak: [2, 'あ。', [1, 3], 'ja'] },
    ]);
    expect(feed).toEqual(sink);
    clock.advance(FIN_TRANSLATION_GRACE_MS - 1_000);
    expect(sink.slice(2)).toEqual([{ leg: 'speaker', end: 2 }]);
    expect(feed).toEqual(sink);
  });

  it('a translation that only arrives after <end> is read, and ends when the grace runs out', () => {
    const { clock, machine, sink, feed } = setup();
    machine.message([orig('Hi.'), END]);
    machine.message([tr('やあ。')]);
    clock.advance(FIN_TRANSLATION_GRACE_MS);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [2, 'やあ。', [0, 3], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
    expect(feed).toEqual(sink);
  });

  it('the next utterance begins while the last translation is still open: its late words are read, then it ends, before the next is', () => {
    const { machine, sink, feed } = setup();
    machine.message([orig('Hi.'), tr('や'), FIN]);
    // The late words and the next utterance's first original in one message.
    machine.message([tr('あ。'), orig('Next.'), tr('次。')]);
    machine.message([END]);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [2, 'や', [0, 1], 'ja'] },
      { leg: 'speaker', speak: [2, 'あ。', [1, 3], 'ja'] },
      { leg: 'speaker', end: 2 },
      { leg: 'speaker', speak: [4, '次。', [0, 2], 'ja'] },
      { leg: 'speaker', end: 4 },
    ]);
    expect(feed).toEqual(sink);
  });

  it('the next utterance begins in a message of its own: the open translation ends with nothing more read', () => {
    const { machine, sink, feed } = setup();
    machine.message([orig('Hi.'), tr('やあ。'), FIN]);
    machine.message([orig('Next.')]);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [2, 'やあ。', [0, 3], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
    expect(feed).toEqual(sink);
  });

  it('abandon ends an open translation whose text is all final, and one held after <fin>', () => {
    const open = setup();
    open.machine.message([orig('Half', false), tr('半')]);
    open.machine.abandon();
    expect(open.sink).toEqual([
      { leg: 'speaker', speak: [2, '半', [0, 1], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
    expect(open.feed).toEqual(open.sink);

    const held = setup();
    held.machine.message([orig('Hi.'), tr('や'), FIN]);
    held.machine.abandon();
    held.clock.advance(FIN_TRANSLATION_GRACE_MS);
    expect(held.sink).toEqual([
      { leg: 'speaker', speak: [2, 'や', [0, 1], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
    expect(held.feed).toEqual(held.sink);
  });

  it('abandon with a partial translation showing: the sink reads the finals only, the feed reads the partial too', () => {
    const { machine, sink, feed, textsOf } = setup();
    machine.message([orig('Half of', false), tr('半'), tr('分の', false)]);
    machine.abandon();
    // The row closes as it stands: its last text keeps the partial.
    expect(textsOf(2)).toEqual([{ ref: 2, text: '半分の', stableLen: 1, language: 'ja' }]);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [2, '半', [0, 1], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
    // DIFFERENCE: a feed reads the rest of a segment's text when it closes. Everywhere else the last text of a
    // translation is its finals; a translation abandoned in the middle of a message's partial keeps that partial
    // as its text, so the feed reads it and the sink never did.
    expect(feed).toEqual([
      { leg: 'speaker', speak: [2, '半', [0, 1], 'ja'] },
      { leg: 'speaker', speak: [2, '分の', [1, 3], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
  });

  it('a final translation token after <end> closed the translation: the sink reads it and ends again, the feed gets nothing', () => {
    const { machine, sink, feed } = setup();
    machine.message([orig('Hi.'), tr('やあ'), END]);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [2, 'やあ', [0, 2], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
    expect(feed).toEqual(sink);
    machine.message([tr('。')]);
    expect(sink.slice(2)).toEqual([
      { leg: 'speaker', speak: [2, '。', [2, 3], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
    // DIFFERENCE: the segment is closed, so its later text reaches no feed. The sink is handed the late chunk and
    // a second end for the same row.
    expect(feed.slice(2)).toEqual([]);
  });

  it('the same after the grace closed the translation, and with the next original in the same message', () => {
    const grace = setup();
    grace.machine.message([orig('Hi.'), tr('や'), FIN]);
    grace.clock.advance(FIN_TRANSLATION_GRACE_MS);
    grace.machine.message([tr('あ。')]);
    expect(grace.sink).toEqual([
      { leg: 'speaker', speak: [2, 'や', [0, 1], 'ja'] },
      { leg: 'speaker', end: 2 },
      { leg: 'speaker', speak: [2, 'あ。', [1, 3], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
    // DIFFERENCE: as above, the late chunk on a closed translation.
    expect(grace.feed).toEqual(grace.sink.slice(0, 2));

    const next = setup();
    next.machine.message([orig('Hi.'), tr('やあ'), END]);
    next.machine.message([tr('。'), orig('Next.'), tr('次。'), END]);
    expect(next.sink).toEqual([
      { leg: 'speaker', speak: [2, 'やあ', [0, 2], 'ja'] },
      { leg: 'speaker', end: 2 },
      { leg: 'speaker', speak: [2, '。', [2, 3], 'ja'] },
      { leg: 'speaker', end: 2 },
      { leg: 'speaker', speak: [4, '次。', [0, 2], 'ja'] },
      { leg: 'speaker', end: 4 },
    ]);
    // DIFFERENCE: as above; what follows the late chunk is the same again.
    expect(next.feed).toEqual([...next.sink.slice(0, 2), ...next.sink.slice(4)]);
  });

  it('a language switch inside one utterance: each run is read in its own language', () => {
    const { machine, sink, feed, textsOf } = setup();
    machine.message([orig('Hi.'), END]);
    machine.message([orig('こんにちは', true, { language: 'ja' })]);
    // The last utterance's late tail lands on the new one, then the new one's own translation, in the other language.
    machine.message([tr('やあ。', true, 'ja'), tr('Hello', true, 'en'), tr(' there', true, 'en')]);
    machine.message([END]);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [3, 'やあ。', [0, 3], 'ja'] },
      { leg: 'speaker', speak: [3, 'Hello there', [3, 14], 'en'] },
      { leg: 'speaker', end: 3 },
    ]);
    expect(feed).toEqual(sink);
    // The run before the switch has a snapshot of its own, in its language; the text the row ends with is in the last one.
    expect(textsOf(3)).toEqual([
      { ref: 3, text: 'やあ。', stableLen: 3, language: 'ja' },
      { ref: 3, text: 'やあ。Hello there', stableLen: 14, language: 'en' },
    ]);
  });

  it('a language switch between two messages', () => {
    const { machine, sink, feed } = setup();
    machine.message([orig('x'), tr('Hola', true, 'es')]);
    machine.message([tr(' mundo', true, 'pt'), END]);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [2, 'Hola', [0, 4], 'es'] },
      { leg: 'speaker', speak: [2, ' mundo', [4, 10], 'pt'] },
      { leg: 'speaker', end: 2 },
    ]);
    expect(feed).toEqual(sink);
  });

  it('finals in one language beside a partial in another: the finals are read in theirs, the row keeps the language it showed', () => {
    const { machine, sink, feed, textsOf } = setup();
    machine.message([orig('x'), tr('Hola', true, 'es'), tr(' mun', false, 'pt')]);
    expect(sink).toEqual([{ leg: 'speaker', speak: [2, 'Hola', [0, 4], 'es'] }]);
    expect(feed).toEqual(sink);
    const texts = textsOf(2);
    expect(texts[texts.length - 1]).toEqual({ ref: 2, text: 'Hola mun', stableLen: 4, language: 'pt' });
    machine.message([tr(' mundo', true, 'pt'), END]);
    expect(sink.slice(1)).toEqual([
      { leg: 'speaker', speak: [2, ' mundo', [4, 10], 'pt'] },
      { leg: 'speaker', end: 2 },
    ]);
    expect(feed).toEqual(sink);
  });

  it("no token names a language: both read in the leg's target", () => {
    const { machine, sink, feed, textsOf } = setup();
    machine.message([orig('x'), tr('Hola', true, ''), END]);
    expect(textsOf(2)).toEqual([{ ref: 2, text: 'Hola', stableLen: 4 }]);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [2, 'Hola', [0, 4], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
    expect(feed).toEqual(sink);
  });

  it("only a partial names a language: the finals are read in the leg's target by both", () => {
    const { machine, sink, feed } = setup();
    machine.message([orig('x'), tr('Ho', false, 'es')]);
    machine.message([tr('Hola', true, ''), END]);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [2, 'Hola', [0, 4], 'ja'] },
      { leg: 'speaker', end: 2 },
    ]);
    expect(feed).toEqual(sink);
  });

  it('two legs on one core: each utterance is read on its own leg, in order', () => {
    const { machine, sink, feed } = setup((t) => (t.language === 'ja' ? 'participant' : 'speaker'));
    machine.message([orig('Hello.'), tr('こんにちは。', true, 'ja'), END]);
    machine.message([orig('はい', true, { language: 'ja' }), tr('Yes', true, 'en')]);
    machine.message([orig('。', true, { language: 'ja' }), tr('.', true, 'en'), FIN]);
    machine.message([orig('Good.'), tr('いいね。', true, 'ja'), END]);
    expect(sink).toEqual([
      { leg: 'speaker', speak: [2, 'こんにちは。', [0, 6], 'ja'] },
      { leg: 'speaker', end: 2 },
      { leg: 'participant', speak: [4, 'Yes', [0, 3], 'en'] },
      { leg: 'participant', speak: [4, '.', [3, 4], 'en'] },
      { leg: 'participant', end: 4 },
      { leg: 'speaker', speak: [6, 'いいね。', [0, 4], 'ja'] },
      { leg: 'speaker', end: 6 },
    ]);
    expect(feed).toEqual(sink);
  });

  it('two legs on one core: a tail in the other language on the next leg\'s utterance is read in its own language', () => {
    const { machine, sink, feed } = setup((t) => (t.language === 'ja' ? 'participant' : 'speaker'));
    machine.message([orig('Hi.'), END]);
    machine.message([orig('はい。', true, { language: 'ja' })]);
    machine.message([tr('やあ。', true, 'ja'), tr('Yes.', true, 'en'), END]);
    expect(sink).toEqual([
      { leg: 'participant', speak: [3, 'やあ。', [0, 3], 'ja'] },
      { leg: 'participant', speak: [3, 'Yes.', [3, 7], 'en'] },
      { leg: 'participant', end: 3 },
    ]);
    expect(feed).toEqual(sink);
  });

  it('an utterance with no translation at all asks nothing of speech', () => {
    const { clock, machine, sink, feed } = setup();
    machine.message([orig('Hm', false)]);
    machine.message([orig('Hm.'), END]);
    machine.message([orig('Again.'), FIN]);
    clock.advance(FIN_TRANSLATION_GRACE_MS);
    machine.abandon();
    expect(sink).toEqual([]);
    expect(feed).toEqual(sink);
  });

  it('stop: the grace is cancelled and neither is asked anything more', () => {
    const { clock, machine, sink, feed } = setup();
    machine.message([orig('Hi.'), tr('や'), FIN]);
    machine.stop();
    clock.advance(FIN_TRANSLATION_GRACE_MS);
    expect(sink).toEqual([{ leg: 'speaker', speak: [2, 'や', [0, 1], 'ja'] }]);
    expect(feed).toEqual(sink);
  });
});
