import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { exchange, type FakeScript, type ScriptBlock, type ScriptStep } from './script';

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

/**
 * Palabra's shape (F10): text with stated origins — a translation's text
 * revised after it closed, as Palabra's `partial_` → `validated_` — and one
 * continuous speech stream that names no segment. The stream arrives in
 * real time in 20–200 ms chunks: jittered by at most 20 ms for its first
 * `steadyMs`, then every `hiccupEvery`-th chunk `hiccupMs` late, the chunks
 * behind it arriving with it (G3's measurement, group check A).
 */
export const REFLESS_STREAM = { startAt: 500, ms: 30_000, steadyMs: 15_000, hiccupEvery: 20, hiccupMs: 100 } as const;
const CHUNK_MS = [20, 40, 100, 200, 60, 120] as const;
const STEADY_JITTER_MS = [0, 5, 20, 10, 15, 0] as const;

export function reflessStreamScript(): FakeScript {
  const sources = ['今日は天気がいいですね。', '公園に行きましょう。', 'ついでに買い物もします。'];
  const partials = ['The weather', 'Let us go', 'And do some'];
  const translations = ['The weather is nice today.', 'Let us go to the park.', 'And do some shopping on the way.'];
  const blocks: ScriptBlock[] = [];
  for (let i = 0; i < 6; i++) {
    const k = i % 3;
    const ref = 1 + i * 2;
    const origin = `p${i}`;
    blocks.push({ startAt: REFLESS_STREAM.startAt + i * 5000, steps: [
      { at: 0, open: { ref, side: 'source', origin } },
      { at: 0, text: { ref, text: sources[k].slice(0, 4) } },
      { at: 400, text: { ref, text: sources[k] } },
      { at: 800, close: { ref, origin } },
      { at: 1000, open: { ref: ref + 1, side: 'translation', origin } },
      { at: 1000, text: { ref: ref + 1, text: partials[k] } },
      { at: 1400, close: { ref: ref + 1, origin } },
      // `partial_` → `validated_`: the closed translation's text, revised.
      { at: 2400, text: { ref: ref + 1, text: translations[k] } },
    ] });
  }
  const steps: ScriptStep[] = [];
  let t = 0;
  let arrival = 0;
  let from = 0;
  for (let n = 0; t < REFLESS_STREAM.ms; n++) {
    const ms = CHUNK_MS[n % CHUNK_MS.length];
    const late = t >= REFLESS_STREAM.steadyMs && n % REFLESS_STREAM.hiccupEvery === 0
      ? REFLESS_STREAM.hiccupMs
      : STEADY_JITTER_MS[n % STEADY_JITTER_MS.length];
    arrival = Math.max(arrival, t + late);
    steps.push({ at: arrival, audio: { ms, from } });
    t += ms;
    from += (SAMPLE_RATE * ms) / 1000;
  }
  blocks.push({ startAt: REFLESS_STREAM.startAt, steps });
  return { blocks };
}

/**
 * OpenAI Translate's shape (F10): no stated origin — the projection pairs
 * by the segments' timing — and speech in frames, each with the range of
 * the translation it speaks, arriving as the translation grows.
 */
export function framedScript(): FakeScript {
  const exchanges = [
    { source: ['Good', 'Good morning', 'Good morning, everyone.'], translation: 'おはようございます、皆さん。' },
    { source: ['Let us', 'Let us begin the meeting.'], translation: '会議を始めましょう。' },
    { source: ['First,', 'First, the schedule.'], translation: 'まず、予定です。' },
  ];
  return {
    blocks: exchanges.map((x, i) => {
      const ref = 1 + i * 2;
      const tr = ref + 1;
      const media = i * 6000;
      const sourceTiming = { startMs: media, endMs: media + 1200 };
      const trTiming = { startMs: media + 200, endMs: media + 1300 };
      const steps: ScriptStep[] = [{ at: 0, open: { ref, side: 'source' } }];
      x.source.forEach((text, k) => steps.push({ at: k * 200, text: { ref, text, timing: sourceTiming } }));
      let at = x.source.length * 200;
      steps.push({ at, close: { ref } }, { at, open: { ref: tr, side: 'translation' } });
      for (let end = 2; end < x.translation.length + 2; end += 2) {
        const stop = Math.min(end, x.translation.length);
        steps.push({ at, text: { ref: tr, text: x.translation.slice(0, stop), timing: trTiming } });
        steps.push({ at, audio: { ref: tr, range: [end - 2, stop], ms: 60 } });
        at += 60;
      }
      steps.push({ at, close: { ref: tr } });
      return { startAt: 500 + media, steps };
    }),
  };
}
