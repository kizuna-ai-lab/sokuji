/**
 * Ranges filled in once a segment's speech has ended (spec: "A range known
 * only later is filled in"): the span divided among the speech entries by
 * their sample counts. Written for Soniox's TTS segments (Stage 2 Soniox,
 * choice 4) and lifted here at its second user, Palabra's sentences
 * (Stage 2 Palabra, ruling 6; choice 2): a provider never imports another
 * provider's folder. Pure.
 *
 * Before the fill-in, a provisional range per chunk (karaoke provisional
 * ranges design, 2026-10-25): the phrase's text reached in proportion to the
 * samples heard so far against its estimated length, from a speech rate this
 * session's fill-ins measured. The fill-in then replaces it.
 */
import { countSkeleton } from '../segmentation/sealCursor';
import { SAMPLE_RATE, type TextRange } from './adapter';

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/**
 * A segment's span divided among its chunks in proportion to their sample
 * counts (every count positive), so consecutive ranges tile the span; the
 * last ends at the span's end. A boundary inside a surrogate pair moves
 * past it (Stage 2 Soniox, choice 4). `text` is the ref's text the span indexes.
 */
export function tileSpan(span: TextRange, samples: readonly number[], text: string): TextRange[] {
  const [a, b] = span;
  const total = samples.reduce((sum, n) => sum + n, 0);
  const out: TextRange[] = [];
  let start = a;
  let cum = 0;
  samples.forEach((n, k) => {
    cum += n;
    let end = k === samples.length - 1 ? b : Math.max(start, a + Math.round(((b - a) * cum) / total));
    if (end > start && end < b && isHigh(text.charCodeAt(end - 1)) && isLow(text.charCodeAt(end))) end += 1;
    out.push([start, end]);
    start = end;
  });
  return out;
}

/** How many letters' worth the prior counts for once a session has measured its own rate. */
export const PRIOR_WEIGHT = 10;

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;
const HANGUL = /\p{Script=Hangul}/u;
const countOf = (phrase: string, re: RegExp) => [...phrase].filter((c) => re.test(c)).length;

/**
 * Seconds per letter, digit or CJK character before a session has measured
 * its own, by the phrase's script: Soniox's default voice measured 0.065–0.091
 * in English, 0.14–0.18 in Japanese, 0.21–0.31 in Chinese; Hangul is a guess.
 */
export function priorSeconds(phrase: string): number {
  if (KANA.test(phrase)) return 0.16;
  const letters = countSkeleton(phrase);
  const han = countOf(phrase, HAN);
  if (han > 0 && 2 * han >= letters) return 0.25;
  const hangul = countOf(phrase, HANGUL);
  if (hangul > 0 && 2 * hangul >= letters) return 0.17;
  return 0.075;
}

/** One spoken leg's speech rate, learned from its fill-ins, and where a phrase's chunks reach by it. */
export class SpeechPace {
  private samples = 0;
  private letters = 0;

  constructor(private readonly speed = 1) {}

  /** Samples per letter the phrase is expected to take: the prior, blended with what fill-ins measured. */
  rate(phrase: string): number {
    const prior = (priorSeconds(phrase) * SAMPLE_RATE) / this.speed;
    return this.letters > 0 ? (this.samples + prior * PRIOR_WEIGHT) / (this.letters + PRIOR_WEIGHT) : prior;
  }

  /** A fill-in: the text its span spoke and the samples of its chunks. */
  learn(phrase: string, samples: number): void {
    const letters = countSkeleton(phrase);
    if (letters === 0 || samples <= 0) return;
    this.samples += samples;
    this.letters += letters;
  }

  /**
   * The provisional end in `phrase` once `cum` of its samples are heard,
   * never before `from`; null when the phrase has no letters to place.
   * `from` must not exceed `phrase.length`: a caller whose text can shrink
   * restates what it reached first (Qwen's and Palabra's `restate`).
   */
  reach(phrase: string, cum: number, from: number): number | null {
    const letters = countSkeleton(phrase);
    if (letters === 0) return null;
    let end = Math.min(phrase.length, Math.max(from, Math.round((phrase.length * cum) / (letters * this.rate(phrase)))));
    if (end > from && end < phrase.length && isHigh(phrase.charCodeAt(end - 1)) && isLow(phrase.charCodeAt(end))) end += 1;
    return end;
  }
}
