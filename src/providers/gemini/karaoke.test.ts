/**
 * Gemini's karaoke by arrival, through the adapter into L1 (Gemini/AST2
 * follow-up, ruling 2): each played chunk carries the stretch of the
 * translation that had arrived with it, and L1 holds those ranges against
 * the text it shows. The probe's two shapes: a dialogue model's text and
 * audio together, faster than real time; Live Translate's real-time stream.
 */
import { describe, it, expect } from 'vitest';
import { Conversation } from '../../lib/conversation/Conversation';
import { AUTO_CTX, liveGemini, SERVER, TRANSLATE } from './testing';

async function folded(model?: string) {
  const h = await liveGemini(model ? { model } : undefined);
  const conv = new Conversation({ leg: 'speaker', session: 'gemini', languages: AUTO_CTX.direction, clock: h.clock });
  const translation = () => {
    for (const e of h.content()) conv.apply(e);
    return conv.snapshot().segments.find((s) => s.side === 'translation')!;
  };
  return { h, translation };
}

describe("Gemini's karaoke by arrival (Gemini/AST2 follow-up, ruling 2)", () => {
  it("a dialogue model: each played chunk ranged over the text that came with it", async () => {
    const { h, translation } = await folded();
    h.socket().receive(SERVER.input('リアルタイム翻訳へようこそ。'));
    h.socket().receive(SERVER.output('Welcome to real-time translation.'));
    h.socket().receive(SERVER.audio(1200));
    h.socket().receive(SERVER.audio(1200));
    h.socket().receive(SERVER.output(' I will assist.'));
    h.socket().receive(SERVER.audio(1200));
    h.socket().receive(SERVER.turnComplete());
    const t = translation();
    expect(t.text).toBe('Welcome to real-time translation. I will assist.');
    expect(t.speech.map((s) => s.range)).toEqual([[0, 33], [33, 33], [33, 48]]);
  });

  it('Live Translate: a real-time chunk after each phrase takes it, and the silent ones between hold where they are', async () => {
    const { h, translation } = await folded(TRANSLATE);
    h.socket().receive(SERVER.output('Real-time Funky'));
    h.socket().receive(SERVER.audio(6000));
    h.socket().receive(SERVER.audio(6000));
    h.socket().receive(SERVER.output(' it is, so'));
    h.socket().receive(SERVER.audio(6000));
    const t = translation();
    expect(t.text).toBe('Real-time Funky it is, so');
    expect(t.speech.map((s) => s.range)).toEqual([[0, 15], [15, 15], [15, 25]]);
  });
});
