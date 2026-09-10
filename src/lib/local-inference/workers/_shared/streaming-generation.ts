/**
 * Lifecycle helpers for continuous streaming ASR workers (Voxtral Realtime).
 *
 * Both pieces exist because the worker's generate loop outlives a single VAD
 * utterance: audio keeps arriving while the model is still catching up, and the
 * model holds tokens it has not emitted yet. Keeping that state here (instead of
 * in worker-module globals) makes the end-of-utterance handoff testable.
 */

/**
 * Silence, in tokens, appended at an utterance end so the model decodes its tail.
 *
 * Voxtral Realtime runs NUM_DELAY_TOKENS (6) behind the audio it has been fed,
 * so 6 + 1 is what it takes to flush the words it is still holding. The
 * processor's own `num_right_pad_tokens` is 17 — the extra 10 are
 * OFFLINE_STREAMING_BUFFER_TOKENS, slack for decoding a whole clip at once.
 * Streaming does not need them, and every padded token is real decode work at
 * the end of every utterance.
 */
export const TAIL_PAD_TOKENS = 7;

/** Keep individual audio-encoder calls small even when a backlog accumulated. */
export const MAX_AUDIO_TOKENS_PER_ENCODER_CALL = 32;

/** Samples of silence to append at an utterance end. */
export function tailPadSamples(rawAudioLengthPerTok: number): number {
  return TAIL_PAD_TOKENS * rawAudioLengthPerTok;
}

/**
 * Extend a required encoder chunk by whole audio-token steps, up to a hard cap.
 *
 * The streaming worker used to extend a chunk to all currently buffered audio.
 * A lifecycle delay could therefore turn one ORT call into a minutes-long input.
 */
export function boundedBatchEndSample(
  endNeeded: number,
  availableSamples: number,
  samplesPerTok: number,
  maxTokens = MAX_AUDIO_TOKENS_PER_ENCODER_CALL,
): number {
  if (!Number.isFinite(samplesPerTok) || samplesPerTok <= 0) return endNeeded;
  const extraAvailable = Math.max(0, Math.floor((availableSamples - endNeeded) / samplesPerTok));
  const extraAllowed = Math.max(0, Math.floor(maxTokens) - 1);
  return endNeeded + Math.min(extraAvailable, extraAllowed) * samplesPerTok;
}

export type QueuedUtteranceState = 'open' | 'finish' | 'stop';

/** Endpoint state for an utterance staged while the preceding run drains. */
export class QueuedUtterance {
  private queue: QueuedUtteranceState[] = [];

  get pending(): boolean {
    return this.queue.length > 0;
  }

  start(): void {
    this.queue.push('open');
  }

  finish(): boolean {
    return this.setLatestOpenEndpoint('finish');
  }

  stop(): boolean {
    return this.setLatestOpenEndpoint('stop');
  }

  take(): QueuedUtteranceState | null {
    return this.queue.shift() ?? null;
  }

  clear(): void {
    this.queue = [];
  }

  private setLatestOpenEndpoint(endpoint: Exclude<QueuedUtteranceState, 'open'>): boolean {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i] === 'open') {
        this.queue[i] = endpoint;
        return true;
      }
    }
    return false;
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  const merged = new Float32Array(a.length + b.length);
  merged.set(a);
  merged.set(b, a.length);
  return merged;
}

/**
 * Audio buffer for one generate run, plus the handoff to the next one.
 *
 * A run ends in one of two ways:
 *   - `requestFinish(pad)` — graceful. Streaming models decode behind the audio
 *     they were fed, so the tail of an utterance only comes out if silence is
 *     appended after it. The run keeps consuming until that padding is drained.
 *   - `requestStop()` — hard. Abandon the run now (dispose, misfire).
 *
 * Audio that arrives during a graceful finish is staged rather than appended:
 * it belongs to the *next* utterance, and feeding it to the finishing run would
 * make the model transcribe past the endpoint it was told to stop at. `complete()`
 * promotes it, so the next run still starts with its own onset audio.
 */
export class StreamingAudioFeed {
  private active: Float32Array = new Float32Array(0);
  private staged: Float32Array = new Float32Array(0);
  private stagedSegments: Float32Array[] = [];
  private _finishing = false;
  private _stopped = false;

  /** Audio the current run may consume. */
  get audio(): Float32Array {
    return this.active;
  }

  get finishing(): boolean {
    return this._finishing;
  }

  get stopped(): boolean {
    return this._stopped;
  }

  append(samples: Float32Array): void {
    if (samples.length === 0) return;
    // Stage once the run is ending — under a stop too, not just a finish. The
    // generate loop only notices `stopped` on its next poll, and `complete()`
    // drops whatever is left in `active`; anything appended in that window
    // belongs to the next utterance, so it must not land there.
    if (this._finishing || this._stopped) {
      this.staged = concat(this.staged, samples);
    } else {
      this.active = concat(this.active, samples);
    }
  }

  /**
   * Bound audio retained before a generate run starts.
   *
   * The worker continuously receives silence while VAD is idle. Keeping that
   * entire history makes the next utterance feed an arbitrarily large first
   * backlog into ORT. Preserve only the recent pre-roll needed for speech onset.
   */
  retainLatest(maxSamples: number): void {
    if (this._finishing || this._stopped) return;
    const limit = Number.isFinite(maxSamples) ? Math.max(0, Math.floor(maxSamples)) : 0;
    if (this.active.length <= limit) return;
    this.active = this.active.slice(this.active.length - limit);
  }

  /** Seal the staged utterance at its VAD endpoint while the active run drains. */
  sealStaged(padSamples: number): void {
    const padding = Number.isFinite(padSamples) ? Math.max(0, Math.floor(padSamples)) : 0;
    if (padding > 0) this.staged = concat(this.staged, new Float32Array(padding));
    this.stagedSegments.push(this.staged);
    this.staged = new Float32Array(0);
  }

  /** End the run gracefully, padding with `padSamples` of silence first. */
  requestFinish(padSamples: number): void {
    if (this._finishing) return;
    if (padSamples > 0) {
      this.active = concat(this.active, new Float32Array(padSamples));
    }
    this._finishing = true;
  }

  /** Abandon the run — no tail decoding. */
  requestStop(): void {
    this._stopped = true;
  }

  /** Enough audio buffered to build a chunk ending at `untilSample`. */
  hasSamples(untilSample: number): boolean {
    return this.active.length >= untilSample;
  }

  /** Stop waiting for more audio: the chunk is available, or the run is ending. */
  readyFor(untilSample: number): boolean {
    return this._stopped || this._finishing || this.hasSamples(untilSample);
  }

  /** The run is over: staged audio becomes the next run's starting buffer. */
  complete(): void {
    if (this.stagedSegments.length > 0) {
      this.active = this.stagedSegments.shift()!;
    } else {
      this.active = this.staged;
      this.staged = new Float32Array(0);
    }
    this._finishing = false;
    this._stopped = false;
  }

  clear(): void {
    this.active = new Float32Array(0);
    this.staged = new Float32Array(0);
    this.stagedSegments = [];
    this._finishing = false;
    this._stopped = false;
  }
}

/** Sentence terminators that finalize a result without waiting for VAD silence. */
const SENTENCE_END_PATTERN = /[.。!?！？]\s*$/;

export interface StreamingTextAccumulatorOptions {
  onPartial: (text: string) => void;
  onResult: (text: string) => void;
  /** Finalize on terminal punctuation instead of waiting for the VAD endpoint. */
  punctuationEndpoint?: boolean;
}

/**
 * Turns the model's token stream into partials and results.
 *
 * `end()` flushes whatever the model produced — tokens decoded but not yet
 * emitted are real transcription, and dropping them silently truncates the last
 * words of every utterance. Only an explicit `discard` (teardown) throws them away.
 */
export class StreamingTextAccumulator {
  private cache: bigint[] = [];
  private printLen = 0;
  private pendingText = '';

  constructor(
    private readonly decode: (tokens: bigint[]) => string,
    private readonly options: StreamingTextAccumulatorOptions,
  ) {}

  /** Text emitted as a partial but not yet finalized into a result. */
  get pending(): string {
    return this.pendingText;
  }

  push(tokens: bigint[]): void {
    if (tokens.length === 0) return;
    this.cache = this.cache.concat(tokens);
    this.flush();
  }

  end(options?: { discard?: boolean }): void {
    if (options?.discard) {
      this.reset();
      return;
    }
    this.flush();
    const text = this.pendingText.trim();
    this.reset();
    if (text) this.options.onResult(text);
  }

  reset(): void {
    this.cache = [];
    this.printLen = 0;
    this.pendingText = '';
  }

  private flush(): void {
    if (this.cache.length === 0) return;
    const decoded = this.decode(this.cache);
    const newText = decoded.slice(this.printLen);
    if (newText.length === 0) return;

    // Hold back a partial multi-byte character (U+FFFD) until its rest arrives.
    const replacementIdx = newText.indexOf('�');
    const safeToPrint = replacementIdx === -1 ? newText : newText.slice(0, replacementIdx);
    if (safeToPrint.length === 0) return;

    this.printLen += safeToPrint.length;
    this.pendingText += safeToPrint;
    this.options.onPartial(this.pendingText);

    if (this.options.punctuationEndpoint !== false && SENTENCE_END_PATTERN.test(this.pendingText)) {
      const result = this.pendingText.trim();
      this.pendingText = '';
      this.options.onResult(result);
    }
  }
}
