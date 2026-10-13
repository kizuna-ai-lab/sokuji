import { describe, it, expect } from 'vitest';
import { recordEvents } from '../../lib/contract/events';
import { QwenSegments } from './segments';

function segments(person = false) {
  const { events, log } = recordEvents();
  const s = new QwenSegments({ sink: events, person });
  /** The log as `[kind, payload]`, audio by its ref and sample count. */
  const seen = () => log.map((e) => (e.kind === 'audio' ? ['audio', { ref: e.payload.ref, samples: e.payload.pcm.length }] : [e.kind, e.payload]));
  return { s, log, seen };
}
const pcm = (n = 240) => new Int16Array(n).fill(900);

describe("Qwen LiveTranslate's segments (spec §6)", () => {
  it('opens each side with its first words, sends the whole text on every delta, and closes on the final text', () => {
    const { s, seen } = segments();
    s.heard('h1', 1);
    s.answer('t1');
    s.answer('t1', 'h1');
    s.text('h1', 'source', '欢迎使用实时翻译 ');
    s.text('t1', 'translation', 'Welcome');
    s.text('t1', 'translation', ' to');
    s.audio('t1', pcm());
    s.text('h1', 'source', '希望');
    s.done('h1', 'source', '欢迎使用实时翻译 希望这个声音 ');
    s.done('t1', 'translation', 'Welcome to it. ');
    expect(seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'h1' }],
      ['segmentText', { ref: 1, text: '欢迎使用实时翻译' }],
      ['segmentOpened', { ref: 2, side: 'translation', origin: 'h1' }],
      ['segmentText', { ref: 2, text: 'Welcome' }],
      ['segmentText', { ref: 2, text: 'Welcome to' }],
      ['audio', { ref: 2, samples: 240 }],
      ['segmentText', { ref: 1, text: '欢迎使用实时翻译 希望' }],
      ['segmentText', { ref: 1, text: '欢迎使用实时翻译 希望这个声音' }],
      ['segmentClosed', { ref: 1 }],
      ['segmentText', { ref: 2, text: 'Welcome to it.' }],
      ['segmentClosed', { ref: 2 }],
    ]);
  });

  it("labels both sides with the heard item's speaker on the participant leg, and never on mine", () => {
    const mine = segments(false);
    mine.s.heard('h1', 2);
    mine.s.answer('t1', 'h1');
    mine.s.text('h1', 'source', 'a');
    mine.s.text('t1', 'translation', 'b');
    expect(JSON.stringify(mine.log)).not.toContain('person');

    const theirs = segments(true);
    theirs.s.heard('h1', 2);
    theirs.s.answer('t1', 'h1');
    theirs.s.text('h1', 'source', 'a');
    theirs.s.text('t1', 'translation', 'b');
    expect(theirs.seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'h1', person: '2' }],
      ['segmentText', { ref: 1, text: 'a', person: '2' }],
      ['segmentOpened', { ref: 2, side: 'translation', origin: 'h1', person: '2' }],
      ['segmentText', { ref: 2, text: 'b', person: '2' }],
    ]);
  });

  it('opens items it only meets in a delta (manual turns name no speech start), with no person', () => {
    const { s, seen } = segments(true);
    s.text('h1', 'source', 'hi');
    s.done('h1', 'source', 'hi');
    expect(seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'h1' }],
      ['segmentText', { ref: 1, text: 'hi' }],
      ['segmentClosed', { ref: 1 }],
    ]);
  });

  it('states the origin when the translation closes, when its link came after it opened', () => {
    const { s, seen } = segments();
    s.heard('h1');
    s.text('t1', 'translation', 'Hello');
    s.answer('t1', 'h1');
    s.done('t1', 'translation', 'Hello.');
    expect(seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'translation' }],
      ['segmentText', { ref: 1, text: 'Hello' }],
      ['segmentText', { ref: 1, text: 'Hello.' }],
      ['segmentClosed', { ref: 1, origin: 'h1' }],
    ]);
  });

  it('shows nothing for an empty turn or a blank delta, and keeps the words it has when the final text is empty', () => {
    const empty = segments();
    empty.s.heard('h1', 1);
    empty.s.answer('t1', 'h1');
    empty.s.text('h1', 'source', ' ');
    empty.s.done('h1', 'source', '');
    empty.s.done('t1', 'translation', '');
    empty.s.audio('t1', pcm());
    expect(empty.log).toEqual([]);

    const kept = segments();
    kept.s.text('t1', 'translation', 'Hello.');
    kept.s.done('t1', 'translation', '');
    expect(kept.seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'translation' }],
      ['segmentText', { ref: 1, text: 'Hello.' }],
      ['segmentClosed', { ref: 1 }],
    ]);
  });

  it("plays audio that comes after the text's done in the translation's segment", () => {
    const { s, seen } = segments();
    s.text('t1', 'translation', 'Hi.');
    s.done('t1', 'translation', 'Hi.');
    s.audio('t1', pcm(100));
    const all = seen();
    expect(all[all.length - 1]).toEqual(['audio', { ref: 1, samples: 100 }]);
  });

  it('a cancel closes what is open with what it holds, and nothing more of those items is heard — a translation created after it included', () => {
    const { s, seen } = segments();
    s.heard('h1');
    s.text('h1', 'source', 'half a');
    s.answer('t0');
    s.cancel();
    s.text('h1', 'source', ' sentence');
    s.done('h1', 'source', 'half a sentence');
    s.text('t0', 'translation', 'late');
    s.audio('t0', pcm());
    s.answer('t1', 'h1');
    s.text('t1', 'translation', 'Half a');
    s.audio('t1', pcm());
    s.done('t1', 'translation', 'Half a sentence.');
    expect(seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'h1' }],
      ['segmentText', { ref: 1, text: 'half a' }],
      ['segmentClosed', { ref: 1 }],
    ]);
    // A new turn after the server confirmed the clear is heard as usual.
    s.cleared();
    s.text('h2', 'source', 'next');
    const all = seen();
    expect(all[all.length - 1]).toEqual(['segmentText', { ref: 2, text: 'next' }]);
  });

  it("a cancel before the turn's first event arrives drops whatever the server sends for it until it confirms the clear", () => {
    const { s, log, seen } = segments();
    s.cancel();
    s.created('h1', { inputAudio: true, previous: null });
    s.text('h1', 'source', 'too short');
    s.answer('t1');
    s.answer('t1', 'h1');
    s.text('t1', 'translation', 'Too short');
    s.audio('t1', pcm());
    s.done('t1', 'translation', 'Too short.');
    expect(log).toEqual([]);
    s.cleared();
    s.text('h2', 'source', 'next turn');
    expect(seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'h2' }],
      ['segmentText', { ref: 1, text: 'next turn' }],
    ]);
  });

  it('a cancel leaves the turn already committed alone: its translation still arriving is shown and closed', () => {
    const { s, seen } = segments();
    s.heard('h1');
    s.text('h1', 'source', 'first');
    s.answer('t1', 'h1');
    s.text('t1', 'translation', 'Fir');
    s.committed();
    s.heard('h2');
    s.text('h2', 'source', 'half');
    s.cancel();
    s.text('t1', 'translation', 'st.');
    s.done('t1', 'translation', 'First.');
    expect(seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'h1' }],
      ['segmentText', { ref: 1, text: 'first' }],
      ['segmentOpened', { ref: 2, side: 'translation', origin: 'h1' }],
      ['segmentText', { ref: 2, text: 'Fir' }],
      ['segmentOpened', { ref: 3, side: 'source', origin: 'h2' }],
      ['segmentText', { ref: 3, text: 'half' }],
      ['segmentClosed', { ref: 3 }],
      ['segmentText', { ref: 2, text: 'First.' }],
      ['segmentClosed', { ref: 2 }],
    ]);
  });

  it('without a confirmed clear, the next commit ends the suppression', () => {
    const { s, seen } = segments();
    s.cancel();
    s.text('hx', 'source', 'lost');
    s.committed();
    s.text('h3', 'source', 'heard');
    expect(seen()).toEqual([
      ['segmentOpened', { ref: 1, side: 'source', origin: 'h3' }],
      ['segmentText', { ref: 1, text: 'heard' }],
    ]);
  });

  it('ignores an id named for the other side, and anything after stop', () => {
    const { s, log } = segments();
    s.heard('h1');
    s.text('h1', 'translation', 'not a translation');
    s.audio('h1', pcm());
    expect(log).toEqual([]);
    s.stop();
    s.text('h2', 'source', 'after');
    s.done('h2', 'source', 'after');
    expect(log).toEqual([]);
  });
});
