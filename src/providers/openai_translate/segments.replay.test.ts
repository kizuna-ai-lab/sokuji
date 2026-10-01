import { describe, it, expect } from 'vitest';
import { RECORDINGS, replay } from '../../lib/segmentation/recordings/replay.testing';
import type { TranslateConfig } from './config';
import { TranslateSegments } from './segments';

/**
 * Each exchange the panel shows: its source's first four characters, and
 * its translation's first two words and last word — the pair's two ends.
 * Read from the spike's report, where the translation of each sentence is
 * the one whose audio says it (whisper-1's word timestamps).
 */
const EXPECTED = {
  user: [
    ['今天我去', 'Today I', 'Japanese.'], ['店里的装', 'The interior', 'up.'], ['看起来十', 'It looked', 'done.'],
    ['下午快接', 'Since it', 'rush.'], ['排骨有点', 'The ribs', 'soup.'], ['店里的贩', "The shop's", 'bills.'],
  ],
  tight: [
    ['今天我吃', 'Today I', 'Japanese.'], ['店里的装', 'The place', 'carelessly.'], ['看起来十', 'It looks', 'done.'],
    ['下午快接', 'By late', 'alone.'], ['排骨有点', 'The ribs', 'eat.'], ['店里的贩', 'The vending', 'bills.'],
  ],
  long: [
    ['今天我去', 'Today I', 'Japanese.'], ['店里的装', 'The place', 'it.'], ['下午快接', 'It was', 'it.'], ['排骨有点', 'The ribs', 'soup.'],
    ['店里的贩', 'The vending', 'notes.'], ['吃完以后', 'After I', 'while.'], ['天气有点', 'It was', 'lovely.'],
  ],
} as const;

describe("OpenAI Translate's segments on the spike's three recorded sessions (Stage 2 translation cuts, ruling 1; choice 15)", () => {
  it.each([
    ['by pause, at the default pauses', { sourceMs: 1500, translationMs: 1500, deferMidSentence: false }],
    ['by sentence', { sourceMs: 1500, translationMs: 1500, deferMidSentence: true }],
    ["with the translation's pause at 3 s, past every pause of the interpreter's", { sourceMs: 1500, translationMs: 3000, deferMidSentence: false }],
  ] as ReadonlyArray<[string, TranslateConfig['silence']]>)('gives every source its own translation, stated, and leaves none alone — %s', (_name, silence) => {
    for (const name of ['user', 'tight', 'long'] as const) {
      const r = replay(RECORDINGS[name], (clock, sink) => {
        const s = new TranslateSegments({ clock, silence, sink });
        return { input: (d) => s.input(d), output: (d) => s.output(d), audio: (pcm) => s.audio(pcm, true) };
      });
      const sources = EXPECTED[name].length;
      expect({ name, sources: r.sources, paired: r.paired, orphans: r.orphans }).toEqual({ name, sources, paired: sources, orphans: 0 });
      expect(r.pairings).toEqual(new Array(sources).fill('stated'));
      expect(r.exchanges.map(([source, translation]) => {
        const words = translation.split(' ');
        return [source.slice(0, 4), words.slice(0, 2).join(' '), words[words.length - 1]];
      })).toEqual(EXPECTED[name]);
    }
  });
});
