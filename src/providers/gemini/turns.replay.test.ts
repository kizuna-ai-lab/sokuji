import { describe, it, expect } from 'vitest';
import { RECORDINGS, replay } from '../../lib/segmentation/recordings/replay.testing';
import type { GeminiConfig } from './config';
import { GeminiTurns } from './turns';

const PAUSE: NonNullable<GeminiConfig['silence']> = { sourceMs: 1500, translationMs: 1500, deferMidSentence: false };

/** A recording fed as Gemini's adapter feeds `GeminiTurns`: each transcription, and audio that neither opens a translation nor holds one open (choice 8). */
function live(name: keyof typeof RECORDINGS, silence: NonNullable<GeminiConfig['silence']>) {
  return replay(RECORDINGS[name], (clock, sink) => {
    const t = new GeminiTurns({ kind: 'translate', speech: true, clock, silence, sink });
    return { input: (d) => t.input(d), output: (d) => t.output(d), audio: (pcm) => t.audio(pcm) };
  });
}

describe("Gemini Live Translate's segments on recorded sessions (Stage 2 translation cuts, ruling 3; choice 15)", () => {
  it("a recorded Live Translate session, `3.5-live-translate-preview` ja → en, pushed to talk — its source split where one press ended and the next began: each source with its own translation, stated — at a 0.8 s translation pause too, where each side on its own left seven fragments alone", () => {
    const expected = [
      ['リアルタイムファンキアよそうシーズンな会話お手伝い', "Real-time Funky it is, so it's a seasonal conversation, I'm"],
      ['します。リアルタイムファンキアよそうシーズンな会話お手伝い', "here to help. Real-time Funky it is, so it's a seasonal conversation, I'm here to help."],
    ];
    for (const silence of [PAUSE, { ...PAUSE, translationMs: 800 }]) {
      const r = live('geminiLiveTranslate', silence);
      expect({ translationMs: silence.translationMs, sources: r.sources, paired: r.paired, orphans: r.orphans }).toEqual({ translationMs: silence.translationMs, sources: 2, paired: 2, orphans: 0 });
      expect(r.pairings).toEqual(['stated', 'stated']);
      expect(r.exchanges).toEqual(expected);
    }
  });

  it("the OpenAI Translate spike's sessions, fed as Live Translate feeds them: every source with its own translation, stated, none alone", () => {
    for (const [name, sources] of [['user', 6], ['tight', 6], ['long', 7]] as const) {
      const r = live(name, PAUSE);
      expect({ name, sources: r.sources, paired: r.paired, orphans: r.orphans }).toEqual({ name, sources, paired: sources, orphans: 0 });
      expect(r.pairings).toEqual(new Array(sources).fill('stated'));
    }
  });
});
