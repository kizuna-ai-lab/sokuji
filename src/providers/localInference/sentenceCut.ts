import type { Clock } from '../../lib/contract/clock';
import type { Punctuator } from '../../lib/contract/adapter';
import { countSkeleton, offsetAfterSkeleton } from '../../lib/segmentation/sealCursor';
import type { PunctuationModelId, SegmentationRuntime } from '../../lib/segmentation/SegmentationRuntime';
import { baseLang, breakpoints, sentenceEnds } from '../../lib/segmentation/sentenceEnd';
import { SentenceStream, type SealedChunk } from '../../lib/segmentation/SentenceStream';

/**
 * LocalInference's stream shape (plan 1e-2b): a translation job every N
 * sentences inside an utterance, ported from `LocalInferenceClient`
 * (~155-216, 725-821, 886-981) without its bubbles. `SentenceStream` does
 * the sealing; this keeps the cursor that turns an ASR's cumulative
 * hypotheses into the "text since the last seal" it expects, and the guard
 * against engines whose later text is not a growth of what was sealed.
 */

/** A stalled punctuator must not stall sealing: today's runtime gives up after 3 s (`INFERENCE_TIMEOUT_MS`). */
export const PUNCTUATION_BUDGET_MS = 3000;

/** Which model today's runtime would run (`modelForLanguage`); `SentenceStream` never reads it — the type asks for one. */
function modelFor(lang: string): PunctuationModelId {
  const base = baseLang(lang);
  if (base === 'zh' || base === 'yue' || base === 'cantonese') return 'fireredpunc';
  return base === 'en' ? 'edge-punct-en' : 'sat-3l-sm';
}

/**
 * `SentenceStream`'s runtime over the runner's `Punctuator`. The answer is
 * text; the stream needs its sentence ends, rebuilt here with the shared
 * rule. FireRedPunc and Edge-Punct count by that rule themselves; SaT can
 * lose an end the rule rejects (a period before a lowercase word in a text
 * that shows casing), so that chunk seals later or by length — accepted
 * (plan 1e-2b ruling 7). Each call is raced against the budget.
 */
export function runtimeOver(punctuate: Punctuator, clock: Clock): SegmentationRuntime {
  return {
    enabled: true,
    punctuate: (lang, text) => new Promise((resolve) => {
      let settled = false;
      const finish = (out: string | null) => {
        if (settled) return;
        settled = true;
        cancel();
        resolve(out === null ? null : { text: out, sentenceEnds: sentenceEnds(out), breakpoints: breakpoints(out), model: modelFor(lang) });
      };
      const cancel = clock.setTimeout(() => finish(null), PUNCTUATION_BUDGET_MS);
      punctuate(lang, text).then(finish, () => finish(null));
    }),
  };
}

export interface SentenceCutOptions {
  /** The utterance's language (the leg's source). */
  lang: string;
  /** 1–5: how many sentences one job holds. */
  sentences: number;
  runtime: SegmentationRuntime;
  /** The unsealed tail of the utterance in progress, raw, whenever it changes. */
  onPending(tail: string): void;
  /** A sealed chunk: its text (a punctuation model's marks included) and why. */
  onSeal(chunk: SealedChunk): void;
}

export class SentenceCut {
  private stream: SentenceStream | null = null;
  /** Letters and digits of the utterance's raw text already inside seals (`sealCursor.ts`): the unit both a partial and its final agree on. */
  private sealed = 0;
  /** `sealed` when `lastPassed` was handed to the stream. */
  private sealedBase = 0;
  /** The exact text last handed to `update()`; whatever `onPending` reports is a suffix of it. */
  private lastPassed = '';
  /** The previous partial, unsliced: tells a truncated re-decode from new text. */
  private lastRaw = '';

  constructor(private readonly opts: SentenceCutOptions) {}

  /** A cumulative partial of the utterance in progress. */
  partial(raw: string): void {
    const previousRaw = this.lastRaw;
    this.lastRaw = raw;
    const stream = this.ensureStream();
    if (this.coversNothingNew(raw)) {
      // Retracted to what is sealed already: leave everything as it is — the next partial heals it.
      if (isTruncationOf(raw, previousRaw)) return;
      // The engine changed its mind entirely: start the cursor over.
      this.sealed = 0;
    }
    this.feed(stream, raw);
  }

  /**
   * The utterance's final: seals what is left, and the utterance is done.
   * False when the final is a truncated re-decode of text already sealed —
   * nothing more is sealed, and the caller closes what it shows without a job.
   */
  final(text: string): boolean {
    const previousRaw = this.lastRaw;
    const stream = this.ensureStream();
    let sealsTail = true;
    if (this.coversNothingNew(text)) {
      if (isTruncationOf(text, previousRaw)) sealsTail = false;
      else this.sealed = 0;
    }
    if (sealsTail) {
      this.feed(stream, text);
      stream.end();
    }
    this.reset();
    return sealsTail;
  }

  /** Drops the utterance in progress: its stream (a late model answer seals nothing) and the cursor. */
  reset(): void {
    this.stream?.dispose();
    this.stream = null;
    this.sealed = 0;
    this.lastRaw = '';
  }

  /** Everything this text holds is sealed already: slicing it would hand the stream an empty string. */
  private coversNothingNew(text: string): boolean {
    return text.length > 0 && offsetAfterSkeleton(text, this.sealed) >= text.length;
  }

  private ensureStream(): SentenceStream {
    if (this.stream) return this.stream;
    this.sealed = 0;
    this.stream = new SentenceStream({
      lang: this.opts.lang,
      runtime: this.opts.runtime,
      sentencesPerChunk: this.opts.sentences,
      onSeal: (chunk) => this.opts.onSeal(chunk),
      onPending: (tail) => {
        // Advanced by what the stream consumed, not by the sealed text: a
        // model seal carries inserted marks the raw text never had.
        this.sealed = this.sealedBase + countSkeleton(this.lastPassed) - countSkeleton(tail);
        this.opts.onPending(tail);
      },
    });
    return this.stream;
  }

  private feed(stream: SentenceStream, text: string): void {
    const relative = text.slice(offsetAfterSkeleton(text, this.sealed));
    this.sealedBase = this.sealed;
    this.lastPassed = relative;
    stream.update(relative);
  }
}

/**
 * A re-decode that retracted to text already sealed: its trimmed text is a
 * prefix of the previous partial's (trimmed: some engines' partials carry a
 * leading space their final does not). A re-decode that only recases or
 * re-punctuates reads as new text and re-seals; comparing skeletons would
 * catch it — not built (plan 1e-2b ruling 8).
 */
function isTruncationOf(text: string, previousRaw: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && previousRaw.trim().startsWith(trimmed);
}
