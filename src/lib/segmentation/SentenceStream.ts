import {
  sentenceEnds as ruleSentenceEnds,
  breakpoints as ruleBreakpoints,
  skeleton,
  baseLang,
} from './sentenceEnd';
import type { PunctuationResult, SealReason, SegmentationRuntime } from './SegmentationRuntime';

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

/** Languages whose fallback threshold is FireRedPunc-shaped. Everything else
 *  falls back at `LENGTH_FALLBACK_GATES` times its own gate: the fallback is
 *  no longer Chinese-only, because the clients' time caps no longer cut a
 *  bubble the stage was about to seal, so the stage itself has to be what
 *  bounds one. */
const LENGTH_FALLBACK_LANGS = new Set(['zh', 'yue']);

/** How many N-sentence gates a tail may reach before it seals at whatever
 *  confirmed mark it has. Two, so a bubble can hold at most about twice the
 *  text N asks for — measured sentence lengths put N = 3 at roughly 15 s of
 *  speech in every language in the corpus, so this is around half a minute at
 *  the outside, and only when nothing else sealed first. */
const LENGTH_FALLBACK_GATES = 2;

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
  reason: SealReason;
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
  /**
   * `runtime.enabled` as it was when this stream was built, not as it is now.
   *
   * The runtime's answer can change under an open stream: the three
   * punctuation models download as one pack, and `enabled` turns true the
   * moment that finishes. Reading it live would let a stream go from inert to
   * sealing — or, if the files were removed, from sealing to inert, which
   * loses the tail outright: `end()` would decline to seal, the client has
   * already routed that text here instead of to a bubble, and the next
   * utterance overwrites the stranded one. One answer per stream matches the
   * clients, which read the same flag once per session.
   *
   * A runtime that becomes unusable mid-stream is still handled, one layer
   * down: `punctuate()` returns null and the stream seals on the punctuation
   * that is already there, exactly as it does while a model is loading.
   */
  private readonly runtimeEnabled: boolean;

  constructor(opts: SentenceStreamOptions) {
    this.opts = opts;
    this.lang = opts.lang;
    this.n = Math.min(5, Math.max(1, Math.round(opts.sentencesPerChunk)));
    this.runtimeEnabled = opts.runtime?.enabled === true;
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
    if (this.active() && tail.length > 0) {
      this.observe(tail, 'end');
      this.opts.onSeal({ text: tail, reason: 'end' });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.pending = '';
    this.queued = null;
  }

  /** The latest counted sentence end in the current tail, or -1. Side-effect
   *  free: a hard span cap uses it to land on a real boundary instead of
   *  mid-word. */
  confirmedBoundary(): number {
    const tail = this.pending;
    if (tail.length === 0) return -1;
    const counted = ruleSentenceEnds(tail).filter((e) => this.hasRightContext(tail, e));
    return counted.length > 0 ? counted[counted.length - 1] : -1;
  }

  /**
   * The latest counted sentence end OR clause mark in the current tail, or -1.
   *
   * The second choice for a cap that has to cut somewhere. A comma is a worse
   * place to end a bubble than a full stop, and a far better one than the
   * arbitrary character the cap would otherwise land on — which matters most
   * in Chinese, where FireRedPunc emits 62% of the reference's sentence ends
   * and commas are often the only marks in the tail at all. Side-effect free.
   */
  confirmedBreakpoint(): number {
    const tail = this.pending;
    if (tail.length === 0) return -1;
    const counted = ruleBreakpoints(tail).filter((b) => this.hasRightContext(tail, b));
    return counted.length > 0 ? counted[counted.length - 1] : -1;
  }

  // ----- internals -----

  private active(): boolean {
    return !this.disposed && this.runtimeEnabled;
  }

  private evaluate(): void {
    // A single update() can carry enough already-punctuated text for more
    // than one N-sentence chunk in one shot — most commonly the final from an
    // offline ASR worker (whisper, qwen3-asr, granite, sherpa offline), which
    // delivers one whole punctuated transcript via update() + end() rather
    // than growing it delta by delta. Looping here seals every full group
    // immediately instead of only the first, leaving the rest to be flushed
    // by end() as a single oversized chunk no update() ever re-evaluates.
    for (;;) {
      if (!this.active()) return;
      const tail = this.pending;
      if (tail.length === 0) return;

      // Existing punctuation is authoritative: count it and never call a model.
      const ends = ruleSentenceEnds(tail);
      if (ends.length > 0) {
        if (this.sealFromRule(tail, ends)) continue; // remainder may hold N more
        return;
      }

      if (tail.length >= gateChars(this.lang, this.n)) this.callModel(tail);
      // No length fallback here. The spec conditions it on "fewer than N
      // sentence ends", which is a fact only the model's answer establishes, so
      // it belongs on the paths that know that answer: applyResult when a
      // result arrives, and onResult when one never usefully does. Firing it
      // here as well would seal at a comma in the same tick the model was
      // asked, guaranteeing its answer is discarded as stale.
      return;
    }
  }

  /** Count the marks already in the tail and seal if there are enough.
   *  Returns whether it sealed, so evaluate() knows the remainder may still
   *  hold another full group worth re-checking in the same tick. */
  private sealFromRule(tail: string, ends: number[]): boolean {
    const counted = ends.filter((e) => this.hasRightContext(tail, e));
    if (counted.length >= this.n) {
      this.seal(tail.slice(0, counted[this.n - 1]), tail.slice(counted[this.n - 1]), 'sentences');
      return true;
    }
    this.tryLengthFallback(tail, counted.length);
    return false;
  }

  private hasRightContext(text: string, offset: number): boolean {
    return skeleton(text.slice(offset)).length >= RIGHT_CONTEXT_CHARS;
  }

  /**
   * Where a length fallback cuts: the last sentence end it can confirm, and
   * only failing that the last comma.
   *
   * One or two sentences is a better bubble than one and a half. The fallback
   * fires precisely when N sentences did not arrive in time, so the text it is
   * asked to cut usually holds some — and cutting at the last comma, as this
   * did until now, would step past a perfectly good boundary to land on a
   * worse one. A comma is still the answer when the text holds no sentence end
   * at all, which in Chinese is the common case: FireRedPunc emits 62% of the
   * reference's ends.
   */
  private fallbackCut(text: string, ends: number[], breaks: number[]): number {
    const confirmed = (offsets: number[]) => offsets.filter((o) => this.hasRightContext(text, o));
    const sentences = confirmed(ends);
    if (sentences.length > 0) return sentences[sentences.length - 1];
    const marks = confirmed(breaks);
    return marks.length > 0 ? marks[marks.length - 1] : -1;
  }

  /**
   * A very long tail with too few sentence ends seals at the latest confirmed
   * comma rather than growing without bound.
   *
   * zh and yue keep their own threshold (`zhFallbackChars`, derived from
   * FireRedPunc emitting 62% of the reference's sentence ends); every other
   * language falls back at twice its gate. Both exist for the same reason and
   * it is now load-bearing for all of them: with the stage active the clients
   * no longer cut a bubble on a timer, so this is what bounds one when the
   * marks never add up to N.
   *
   * `marked` is the model's answer, passed on the model path. Its commas are
   * what the search runs on there, and searching the raw tail instead would
   * never find anything — the reason that path ran at all is that the ASR
   * emitted no marks, so the only commas in existence are the ones the model
   * just inserted. That was the shipped behaviour until a live Chinese session
   * sealed nothing at all: `PunctuationResult.breakpoints` ("sentence ends
   * plus commas") was produced by all three adapters and read by nobody, and
   * absorbing FireRedPunc's under-emission of sentence ends — 62% of the
   * reference, the whole reason this fallback exists — was therefore
   * unreachable on the only input it was written for.
   *
   * The cut is expressed against the raw tail either way, through the same
   * skeleton mapping the sentences path uses, so the cursor advances by
   * characters consumed and never by the longer sealed text.
   */
  private tryLengthFallback(
    tail: string,
    countedEnds: number,
    marked?: { result: PunctuationResult; input: string; dropped: number },
  ): void {
    if (countedEnds >= this.n) return;
    const threshold = LENGTH_FALLBACK_LANGS.has(baseLang(this.lang))
      ? zhFallbackChars(this.n)
      : LENGTH_FALLBACK_GATES * gateChars(this.lang, this.n);
    if (tail.length < threshold) return;

    if (!marked) {
      const at = this.fallbackCut(tail, ruleSentenceEnds(tail), ruleBreakpoints(tail));
      if (at < 0) return;
      this.seal(tail.slice(0, at), tail.slice(at), 'length');
      return;
    }

    const { result, input, dropped } = marked;
    const at = this.fallbackCut(result.text, result.sentenceEnds, result.breakpoints);
    if (at < 0) return;
    const sealedText = result.text.slice(0, at);
    const rawCut = this.rawOffsetFor(input, skeleton(sealedText).length);
    this.seal(tail.slice(0, dropped) + sealedText, tail.slice(dropped + rawCut), 'length');
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
    this.tryLengthFallback(tail, counted.length, { result, input, dropped });
    return true;
  }

  /**
   * The offset in `raw` whose prefix holds `skeletonLength` skeleton
   * characters. This is how a cut chosen in the model's output — which has
   * different spacing and possibly different case — is mapped back onto the
   * characters the ASR actually produced.
   *
   * `skeletonLength` is `skeleton(...).length`: a count of UTF-16 units in the
   * *output* skeleton string, where a matched astral character contributes 2
   * (its own UTF-16 length), not 1. The scan below must accumulate `seen` the
   * same way — by each matched code point's `.length` — to stay aligned with
   * it. The previous implementation indexed `raw[i]` and tested one UTF-16
   * unit at a time: a lone surrogate half is `\p{Cs}` (surrogate), not
   * `\p{L}`, so it never matched at all. That undercounts every astral
   * character (FireRedPunc itself treats U+20000-U+2CEAF as ordinary Chinese
   * text) by its full contribution, drifting the cut for everything after it
   * and, once the scan runs out of narrow characters to find, dropping the
   * entire remainder by falling through to `raw.length`.
   */
  private rawOffsetFor(raw: string, skeletonLength: number): number {
    if (skeletonLength === 0) return 0;
    let seen = 0;
    let offset = 0;
    for (const ch of raw) {
      if (/[\p{L}\p{N}]/u.test(ch)) {
        seen += ch.length;
        if (seen >= skeletonLength) return offset + ch.length;
      }
      offset += ch.length;
    }
    return raw.length;
  }

  private seal(sealed: string, remainder: string, reason: SealReason): void {
    if (this.disposed || sealed.length === 0) return;
    // The raw characters this seal consumed, taken BEFORE the pending tail is
    // replaced. `sealed` is not the same thing on the model path: there it
    // carries the marks the model inserted, and measuring those would make the
    // stage's own punctuation look like the ASR's.
    this.observe(this.pending.slice(0, this.pending.length - remainder.length), reason);
    this.pending = remainder;
    this.opts.onSeal({ text: sealed, reason });
    this.opts.onPending(remainder);
  }

  /** Counts only, and only when the runtime collects them. `raw` never leaves
   *  this method: what crosses is two integers about it.
   *
   *  Behind a barrier because the observer is MainPanel's tally, not part of
   *  the seal: an exception out of it would unwind through `seal()` into
   *  whichever client's delta handler is on the stack and lose that item — a
   *  chunk of the user's conversation, for a counter nobody renders. */
  private observe(raw: string, reason: SealReason): void {
    try {
      this.opts.runtime?.observe?.({
        kind: 'seal',
        reason,
        lang: this.lang,
        chars: raw.length,
        terminals: ruleSentenceEnds(raw).length,
      });
    } catch {
      // Counting is best-effort; sealing is not.
    }
  }
}
