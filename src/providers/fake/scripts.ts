import { framedScript, longScript, reflessStreamScript } from './generate';
import { exchange, type FakeScript } from './script';

export type FakeScriptName = 'exchange' | 'cjk' | 'rewrite' | 'long' | 'notices' | 'refless-stream' | 'framed' | 'rangeless' | 'reconnect';

/** In the order the fake's settings list them. */
export const FAKE_SCRIPT_NAMES: readonly FakeScriptName[] = ['exchange', 'cjk', 'rewrite', 'long', 'notices', 'refless-stream', 'framed', 'rangeless', 'reconnect'];

/** The scripts the fake can play (spec: "Testing" — script playback and the shape knobs). */
export function fakeScript(name: FakeScriptName): FakeScript {
  switch (name) {
    case 'exchange':
      // Two English → Japanese exchanges with stated origins and ranged audio.
      return {
        blocks: [
          exchange({ startAt: 500, ref: 1, source: ['Hello', 'Hello, how are', 'Hello, how are you?'], translation: 'こんにちは、お元気ですか？', origin: 'x1', audioChunks: 3 }),
          exchange({ startAt: 5000, ref: 3, source: ['I am fine.', 'I am fine. Thank you.'], translation: '元気です。ありがとう。', origin: 'x2', audioChunks: 2 }),
        ],
      };
    case 'cjk':
      // Several sentences with no spaces between them, so rows must tile the text.
      return {
        blocks: [
          exchange({ startAt: 500, ref: 1, source: ['今日は', '今日は天気がいいですね。公園に行きましょう。'], translation: '今天天气很好。我们去公园吧。', origin: 'c1', audioChunks: 2 }),
        ],
      };
    case 'rewrite':
      // The second partial changes letters rather than growing; the translation
      // has no terminal punctuation, so punctuation fill-in runs.
      return {
        blocks: [
          exchange({ startAt: 500, ref: 1, source: ['I scream', 'Ice cream'], translation: 'アイスクリーム', origin: 'r1', audioChunks: 1 }),
        ],
      };
    case 'long':
      // Enough segments to load the projection.
      return longScript(500, 3000);
    case 'notices':
      // A degradation between two exchanges: the list draws a notice among the rows.
      return {
        blocks: [
          exchange({ startAt: 500, ref: 1, source: ['Testing', 'Testing notices.'], translation: 'お知らせのテストです。', origin: 'n1', audioChunks: 1 }),
          { startAt: 3500, steps: [{ at: 0, degraded: { code: 'tts_degraded', message: 'The fake degraded its speech (script).' } }] },
          exchange({ startAt: 4500, ref: 3, source: ['Still here.'], translation: 'まだいます。', origin: 'n2', audioChunks: 1 }),
        ],
      };
    case 'refless-stream':
      return reflessStreamScript();
    case 'framed':
      return framedScript();
    case 'rangeless':
      // Gemini's shape: a turn's audio attributed to its segment, but no range: replay, no karaoke.
      return {
        blocks: [
          exchange({ startAt: 500, ref: 1, source: ['Hello', 'Hello, how are you?'], translation: 'こんにちは、お元気ですか？', origin: 'g1', audioChunks: 3, ranged: false }),
          exchange({ startAt: 5000, ref: 3, source: ['I am fine.'], translation: '元気です。', origin: 'g2', audioChunks: 2, ranged: false }),
        ],
      };
    case 'reconnect':
      // a transport that drops and comes back mid-run: the leg shows reconnecting, then goes on; refs are never reused across a reconnect.
      return {
        blocks: [
          exchange({ startAt: 500, ref: 1, source: ['Hello', 'Hello there.'], translation: 'こんにちは。', origin: 'c1', audioChunks: 2 }),
          { startAt: 3000, steps: [{ at: 0, reconnecting: true }, { at: 1500, reconnected: true }] },
          exchange({ startAt: 5000, ref: 3, source: ['Still here?'], translation: 'まだいますか？', origin: 'c2', audioChunks: 1 }),
        ],
      };
  }
}
