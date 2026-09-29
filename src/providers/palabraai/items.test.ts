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
