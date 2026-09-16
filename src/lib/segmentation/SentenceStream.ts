import {
  sentenceEnds as ruleSentenceEnds,
  breakpoints as ruleBreakpoints,
  skeleton,
  baseLang,
} from './sentenceEnd';
import type { PunctuationResult, SegmentationRuntime } from './SegmentationRuntime';

/**
 * Skeleton characters that must follow a sentence end before it is counted.
 *
 * Every model marks the end of its input as a sentence end — measured on all
 * three — so the last mark in a growing tail is never trustworthy. Precision
 * stopped improving past 8 in the streaming tables at R = 0/4/8/16, at a
 * commit lag of 9-14 characters.
 */
export const RIGHT_CONTEXT_CHARS = 8;

/**
 * The most characters handed to a model in one call.
 *
 * SaT degrades past 510 subwords (511 -> 984 ms, 1,020 -> 4.5 s), FireRedPunc
 * caps at 512 tokens and Edge-Punct at 200 pieces per row. 300 characters is
 * comfortably inside all three.
 */
export const MAX_MODEL_CHARS = 300;

/** Average sentence length per language, from the corpus: ja 19, zh 22, ko 16,
 *  en 40, fr/de/es/pt/ru 36-38. Rounded into two buckets. */
const CJK_CHARS_PER_SENTENCE = 20;
const DEFAULT_CHARS_PER_SENTENCE = 50;
const CJK_LANGS = new Set(['zh', 'yue', 'ja', 'ko']);

/** Languages that get the length fallback. Japanese is deliberately absent:
 *  the fallback exists because FireRedPunc under-emits sentence ends, and
 *  Japanese does not route to FireRedPunc. */
const LENGTH_FALLBACK_LANGS = new Set(['zh', 'yue']);

/** FireRedPunc emits only 62% of the reference sentence ends, so N detected
 *  sentences are roughly 1.6 x N real ones; 33 characters per sentence is that
 *  ratio applied to the 22-character Chinese average, rounded to a ten. */
const FALLBACK_CHARS_PER_SENTENCE = 33;

/** The tail is long enough to hold `n` sentences of this language. */
export function gateChars(lang: string, n: number): number {
  const per = CJK_LANGS.has(baseLang(lang)) ? CJK_CHARS_PER_SENTENCE : DEFAULT_CHARS_PER_SENTENCE;
  return n * per;
}

/** The Chinese length fallback threshold for `n` sentences. */
export function zhFallbackChars(n: number): number {
  return Math.round((n * FALLBACK_CHARS_PER_SENTENCE) / 10) * 10;
}

export interface SealedChunk {
  text: string;
  reason: 'sentences' | 'length' | 'end';
}

export interface SentenceStreamOptions {
  lang: string;
  /** null or disabled means no sealing at all — today's behaviour. */
  runtime: SegmentationRuntime | null;
  /** How many sentences fill a bubble. Read once, here, so changing the
   *  setting applies to the next stream and never cuts an open bubble. */
  sentencesPerChunk: number;
  /** Text up to the seal, carrying whatever punctuation was inserted. */
  onSeal(chunk: SealedChunk): void;
  /** The unsealed tail, raw. Never carries provisional marks: they would
   *  flicker as the ASR rewrites. */
  onPending(text: string): void;
}

export class SentenceStream {
  private readonly opts: SentenceStreamOptions;
  private lang: string;
  private readonly n: number;
  /** The unsealed tail exactly as the client last gave it. */
  private pending = '';
  private inFlight = false;
  /** The newest tail seen while a call was in flight; latest wins. */
  private queued: string | null = null;
  private disposed = false;
  /** Skeleton of the text last handed to the model, so a stale answer is
   *  recognised even after the ASR rewrote the tail. */
  private inFlightSkeleton = '';

  constructor(opts: SentenceStreamOptions) {
    this.opts = opts;
    this.lang = opts.lang;
    this.n = Math.min(5, Math.max(1, Math.round(opts.sentencesPerChunk)));
  }

  setLanguage(lang: string): void {
    this.lang = lang;
  }

  update(fullText: string): void {
    if (this.disposed) return;
    this.pending = fullText;
    this.opts.onPending(fullText);
    this.evaluate();
  }

  end(): void {
    if (this.disposed) return;
    const tail = this.pending;
    this.pending = '';
    this.queued = null;
    // active(), not just disposed: update() records the pending text before
    // it checks whether the stage is on, so a null or disabled runtime would
    // otherwise still emit a final chunk — and "no runtime" must mean no
    // sealing at all, including this one.
    if (this.active() && tail.length > 0) this.opts.onSeal({ text: tail, reason: 'end' });
  }

  dispose(): void {
    this.disposed = true;
    this.pending = '';
    this.queued = null;
  }

  /** The latest counted sentence end in the current tail, or -1. Side-effect
   *  free: a later slice uses it to land a hard span cap on a real boundary
   *  instead of mid-word. */
  confirmedBoundary(): number {
    const tail = this.pending;
    if (tail.length === 0) return -1;
    const counted = ruleSentenceEnds(tail).filter((e) => this.hasRightContext(tail, e));
    return counted.length > 0 ? counted[counted.length - 1] : -1;
  }

  // ----- internals -----

  private active(): boolean {
    return !this.disposed && !!this.opts.runtime && this.opts.runtime.enabled;
  }

  private evaluate(): void {
    if (!this.active()) return;
    const tail = this.pending;
    if (tail.length === 0) return;

    // Existing punctuation is authoritative: count it and never call a model.
    const ends = ruleSentenceEnds(tail);
    if (ends.length > 0) {
      this.sealFromRule(tail, ends);
      return;
    }

    if (tail.length >= gateChars(this.lang, this.n)) this.callModel(tail);
    // No length fallback here. The spec conditions it on "fewer than N
    // sentence ends", which is a fact only the model's answer establishes, so
    // it belongs on the paths that know that answer: applyResult when a
    // result arrives, and onResult when one never usefully does. Firing it
    // here as well would seal at a comma in the same tick the model was
    // asked, guaranteeing its answer is discarded as stale.
  }

  /** Count the marks already in the tail and seal if there are enough. */
  private sealFromRule(tail: string, ends: number[]): void {
    const counted = ends.filter((e) => this.hasRightContext(tail, e));
    if (counted.length >= this.n) {
      this.seal(tail.slice(0, counted[this.n - 1]), tail.slice(counted[this.n - 1]), 'sentences');
      return;
    }
    this.tryLengthFallback(tail, counted.length);
  }

  private hasRightContext(text: string, offset: number): boolean {
    return skeleton(text.slice(offset)).length >= RIGHT_CONTEXT_CHARS;
  }

  /** zh and yue only: a very long tail with too few sentence ends seals at the
   *  latest confirmed comma rather than growing without bound. */
  private tryLengthFallback(tail: string, countedEnds: number): void {
    if (!LENGTH_FALLBACK_LANGS.has(baseLang(this.lang))) return;
    if (countedEnds >= this.n) return;
    if (tail.length < zhFallbackChars(this.n)) return;
    const marks = ruleBreakpoints(tail).filter((b) => this.hasRightContext(tail, b));
    if (marks.length === 0) return;
    const at = marks[marks.length - 1];
    this.seal(tail.slice(0, at), tail.slice(at), 'length');
  }

  private callModel(tail: string): void {
    if (this.inFlight) {
      this.queued = tail;
      return;
    }
    const window = tail.length > MAX_MODEL_CHARS ? tail.slice(tail.length - MAX_MODEL_CHARS) : tail;
    // Only the window is sent, but the prefix it drops is kept so the seal can
    // be expressed against the whole tail.
    const dropped = tail.length - window.length;
    this.inFlight = true;
    this.inFlightSkeleton = skeleton(window);
    const runtime = this.opts.runtime!;
    runtime
      .punctuate(this.lang, window)
      .then((result) => this.onResult(window, dropped, result))
      .catch(() => this.onResult(window, dropped, null));
  }

  private onResult(input: string, dropped: number, result: PunctuationResult | null): void {
    this.inFlight = false;
    const next = this.queued;
    this.queued = null;

    const applied = !this.disposed && result
      ? this.applyResult(input, dropped, result)
      : false;
    // The model declined, or its answer was stale or failed the skeleton
    // invariant. The tail is still unpunctuated and still growing, so the
    // length backstop is the only thing left that can seal it.
    if (!applied && !this.disposed) this.tryLengthFallback(this.pending, 0);

    if (next !== null && this.active() && this.pending.length > 0) this.evaluate();
  }

  /** True when this answer was usable and the counting decision was made from
   *  it — false when it was stale or malformed, so the caller knows the tail
   *  still has nobody deciding for it. */
  private applyResult(input: string, dropped: number, result: PunctuationResult): boolean {
    // A stale answer: the tail no longer starts with what was sent.
    const tail = this.pending;
    const sentSkeleton = this.inFlightSkeleton;
    const tailSkeleton = skeleton(tail.slice(dropped));
    if (!tailSkeleton.startsWith(sentSkeleton)) return false;

    // The output invariant. Every model rewrites spacing and two of them
    // recase, so only letters and digits, lower-cased, may be compared.
    if (skeleton(result.text) !== skeleton(input)) return false;

    const counted = result.sentenceEnds.filter((e) => this.hasRightContext(result.text, e));
    if (counted.length >= this.n) {
      const cut = counted[this.n - 1];
      const sealedText = result.text.slice(0, cut);
      const rawCut = this.rawOffsetFor(input, skeleton(sealedText).length);
      this.seal(tail.slice(0, dropped) + sealedText, tail.slice(dropped + rawCut), 'sentences');
      return true;
    }
    this.tryLengthFallback(tail, counted.length);
    return true;
  }

  /**
   * The offset in `raw` whose prefix holds `skeletonLength` skeleton
   * characters. This is how a cut chosen in the model's output — which has
   * different spacing and possibly different case — is mapped back onto the
   * characters the ASR actually produced.
   */
  private rawOffsetFor(raw: string, skeletonLength: number): number {
    if (skeletonLength === 0) return 0;
    let seen = 0;
    for (let i = 0; i < raw.length; i++) {
      if (/[\p{L}\p{N}]/u.test(raw[i])) {
        seen++;
        if (seen === skeletonLength) return i + 1;
      }
    }
    return raw.length;
  }

  private seal(sealed: string, remainder: string, reason: SealedChunk['reason']): void {
    if (this.disposed || sealed.length === 0) return;
    this.pending = remainder;
    this.opts.onSeal({ text: sealed, reason });
    this.opts.onPending(remainder);
  }
}
