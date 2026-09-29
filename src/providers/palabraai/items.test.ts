import { describe, it, expect } from 'vitest';
import type { AdapterEvents, SessionContext } from '../../lib/contract/adapter';
import { checkConformance } from '../../lib/contract/conformance';
import { recordEvents, type AdapterEvent } from '../../lib/contract/events';
import { PalabraItems } from './items';
import { EN, JA, SENTENCE, SERVER } from './testing';
import { decodeMessage, outputAudioOf, transcriptionOf } from './wire';

const AUTO: SessionContext = { direction: { source: 'ja', target: 'en' }, speech: true, turns: 'auto' };

function items() {
  const { events, log } = recordEvents();
  const it = new PalabraItems(events);
  /** Feeds a server frame as the adapter does: decoded, then the kind's reader. */
  const feed = (frame: string, pcm?: Int16Array) => {
    const m = decodeMessage(frame);
    if (m.type === 'partial_transcription') it.sourcePartial(transcriptionOf(m.data));
    else if (m.type === 'validated_transcription') it.sourceFinal(transcriptionOf(m.data));
    else if (m.type === 'partial_translated_transcription') it.translationPartial(transcriptionOf(m.data));
    else if (m.type === 'translated_transcription') it.translationFinal(transcriptionOf(m.data));
    else if (m.type === 'output_audio_data') it.audio(outputAudioOf(m.data), pcm ?? new Int16Array(4_800));
  };
  /** The payloads of one kind of event, in order. */
  const of = <K extends AdapterEvent['kind']>(kind: K): Array<Parameters<AdapterEvents[K]>[0]> =>
    log.filter((e) => e.kind === kind).map((e) => e.payload as Parameters<AdapterEvents[K]>[0]);
  return { items: it, log, feed, of };
}

describe("Palabra AI's segments: one sentence, one id (survey §2.8)", () => {
  it("makes a sentence as the owner's probe saw it: the source grows and closes, its translation follows under the same origin", () => {
    const h = items();
    h.feed(SERVER.partial('リ'));
    h.feed(SERVER.partial('リアルタイム'));
    // A partial that says the same again is no new text.
    h.feed(SERVER.partial('リアルタイム'));
    h.feed(SERVER.validated());
    h.feed(SERVER.translated());
    expect(h.log.filter((e) => e.kind !== 'audio')).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source', origin: SENTENCE } },
      { kind: 'segmentText', payload: { ref: 1, text: 'リ', language: 'ja' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'リアルタイム', language: 'ja' } },
      { kind: 'segmentText', payload: { ref: 1, text: JA, language: 'ja' } },
      { kind: 'segmentClosed', payload: { ref: 1, origin: SENTENCE } },
      { kind: 'segmentOpened', payload: { ref: 2, side: 'translation', origin: SENTENCE } },
      { kind: 'segmentText', payload: { ref: 2, text: EN } },
      { kind: 'segmentClosed', payload: { ref: 2, origin: SENTENCE } },
    ]);
  });

  it("tiles the translation over its burst once the last chunk is in, by sample count (ruling 6)", () => {
    const h = items();
    h.feed(SERVER.validated());
    h.feed(SERVER.translated());
    h.feed(SERVER.audio(), new Int16Array(4_800));
    h.feed(SERVER.audio(), new Int16Array(4_800));
    expect(h.of('speechRanges')).toEqual([]);
    h.feed(SERVER.audio({ last: true }), new Int16Array(2_400));
    expect(h.of('audio').map((a) => [a.ref, a.pcm.length, a.range])).toEqual([[2, 4_800, undefined], [2, 4_800, undefined], [2, 2_400, undefined]]);
    const [filled] = h.of('speechRanges');
    expect(filled.ref).toBe(2);
    expect(filled.ranges.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(filled.ranges[0].range[0]).toBe(0);
    expect(filled.ranges[2].range[1]).toBe(EN.length);
    // 4 800 : 4 800 : 2 400 of the text.
    expect(filled.ranges.map((r) => r.range)).toEqual([[0, 33], [33, 66], [66, EN.length]]);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  it('opens the translation empty for speech that comes before its text, and fills its ranges once the text is final', () => {
    const h = items();
    h.feed(SERVER.audio(), new Int16Array(4_800));
    h.feed(SERVER.audio({ last: true }), new Int16Array(4_800));
    expect(h.log.slice(0, 2)).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'translation', origin: SENTENCE } },
      { kind: 'audio', payload: { pcm: expect.any(Int16Array), ref: 1 } },
    ]);
    expect(h.of('speechRanges')).toEqual([]);
    h.feed(SERVER.translated('Hello there.'));
    expect(h.of('speechRanges')).toEqual([{ ref: 1, ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 12] }] }]);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  it("puts a text's part and its audio's on one translation, the text's a number and the audio's a string (the owner's probe)", () => {
    const h = items();
    h.feed(SERVER.translated());
    h.feed(SERVER.audio({ part: '0', last: true }));
    expect(h.of('segmentOpened')).toHaveLength(1);
    expect(h.of('audio')[0].ref).toBe(1);
  });

  it('gives each part of a sentence its own translation under the one origin; its last chunk ends them all, each filled once final', () => {
    const h = items();
    h.feed(SERVER.translated('First part.', SENTENCE, 0));
    h.feed(SERVER.audio({ part: '0' }), new Int16Array(4_800));
    h.feed(SERVER.audio({ part: '1' }), new Int16Array(4_800));
    h.feed(SERVER.audio({ part: '1', last: true }), new Int16Array(4_800));
    h.feed(SERVER.translated('Second part.', SENTENCE, 1));
    expect(h.of('segmentOpened')).toEqual([
      { ref: 1, side: 'translation', origin: SENTENCE },
      { ref: 2, side: 'translation', origin: SENTENCE },
    ]);
    expect(h.of('speechRanges')).toEqual([
      { ref: 1, ranges: [{ index: 0, range: [0, 11] }] },
      { ref: 2, ranges: [{ index: 0, range: [0, 6] }, { index: 1, range: [6, 12] }] },
    ]);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  it('plays a chunk that comes after the ranges were filled, rangeless; an empty last chunk ends the burst with no entry', () => {
    const h = items();
    h.feed(SERVER.translated('Hi.'));
    h.feed(SERVER.audio(), new Int16Array(4_800));
    h.feed(SERVER.audio({ last: true }), new Int16Array(0));
    expect(h.of('audio')).toHaveLength(1);
    expect(h.of('speechRanges')).toEqual([{ ref: 1, ranges: [{ index: 0, range: [0, 3] }] }]);
    h.feed(SERVER.audio({ last: true }), new Int16Array(4_800));
    expect(h.of('audio')).toHaveLength(2);
    expect(h.of('speechRanges')).toHaveLength(1);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  it('ignores a partial after its final, and a final said twice', () => {
    const h = items();
    h.feed(SERVER.validated());
    h.feed(SERVER.partial('late'));
    h.feed(SERVER.validated('again'));
    h.feed(SERVER.translated());
    h.feed(SERVER.translationPartial('late'));
    h.feed(SERVER.translated('again'));
    expect(h.of('segmentText').map((t) => t.text)).toEqual([JA, EN]);
    expect(h.of('segmentClosed')).toHaveLength(2);
  });

  it('streams a partial translation into the translation it then closes (translate partials on)', () => {
    const h = items();
    h.feed(SERVER.translationPartial('Welcome'));
    h.feed(SERVER.translated());
    expect(h.of('segmentText')).toEqual([{ ref: 1, text: 'Welcome' }, { ref: 1, text: EN }]);
    expect(h.of('segmentClosed')).toEqual([{ ref: 1, origin: SENTENCE }]);
  });

  it('gives a final with no id a segment of its own, paired with nothing; drops a partial with no id; plays audio with no id on no segment', () => {
    const h = items();
    const bare = (type: string, transcription: Record<string, unknown>) => JSON.stringify({ message_type: type, data: { transcription } });
    h.feed(bare('partial_transcription', { text: 'lost' }));
    h.feed(bare('validated_transcription', { text: 'Alone.', language: 'en' }));
    h.feed(bare('translated_transcription', { text: 'Seul.' }));
    h.feed(JSON.stringify({ message_type: 'output_audio_data', data: { last_chunk: true, data: '' } }), new Int16Array(240));
    expect(h.log).toEqual([
      { kind: 'segmentOpened', payload: { ref: 1, side: 'source' } },
      { kind: 'segmentText', payload: { ref: 1, text: 'Alone.', language: 'en' } },
      { kind: 'segmentClosed', payload: { ref: 1 } },
      { kind: 'segmentOpened', payload: { ref: 2, side: 'translation' } },
      { kind: 'segmentText', payload: { ref: 2, text: 'Seul.' } },
      { kind: 'segmentClosed', payload: { ref: 2 } },
      { kind: 'audio', payload: { pcm: expect.any(Int16Array) } },
    ]);
  });

  it('keeps sentences apart: two in flight at once pair each with its own', () => {
    const h = items();
    h.feed(SERVER.partial('一つ目', 'a'));
    h.feed(SERVER.partial('二つ目', 'b'));
    h.feed(SERVER.validated('一つ目。', 'a'));
    h.feed(SERVER.translated('Second.', 'b'));
    h.feed(SERVER.validated('二つ目。', 'b'));
    h.feed(SERVER.translated('First.', 'a'));
    expect(h.of('segmentOpened')).toEqual([
      { ref: 1, side: 'source', origin: 'a' },
      { ref: 2, side: 'source', origin: 'b' },
      { ref: 3, side: 'translation', origin: 'b' },
      { ref: 4, side: 'translation', origin: 'a' },
    ]);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  it('a final that repeats its last partial still sends its text, carrying a refined language (fix round 1, m1)', () => {
    const h = items();
    const withLang = (type: string, language: string, text: string) =>
      JSON.stringify({ message_type: type, data: { transcription: { transcription_id: SENTENCE, language, text } } });
    h.feed(withLang('partial_transcription', 'ja', JA));
    h.feed(withLang('validated_transcription', 'zh', JA));
    expect(h.of('segmentText')).toEqual([
      { ref: 1, text: JA, language: 'ja' },
      { ref: 1, text: JA, language: 'zh' },
    ]);
  });

  it('an empty final is sent, never silently skipped for repeating the untouched text (fix round 1, m1)', () => {
    const h = items();
    h.feed(SERVER.validated());
    h.feed(SERVER.translated(''));
    expect(h.of('segmentText').filter((t) => t.ref === 2)).toEqual([{ ref: 2, text: '' }]);
  });

  it("the probe's own case: a final with the same text and the same language as its last partial is still sent (fix round 2, m1)", () => {
    const h = items();
    h.feed(SERVER.partial(JA));
    h.feed(SERVER.validated(JA));
    expect(h.of('segmentText')).toEqual([
      { ref: 1, text: JA, language: 'ja' },
      { ref: 1, text: JA, language: 'ja' },
    ]);
  });

  it("two sentences with overlapping bursts: one sentence's last chunk does not fill the other (fix round 1, m2)", () => {
    const h = items();
    h.feed(SERVER.translated('A.', 'a'));
    h.feed(SERVER.translated('B.', 'b'));
    h.feed(SERVER.audio({ id: 'a' }), new Int16Array(4_800));
    h.feed(SERVER.audio({ id: 'b' }), new Int16Array(4_800));
    h.feed(SERVER.audio({ id: 'a', last: true }), new Int16Array(4_800));
    expect(h.of('speechRanges').map((r) => r.ref)).toEqual([1]);
    h.feed(SERVER.audio({ id: 'b', last: true }), new Int16Array(4_800));
    expect(h.of('speechRanges').map((r) => [r.ref, r.ranges.length])).toEqual([[1, 2], [2, 2]]);
  });

  it('last_chunk per part, bursts in turn: each part filled over its own chunks (fix round 1, m2)', () => {
    const h = items();
    h.feed(SERVER.translated('First part.', SENTENCE, 0));
    h.feed(SERVER.translated('Second part.', SENTENCE, 1));
    h.feed(SERVER.audio({ part: '0' }), new Int16Array(4_800));
    h.feed(SERVER.audio({ part: '0', last: true }), new Int16Array(4_800));
    h.feed(SERVER.audio({ part: '1' }), new Int16Array(4_800));
    h.feed(SERVER.audio({ part: '1', last: true }), new Int16Array(4_800));
    expect(h.of('speechRanges').map((r) => [r.ref, r.ranges.length])).toEqual([[1, 2], [2, 2]]);
  });

  it('the last chunk while the translation is still a partial: filled only at the final text, over the final text (fix round 1, m2)', () => {
    const h = items();
    h.feed(SERVER.translationPartial('Welcome to'));
    h.feed(SERVER.audio(), new Int16Array(4_800));
    h.feed(SERVER.audio({ last: true }), new Int16Array(4_800));
    expect(h.of('speechRanges')).toEqual([]);
    h.feed(SERVER.translated('Welcome to real time.'));
    expect(h.of('speechRanges')).toEqual([{ ref: 1, ranges: [{ index: 0, range: [0, 11] }, { index: 1, range: [11, 21] }] }]);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  it('the final text mid-burst: no fill until the last chunk (fix round 1, m2)', () => {
    const h = items();
    h.feed(SERVER.audio(), new Int16Array(4_800));
    h.feed(SERVER.translated());
    expect(h.of('speechRanges')).toEqual([]);
    h.feed(SERVER.audio({ last: true }), new Int16Array(4_800));
    expect(h.of('speechRanges')).toEqual([{ ref: 1, ranges: [{ index: 0, range: [0, 41] }, { index: 1, range: [41, EN.length] }] }]);
  });

  it('no partial translation after stop() (fix round 1, m2)', () => {
    const h = items();
    h.items.stop();
    h.feed(SERVER.translationPartial('late'));
    expect(h.log).toEqual([]);
  });

  it('a partial translation of part 1 lands on part 1 (fix round 1, m2)', () => {
    const h = items();
    h.feed(SERVER.translated('First part.', SENTENCE, 0));
    h.feed(SERVER.translationPartial('Sec', SENTENCE, 1));
    expect(h.of('segmentOpened')).toHaveLength(2);
    expect(h.of('segmentText')).toEqual([{ ref: 1, text: 'First part.' }, { ref: 2, text: 'Sec' }]);
  });

  // The equal-text skip no longer reaches translationFinal after the m1 fix, so this
  // sends its empty text once instead of staying silent (adapted from the reviewer's
  // pre-fix pin, which expected no segmentText at all here).
  it('an empty translation: opened and closed with its empty text sent once, its audio rangeless, no fill (fix round 1, m2)', () => {
    const h = items();
    h.feed(SERVER.validated());
    h.feed(SERVER.translated(''));
    h.feed(SERVER.audio(), new Int16Array(4_800));
    h.feed(SERVER.audio({ last: true }), new Int16Array(4_800));
    expect(h.of('segmentText').filter((t) => t.ref === 2)).toEqual([{ ref: 2, text: '' }]);
    expect(h.of('segmentClosed')).toEqual([{ ref: 1, origin: SENTENCE }, { ref: 2, origin: SENTENCE }]);
    expect(h.of('audio').map((a) => [a.ref, a.range])).toEqual([[2, undefined], [2, undefined]]);
    expect(h.of('speechRanges')).toEqual([]);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  // The m1 fix moved the equal-text skip for a translation's *final* out of
  // translationText into translationFinal directly, so translationText's own
  // guard is now reachable only through a repeated *partial* (M36).
  it('a partial translation that repeats its last text is not re-sent (fix round 1, m2)', () => {
    const h = items();
    h.feed(SERVER.translationPartial('Welcome'));
    h.feed(SERVER.translationPartial('Welcome'));
    expect(h.of('segmentText')).toEqual([{ ref: 1, text: 'Welcome' }]);
  });

  it('an empty chunk with no id emits nothing (fix round 1, m2, M12)', () => {
    const h = items();
    h.feed(JSON.stringify({ message_type: 'output_audio_data', data: { last_chunk: false, data: '' } }), new Int16Array(0));
    expect(h.log).toEqual([]);
  });

  it('a translation with no part named takes part "0", pairing with its audio (fix round 1, m2, M32)', () => {
    const h = items();
    const bare = (type: string, transcription: Record<string, unknown>) => JSON.stringify({ message_type: type, data: { transcription } });
    h.feed(bare('translated_transcription', { transcription_id: 'x', text: 'Hi' }));
    h.feed(SERVER.audio({ id: 'x', part: '0', last: true }));
    expect(h.of('segmentOpened')).toHaveLength(1);
    expect(h.of('audio')[0].ref).toBe(1);
  });

  it('says nothing once stopped', () => {
    const h = items();
    h.feed(SERVER.partial('リ'));
    h.items.stop();
    h.feed(SERVER.validated());
    h.feed(SERVER.translated());
    h.feed(SERVER.audio({ last: true }));
    expect(h.log).toHaveLength(2);
  });
});

/** Every source row's last text and the origin it closed under, in the order opened; every row closed. */
function sourceRows(h: ReturnType<typeof items>): Array<{ text: string; origin: string | undefined }> {
  const opened = h.of('segmentOpened').filter((e) => e.side === 'source').map((e) => e.ref);
  const closed = new Map(h.of('segmentClosed').map((e) => [e.ref, e.origin] as const));
  return opened.map((ref) => {
    expect(closed.has(ref)).toBe(true);
    const texts = h.of('segmentText').filter((e) => e.ref === ref);
    return { text: texts[texts.length - 1]?.text ?? '', origin: closed.get(ref) };
  });
}

describe("Palabra AI's sentence splitter: a transcription validated in parts (the owner's session, 2026-09-30)", () => {
  const X = '1a0eed43fa309c22';

  it('the first part takes over the row its partial opened, and each later part has a row of its own: one row per part, each paired', () => {
    const h = items();
    h.feed(SERVER.partial('7年後までに、', X));
    h.feed(SERVER.partial('7年後までに、75人を目標に手術を行います。これが確実な有効性を示していくステップになる、ということなんです。', X));
    h.feed(SERVER.validated('7年後までに、75人を目標に手術を行います。', `${X}_part_0`));
    h.feed(SERVER.translated('我们的目标是在7年内完成75例手术。', `${X}_part_0`));
    h.feed(SERVER.validated('これが確実な有効性を示していくステップになる、ということなんです。', `${X}_part_1`));
    h.feed(SERVER.translated('这将是证明其确切有效性的关键步骤。', `${X}_part_1`));
    expect(sourceRows(h)).toEqual([
      { text: '7年後までに、75人を目標に手術を行います。', origin: `${X}_part_0` },
      { text: 'これが確実な有効性を示していくステップになる、ということなんです。', origin: `${X}_part_1` },
    ]);
    expect(h.of('segmentOpened').filter((e) => e.side === 'translation').map((e) => e.origin)).toEqual([`${X}_part_0`, `${X}_part_1`]);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });

  it("a partial whose id turns from the transcription's own to its first part's stays on the one row", () => {
    const h = items();
    h.feed(SERVER.partial('差は名誉教授によりますと、', X));
    h.feed(SERVER.partial('差は名誉教授によりますと、心臓を止め', `${X}_part_0`));
    h.feed(SERVER.validated('差は名誉教授によりますと、心臓を止めることなく、', `${X}_part_0`));
    h.feed(SERVER.partial('シートを乗せるだけで', `${X}_part_1`));
    h.feed(SERVER.validated('シートを乗せるだけで1時間程度で終ることが大事だということです。', `${X}_part_1`));
    expect(sourceRows(h)).toEqual([
      { text: '差は名誉教授によりますと、心臓を止めることなく、', origin: `${X}_part_0` },
      { text: 'シートを乗せるだけで1時間程度で終ることが大事だということです。', origin: `${X}_part_1` },
    ]);
  });

  it('a partial that still repeats the parts already validated shows only the rest, which the next part then takes over', () => {
    const h = items();
    h.feed(SERVER.partial('はい。今後、日本から世界へ', X));
    h.feed(SERVER.validated('はい。', `${X}_part_0`));
    h.feed(SERVER.partial('はい。 今後、日本から世界へ普及させていくには、', X));
    expect(h.of('segmentText').slice(-1)).toEqual([{ ref: 2, text: '今後、日本から世界へ普及させていくには、', language: 'ja' }]);
    h.feed(SERVER.validated('今後、日本から世界へ普及させていくには、どんなポイントがありますか。', `${X}_part_1`));
    expect(sourceRows(h)).toEqual([
      { text: 'はい。', origin: `${X}_part_0` },
      { text: '今後、日本から世界へ普及させていくには、どんなポイントがありますか。', origin: `${X}_part_1` },
    ]);
  });

  it('a partial that says nothing beyond the parts already validated opens no row', () => {
    const h = items();
    h.feed(SERVER.partial('はい。', X));
    h.feed(SERVER.validated('はい。', `${X}_part_0`));
    h.feed(SERVER.partial('はい。', X));
    expect(sourceRows(h)).toEqual([{ text: 'はい。', origin: `${X}_part_0` }]);
  });

  it("the owner's second exchange: a partial running on into the next transcription's words leaves no row behind", () => {
    const h = items();
    const Y = '1a0eed48da26c1aa';
    h.feed(SERVER.partial('はい。今後、日本から世界へ普及させていくには、どんなポイントがありますか。 はい。まずは手術のシンプルさです。', X));
    h.feed(SERVER.validated('はい。', `${X}_part_0`));
    h.feed(SERVER.translated('是的。', `${X}_part_0`));
    h.feed(SERVER.validated('今後、日本から世界へ普及させていくには、どんなポイントがありますか。', `${X}_part_1`));
    h.feed(SERVER.translated('那么，今后要将这项技术从日本推广到全世界，有哪些关键点呢。', `${X}_part_1`));
    h.feed(SERVER.partial('はい。まずは手術のシンプルさです。差は名誉教授によりますと、', Y));
    h.feed(SERVER.validated('はい。', `${Y}_part_0`));
    h.feed(SERVER.translated('是的。', `${Y}_part_0`));
    h.feed(SERVER.validated('まずは手術のシンプルさです。', `${Y}_part_1`));
    h.feed(SERVER.translated('首先是手术的简便性。', `${Y}_part_1`));
    expect(sourceRows(h).map((r) => r.text)).toEqual(['はい。', '今後、日本から世界へ普及させていくには、どんなポイントがありますか。', 'はい。', 'まずは手術のシンプルさです。']);
    expect(h.of('segmentClosed').filter((e) => e.origin?.endsWith('_part_1'))).toHaveLength(4);
    expect(checkConformance(h.log, AUTO)).toEqual([]);
  });
});
