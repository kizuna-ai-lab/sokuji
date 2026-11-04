/**
 * The conversation the probe plays into the microphone: two people at one
 * table (face-to-face), A and B, taking turns in their own languages. Some
 * turns start while the translation of the previous one is still playing
 * (talk-over), some after it has ended (clean); which one a turn really was
 * is decided after the run, from the playback. The clips are the repo's
 * recordings with their known texts (cut points and texts as in
 * `scripts/dev/wire-probe/gemini-multi.mts`); every clip is brought to one
 * active level, so the same script is the same samples in every run.
 */
import { activeDbfs, normalizeActive } from './audio';

export interface Clip {
  /** Repo-relative wav. */
  file: string;
  /** The speech within it, ms. */
  from: number;
  to: number;
  lang: string;
  text: string;
}

const ZH = 'scripts/assets/gpt-sovits-voices/classic-zh.wav';
const JA = 'scripts/assets/gpt-sovits-voices/classic-ja.wav';
const EN = 'benchmark/test-speech-silence-speech.wav';
const JA_SET = (name: string) => `scripts/dev/wire-probe/assets/ja/${name}.wav`;

export const CLIPS: Record<string, Clip> = {
  zh: { file: ZH, from: 140, to: 4520, lang: 'zh', text: '欢迎使用实时翻译，希望这个声音能让交流变得轻松自然。' },
  zh1: { file: ZH, from: 140, to: 1380, lang: 'zh', text: '欢迎使用实时翻译，' },
  zh2: { file: ZH, from: 1970, to: 4520, lang: 'zh', text: '希望这个声音能让交流变得轻松自然。' },
  ja: { file: JA, from: 610, to: 5800, lang: 'ja', text: 'リアルタイム翻訳へようこそ。自然な会話をお手伝いします。' },
  ja1: { file: JA, from: 610, to: 2990, lang: 'ja', text: 'リアルタイム翻訳へようこそ。' },
  ja2: { file: JA, from: 3310, to: 5800, lang: 'ja', text: '自然な会話をお手伝いします。' },
  umbrella: { file: JA_SET('umbrella'), from: 50, to: 3470, lang: 'ja', text: '今日は雨が降りそうなので、傘を持っていきます。' },
  door: { file: JA_SET('door'), from: 40, to: 2300, lang: 'ja', text: 'ドアを閉めてください。' },
  meeting: { file: JA_SET('meeting'), from: 20, to: 2950, lang: 'ja', text: '明日の会議は午後三時に始まります。' },
  book: { file: JA_SET('book'), from: 50, to: 2560, lang: 'ja', text: 'この本はとても面白かったです。' },
  dinner: { file: JA_SET('dinner'), from: 40, to: 3090, lang: 'ja', text: '週末に家族と一緒に夕食を食べました。' },
  cafe: { file: JA_SET('cafe'), from: 30, to: 3240, lang: 'ja', text: '駅の近くに新しいカフェができました。' },
  train: { file: JA_SET('train'), from: 30, to: 2600, lang: 'ja', text: '電車が十分遅れています。' },
  wait: { file: JA_SET('wait'), from: 50, to: 1520, lang: 'ja', text: '少々お待ちください。' },
  en: { file: EN, from: 60, to: 3730, lang: 'en', text: 'Ask not what your country can do for you, ask what you can do for your country.' },
  en1: { file: EN, from: 60, to: 1900, lang: 'en', text: 'Ask not what your country can do for you,' },
  en2: { file: EN, from: 2070, to: 3730, lang: 'en', text: 'ask what you can do for your country.' },
};

/** Margins kept around a clip's speech when it is cut (gemini-multi's). */
export const LEAD_MS = 60;
export const TAIL_MS = 100;

export interface Pair {
  /** Person A's language: the app's speaker leg (source). */
  a: string;
  /** Person B's language: the app's participant leg (the speaker leg's target). */
  b: string;
  /** Turns, alternating A and B: the clip, and the silence before its speech since the previous turn's speech ended. */
  turns: ReadonlyArray<readonly [clip: string, gapMs: number]>;
}

/**
 * Short gaps (≤ 1.5 s) start while the previous translation still plays;
 * long ones (≥ 7 s) wait it out. A first, then B; A talks over in the first
 * half and B in the second, so both languages have both kinds.
 */
export const PAIRS: Record<string, Pair> = {
  'zh-ja': {
    a: 'zh',
    b: 'ja',
    turns: [
      ['zh', 1000], ['umbrella', 9000], ['zh1', 1500], ['door', 7000], ['zh2', 1200], ['meeting', 8000],
      ['zh', 1500], ['book', 9000], ['zh1', 7000], ['dinner', 1500], ['zh2', 8000], ['cafe', 1200],
      ['zh', 8000], ['train', 1500], ['zh1', 9000], ['wait', 1000], ['zh2', 7000], ['ja', 1500],
      ['zh', 9000], ['ja1', 1200], ['zh1', 8000], ['ja2', 1500],
    ],
  },
  'zh-en': {
    a: 'zh',
    b: 'en',
    turns: [
      ['zh', 1000], ['en', 9000], ['zh1', 1500], ['en1', 7000], ['zh2', 1200], ['en2', 8000],
      ['zh', 1500], ['en', 9000], ['zh1', 7000], ['en1', 1500], ['zh2', 8000], ['en2', 1200],
      ['zh', 8000], ['en', 1500], ['zh1', 9000], ['en1', 1000], ['zh2', 7000], ['en2', 1500],
      ['zh', 9000], ['en', 1200],
    ],
  },
};

/** A gap at or under this asks for talk-over; the run's playback says whether it was. */
export const TALK_OVER_GAP_MS = 2500;

export interface HumanTurn {
  k: number;
  side: 'A' | 'B';
  lang: string;
  clip: string;
  /** The reference transcript: the clip's known text. */
  text: string;
  /** The speech on the microphone's timeline, ms. */
  fromMs: number;
  toMs: number;
  intent: 'talk-over' | 'clean';
}

export interface BuiltScript {
  pair: string;
  turns: HumanTurn[];
  /** The human voices on the microphone, at `rate`. */
  pcm: Int16Array;
  rate: number;
  durationMs: number;
  /** Each clip's active level before it was brought to the script's. */
  sourceDbfs: Record<string, number>;
}

/**
 * Lays the pair's turns out on the microphone's timeline. `load` reads a
 * clip's whole file at `rate`; `turns` keeps only the first N (a dry run).
 */
export function buildScript(pairName: string, o: { rate: number; voiceDbfs: number; turns?: number; tailMs?: number }, load: (file: string) => Int16Array): BuiltScript {
  const pair = PAIRS[pairName];
  if (!pair) throw new Error(`pair one of: ${Object.keys(PAIRS).join(', ')}`);
  const rate = o.rate;
  const at = (ms: number) => Math.round((ms * rate) / 1000);
  const files = new Map<string, Int16Array>();
  const sourceDbfs: Record<string, number> = {};
  const cut = (id: string): Int16Array => {
    const c = CLIPS[id];
    if (!c) throw new Error(`no clip ${id}`);
    let all = files.get(c.file);
    if (!all) { all = load(c.file); files.set(c.file, all); }
    const pcm = all.subarray(Math.max(0, at(c.from - LEAD_MS)), Math.min(all.length, at(c.to + TAIL_MS)));
    sourceDbfs[id] = Math.round(activeDbfs(pcm, rate) * 10) / 10;
    return normalizeActive(pcm, rate, o.voiceDbfs);
  };
  const list = pair.turns.slice(0, o.turns ?? pair.turns.length);
  const turns: HumanTurn[] = [];
  const parts: Array<{ pcm: Int16Array; at: number }> = [];
  let lastEnd = 0;
  list.forEach(([id, gap], i) => {
    const c = CLIPS[id];
    const pcm = cut(id);
    const fromMs = lastEnd + gap;
    const placeMs = fromMs - LEAD_MS;
    const toMs = fromMs + (c.to - c.from);
    parts.push({ pcm, at: at(placeMs) });
    turns.push({ k: i + 1, side: i % 2 === 0 ? 'A' : 'B', lang: c.lang, clip: id, text: c.text, fromMs, toMs, intent: gap <= TALK_OVER_GAP_MS && i > 0 ? 'talk-over' : 'clean' });
    if (c.lang !== (i % 2 === 0 ? pair.a : pair.b)) throw new Error(`${pairName}: turn ${i + 1} (${id}) is ${c.lang}, not ${i % 2 === 0 ? pair.a : pair.b}`);
    lastEnd = toMs;
  });
  const end = Math.max(...parts.map((p) => p.at + p.pcm.length)) + at(o.tailMs ?? 1000);
  const pcm = new Int16Array(end);
  for (const p of parts) pcm.set(p.pcm, p.at);
  return { pair: pairName, turns, pcm, rate, durationMs: (end * 1000) / rate, sourceDbfs };
}
