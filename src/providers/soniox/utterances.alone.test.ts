// Soniox's tokens when its socket transcribes alone: source segments only, each stating how much of it is final.
import { describe, it, expect } from 'vitest';
import { createVirtualClock } from '../../lib/contract/clock';
import type { SonioxToken } from './sttStream';
import { Utterances, type SegmentEvent, type UtteranceOptions } from './utterances';

const orig = (text: string, is_final = false, more: Partial<SonioxToken> = {}): SonioxToken => ({ text, is_final, translation_status: 'none', language: 'en', ...more });
const tr = (text: string, is_final = true): SonioxToken => ({ text, is_final, translation_status: 'translation', language: 'ja', source_language: 'en' });
const END: SonioxToken = { text: '<end>', is_final: true };
const FIN: SonioxToken = { text: '<fin>', is_final: true };

function make(o: Partial<Pick<UtteranceOptions, 'heardAt' | 'sourceOnly'>> = { sourceOnly: true }) {
  const segments: SegmentEvent[] = [];
  const clock = createVirtualClock(0);
  const machine = new Utterances({ clock, legFor: () => 'speaker', targetFor: () => 'ja', sink: { segment: (_leg, s) => segments.push(s) }, ...o });
  /** Each source snapshot as [text, stable length stated]. */
  const texts = () => segments.flatMap((s) => (s.kind === 'segmentText' ? [[s.payload.text, s.payload.heard?.stableLen]] : []));
  const kinds = () => segments.map((s) => s.kind);
  return { machine, clock, segments, texts, kinds };
}

describe('Utterances: a socket that transcribes alone', () => {
  it('states a growing stable length as tokens turn final, with no table to place the words by', () => {
    const h = make();
    h.machine.message([orig('Hello')]);
    h.machine.message([orig('Hello.', true), orig(' How are')]);
    h.machine.message([orig(' How are', true), orig(' you')]);
    expect(h.texts()).toEqual([['Hello', undefined], ['Hello. How are', 6], ['Hello. How are you', 14]]);
    // No word could be placed on the clock: the pieces are none, and the stable length is stated all the same.
    expect(h.segments.flatMap((s) => (s.kind === 'segmentText' && s.payload.heard ? [s.payload.heard.pieces] : []))).toEqual([[], []]);
  });

  it('a source whose tokens are all final states its whole length, and says so again when a partial turns final with the same words', () => {
    const h = make();
    h.machine.message([orig('Good morning.', true)]);
    expect(h.texts()).toEqual([['Good morning.', 13]]);
    const g = make();
    g.machine.message([orig('Good morning.')]);
    g.machine.message([orig('Good morning.', true)]);
    expect(g.texts()).toEqual([['Good morning.', undefined], ['Good morning.', 13]]);
  });

  it('keeps the pieces of the words the table places, beside the stable length', () => {
    const h = make({ sourceOnly: true, heardAt: (ms) => (ms < 1000 ? 50_000 + ms : undefined) });
    h.machine.message([orig('a', true, { start_ms: 0, end_ms: 100 }), orig('b', true, { start_ms: 5000, end_ms: 5100 }), orig('c')]);
    const last = h.segments.filter((s): s is Extract<SegmentEvent, { kind: 'segmentText' }> => s.kind === 'segmentText').pop()!;
    expect(last.payload).toMatchObject({ text: 'abc', heard: { pieces: [{ at: 0, len: 1, startAt: 50_000, endAt: 50_100 }], stableLen: 2 } });
  });

  it('says source segments only: a token marked as a translation opens nothing, before a boundary or after', () => {
    const h = make();
    h.machine.message([orig('Hello.', true), tr('こんにちは。'), tr('partial', false)]);
    h.machine.message([END, tr('late')]);
    h.machine.message([tr('later still')]);
    expect(h.segments.filter((s) => s.kind === 'segmentOpened').map((s) => s.payload)).toEqual([{ ref: 1, side: 'source', origin: 'u1' }]);
    expect(h.kinds()).toEqual(['segmentOpened', 'segmentText', 'segmentClosed']);
  });

  it('closes its source at the endpoint and at `<fin>` alike, at once, and arms no grace', () => {
    for (const boundary of [END, FIN]) {
      const h = make();
      h.machine.message([orig('One.', true), boundary]);
      expect(h.kinds()).toEqual(['segmentOpened', 'segmentText', 'segmentClosed']);
      expect(h.clock.pending()).toBe(0);
      // The next utterance has its own origin and the next ref.
      h.machine.message([orig('Two.', true), boundary]);
      expect(h.segments.filter((s) => s.kind === 'segmentOpened').map((s) => s.payload)).toEqual([
        { ref: 1, side: 'source', origin: 'u1' }, { ref: 2, side: 'source', origin: 'u2' },
      ]);
      expect(h.segments.filter((s) => s.kind === 'segmentClosed').map((s) => s.payload)).toEqual([{ ref: 1, origin: 'u1' }, { ref: 2, origin: 'u2' }]);
    }
  });

  it('a partial that the boundary makes final is stated whole before the close', () => {
    const h = make();
    h.machine.message([orig('Thank')]);
    h.machine.message([orig('Thank you.', true), END]);
    expect(h.texts()).toEqual([['Thank', undefined], ['Thank you.', 10]]);
    expect(h.kinds().slice(-1)).toEqual(['segmentClosed']);
  });

  it('a swapped socket closes the open source as it stands, once, and the next utterance goes on', () => {
    const h = make();
    h.machine.message([orig('Before the drop.', true), orig(' And then')]);
    h.machine.abandon();
    h.machine.abandon();
    expect(h.segments.filter((s) => s.kind === 'segmentClosed').map((s) => s.payload)).toEqual([{ ref: 1, origin: 'u1' }]);
    expect(h.texts()).toEqual([['Before the drop. And then', 16]]);
    h.machine.message([orig('Back again.', true), END]);
    expect(h.segments.filter((s) => s.kind === 'segmentOpened').map((s) => s.payload)).toEqual([
      { ref: 1, side: 'source', origin: 'u1' }, { ref: 2, side: 'source', origin: 'u2' },
    ]);
  });
});

describe('Utterances: a socket that also translates is as it was', () => {
  it('states no stable length without a placed word, and still opens its translation and waits out the grace after `<fin>`', () => {
    const h = make({});
    h.machine.message([orig('Hello.', true), tr('こんにちは。')]);
    expect(h.texts().filter(([text]) => text === 'Hello.')).toEqual([['Hello.', undefined]]);
    h.machine.message([FIN]);
    expect(h.segments.filter((s) => s.kind === 'segmentOpened').map((s) => s.payload.side)).toEqual(['source', 'translation']);
    expect(h.clock.pending()).toBe(1);
  });
});
