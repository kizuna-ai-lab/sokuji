/**
 * What a client sees of the segmentation stage.
 *
 * Deliberately one method and one flag. Clients never construct a runtime,
 * never import a store, and never learn which model ran: a client that
 * receives null, or a disabled runtime, behaves exactly as it does today.
 */

export type PunctuationModelId = 'fireredpunc' | 'edge-punct-en' | 'sat-3l-sm';

export interface PunctuationResult {
  /** The input's characters with marks inserted. SaT emits no marks, so its
   *  adapter writes one terminal at each predicted boundary. */
  text: string;
  /** Offsets into `text`, just past each sentence end, per the model's own
   *  counting rule (Edge-Punct: its periods; SaT: its boundaries;
   *  FireRedPunc: 。！？ plus a `.` that periodIsNotSentenceEnd rejects). */
  sentenceEnds: number[];
  /** Sentence ends plus commas. */
  breakpoints: number[];
  model: PunctuationModelId;
}

/** Why a chunk was sealed. Shared with `SealedChunk` so an observation and the
 *  chunk that produced it can never drift apart. */
export type SealReason = 'sentences' | 'length' | 'end';

/**
 * One thing the stage did, reported as counts.
 *
 * Never carries text, and never carries anything a transcript could be
 * reconstructed from: `chars` and `terminals` are two integers about a piece of
 * text the observer never sees. That is the whole point — the session-end
 * analytics payload is built from these, and no transcript may reach it.
 *
 * `chars`/`terminals` describe the RAW text, as the ASR produced it, before any
 * mark the stage inserted. Measuring the marked-up text instead would make
 * "how often is punctuation missing" answer itself.
 */
export type SegmentationObservation =
  /** A stream closed one bubble. */
  | { kind: 'seal'; reason: SealReason; lang: string; chars: number; terminals: number }
  /** One server-decided segment went through the fill-in helper. */
  | { kind: 'definite'; lang: string; chars: number; terminals: number }
  /** One `punctuate()` call. Synthesised by the instrumenting wrapper —
   *  `memoizePunctuator` in `app/punctuation.ts` — never emitted from here. */
  | { kind: 'model_call' };

export interface SegmentationRuntime {
  /** False when the user switched the feature off. A disabled runtime never
   *  seals and never downloads. */
  readonly enabled: boolean;
  /**
   * Counters, for the session-end analytics event and the diagnostic log.
   *
   * The second method on an interface whose doc says "deliberately one method
   * and one flag", and the exception proves the rule: a client still never
   * calls it. `SentenceStream` and `punctuateDefinite` do, because they are the
   * only code that knows a seal's reason and sees the raw text before the stage
   * touches it, and because routing it through the runtime is what keeps the
   * leg attribution — which only MainPanel knows — out of every client.
   *
   * Optional: a plain `PunctuationRuntime` collects nothing, and a runtime that
   * omits this is observed by nobody.
   */
  observe?(event: SegmentationObservation): void;
  /**
   * Punctuate one tail. Resolves to null — never rejects — whenever the stage
   * cannot help: model not downloaded, still loading, disabled for the
   * session after repeated failures, timed out, or the device is too small.
   * The caller then behaves as if there were no model at all.
   */
  punctuate(
    lang: string,
    text: string,
    opts?: { signal?: AbortSignal },
  ): Promise<PunctuationResult | null>;
}
