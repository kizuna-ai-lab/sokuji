// src/lib/plan/speechFeed.test.ts
import { describe, expect, it } from 'vitest';
import type { Ref, TextRange } from '../contract/adapter';
import { createSpeechFeed } from './speechFeed';

type Call = ['speak', Ref, string, TextRange, string] | ['end', Ref];

/** A feed whose sink lists what it is asked; the leg's target is `en`. */
function feed(target = 'en') {
  const calls: Call[] = [];
  const made = createSpeechFeed({
    speak: (ref, text, span, language) => { calls.push(['speak', ref, text, span, language]); },
    end: (ref) => { calls.push(['end', ref]); },
  }, () => target);
  return { feed: made, calls };
}

describe('createSpeechFeed', () => {
  it('speaks the stable text not yet spoken, with its span and the target language', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 1, side: 'translation' });
    f.text({ ref: 1, text: 'Hello, wor', stableLen: 7 });
    expect(calls).toEqual([['speak', 1, 'Hello, ', [0, 7], 'en']]);
    f.text({ ref: 1, text: 'Hello, world. How', stableLen: 14 });
    expect(calls).toEqual([['speak', 1, 'Hello, ', [0, 7], 'en'], ['speak', 1, 'world. ', [7, 14], 'en']]);
  });

  it('speaks nothing for a stable length it has already spoken up to', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 1, side: 'translation' });
    f.text({ ref: 1, text: 'Hello, wor', stableLen: 7 });
    f.text({ ref: 1, text: 'Hello, world', stableLen: 7 });
    f.text({ ref: 1, text: 'Hello, world', stableLen: 0 });
    expect(calls).toHaveLength(1);
  });

  it('speaks nothing yet for a text that states no stable length', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 1, side: 'translation' });
    f.text({ ref: 1, text: 'Hello, world.' });
    expect(calls).toEqual([]);
  });

  it("speaks in the language the segment's text states, and in the target's when it states none", () => {
    const { feed: f, calls } = feed('en');
    f.opened({ ref: 1, side: 'translation' });
    f.text({ ref: 1, text: 'Bonjour. ', stableLen: 9, language: 'fr' });
    f.opened({ ref: 2, side: 'translation' });
    f.text({ ref: 2, text: 'Hi.', stableLen: 3 });
    expect(calls.map((c) => c[4])).toEqual(['fr', 'en']);
  });

  it('keeps the language a segment stated for its later texts, as the conversation does', () => {
    const { feed: f, calls } = feed('en');
    f.opened({ ref: 1, side: 'translation' });
    f.text({ ref: 1, text: 'Bonjour. ', stableLen: 9, language: 'fr' });
    f.text({ ref: 1, text: 'Bonjour. Salut.', stableLen: 15 });
    expect(calls.map((c) => c[4])).toEqual(['fr', 'fr']);
  });

  it('reads the target when it speaks, not when it is made', () => {
    let target = 'en';
    const calls: string[] = [];
    const f = createSpeechFeed({ speak: (_ref, _text, _span, language) => { calls.push(language); }, end: () => {} }, () => target);
    f.opened({ ref: 1, side: 'translation' });
    target = 'ja';
    f.text({ ref: 1, text: 'Hi.', stableLen: 3 });
    expect(calls).toEqual(['ja']);
  });

  it('on close reads no further than the last stable length the segment stated, then ends the utterance', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 1, side: 'translation' });
    f.text({ ref: 1, text: 'Hello, wor', stableLen: 7 });
    f.text({ ref: 1, text: 'Hello, world.' });
    f.closed({ ref: 1 });
    // What lies past the stable length was never said to stay: it is not read.
    expect(calls).toEqual([['speak', 1, 'Hello, ', [0, 7], 'en'], ['end', 1]]);
  });

  it('on close reads up to the last stable length stated, when a later text has outgrown what was read', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 1, side: 'translation' });
    f.text({ ref: 1, text: 'Hello, world.', stableLen: 13 });
    // A revised row, shorter than what was read; then the row grows again without stating a stable length.
    f.text({ ref: 1, text: 'Hello.', stableLen: 6 });
    f.text({ ref: 1, text: 'Hello. And more to come' });
    f.closed({ ref: 1 });
    expect(calls).toEqual([['speak', 1, 'Hello, world.', [0, 13], 'en'], ['end', 1]]);
  });

  it('on close speaks a text that never stated a stable length whole, in the language it last stated', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 4, side: 'translation' });
    f.text({ ref: 4, text: 'Bonjour.', language: 'fr' });
    f.text({ ref: 4, text: 'Bonjour à tous.' });
    f.closed({ ref: 4 });
    expect(calls).toEqual([['speak', 4, 'Bonjour à tous.', [0, 15], 'fr'], ['end', 4]]);
  });

  it('on close only ends the utterance when nothing is left to speak', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 1, side: 'translation' });
    f.text({ ref: 1, text: 'Hi.', stableLen: 3 });
    f.closed({ ref: 1 });
    f.opened({ ref: 2, side: 'translation' });
    f.closed({ ref: 2 });
    expect(calls).toEqual([['speak', 1, 'Hi.', [0, 3], 'en'], ['end', 1], ['end', 2]]);
  });

  it('speaks nothing for a text shorter than what was spoken, and does not go back', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 1, side: 'translation' });
    f.text({ ref: 1, text: 'Hello, world.', stableLen: 13 });
    f.text({ ref: 1, text: 'Hello.', stableLen: 6 });
    f.text({ ref: 1, text: 'Hello.' });
    expect(calls).toHaveLength(1);
    // What comes after still counts from what was spoken, not from the shorter text.
    f.text({ ref: 1, text: 'Hello, world. Again.', stableLen: 20 });
    expect(calls[1]).toEqual(['speak', 1, ' Again.', [13, 20], 'en']);
    f.text({ ref: 1, text: 'Short.' });
    f.closed({ ref: 1 });
    expect(calls.slice(2)).toEqual([['end', 1]]);
  });

  it('never speaks beyond the text, whatever stable length it is told', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 1, side: 'translation' });
    f.text({ ref: 1, text: 'Hi.', stableLen: 9 });
    f.closed({ ref: 1 });
    expect(calls).toEqual([['speak', 1, 'Hi.', [0, 3], 'en'], ['end', 1]]);
  });

  it('ignores a segment that was never opened as a translation', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 1, side: 'source' });
    f.text({ ref: 1, text: 'heard words', stableLen: 11 });
    f.closed({ ref: 1 });
    f.text({ ref: 2, text: 'never opened', stableLen: 12 });
    f.closed({ ref: 2 });
    expect(calls).toEqual([]);
  });

  it('ignores a text for a segment it has closed', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 1, side: 'translation' });
    f.text({ ref: 1, text: 'Hi.' });
    f.closed({ ref: 1 });
    f.text({ ref: 1, text: 'Hi there.', stableLen: 9 });
    f.closed({ ref: 1 });
    expect(calls).toEqual([['speak', 1, 'Hi.', [0, 3], 'en'], ['end', 1]]);
  });

  it('keeps each segment to its own place', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 1, side: 'translation' });
    f.opened({ ref: 2, side: 'translation' });
    f.text({ ref: 1, text: 'One. ', stableLen: 5 });
    f.text({ ref: 2, text: 'Two. ', stableLen: 5 });
    f.text({ ref: 1, text: 'One. More.', stableLen: 10 });
    expect(calls.map((c) => [c[1], c[3]])).toEqual([[1, [0, 5]], [2, [0, 5]], [1, [5, 10]]]);
  });

  it('after reset forgets every open segment, speaking and ending nothing for them', () => {
    const { feed: f, calls } = feed();
    f.opened({ ref: 1, side: 'translation' });
    f.text({ ref: 1, text: 'Hello, wor', stableLen: 7 });
    f.reset();
    f.text({ ref: 1, text: 'Hello, world.', stableLen: 13 });
    f.closed({ ref: 1 });
    expect(calls).toHaveLength(1);
    f.opened({ ref: 2, side: 'translation' });
    f.text({ ref: 2, text: 'Hi.', stableLen: 3 });
    expect(calls[1]).toEqual(['speak', 2, 'Hi.', [0, 3], 'en']);
  });
});
