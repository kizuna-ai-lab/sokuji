import { exchange, type FakeScript } from './script';

/** `count` exchanges, one every `everyMs`, alternating three short texts. */
export function longScript(count: number, everyMs = 1500): FakeScript {
  const sources = ['今日は天気がいいですね。', '公園に行きましょう。', 'ついでに買い物もします。'];
  const translations = ['The weather is nice today.', 'Let us go to the park.', 'And do some shopping on the way.'];
  const blocks = [];
  for (let i = 0; i < count; i++) {
    const k = i % 3;
    blocks.push(exchange({ startAt: i * everyMs, ref: 1 + i * 2, source: [sources[k].slice(0, 4), sources[k]], translation: translations[k], origin: `u${i}`, audioChunks: 1 }));
  }
  return { blocks };
}
