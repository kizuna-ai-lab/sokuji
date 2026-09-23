import { longScript } from './generate';
import { exchange, type FakeScript } from './script';

export type FakeScriptName = 'exchange' | 'cjk' | 'rewrite' | 'long';

/** In the order the fake's settings list them. */
export const FAKE_SCRIPT_NAMES: readonly FakeScriptName[] = ['exchange', 'cjk', 'rewrite', 'long'];

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
  }
}
