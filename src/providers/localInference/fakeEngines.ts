/**
 * Test support: engines the test drives by hand, behind the adapter's narrow
 * shapes (`engines.ts`). Each `init` stays pending until the test settles it.
 */
import type { TranslationResult } from '../../lib/local-inference/engine/TranslationEngine';
import type { TurnConnection } from '../../lib/turn/TurnRuntime';
import type { TtsResult } from '../../lib/local-inference/engine/TtsEngine';
import type { SegmentEnd } from '../../lib/local-inference/types';
import { TurnDetectorError, type TurnDetectorInit } from '../../lib/local-inference/engine/TurnDetector';
import type { TurnFailureCode } from '../../lib/local-inference/workers/_shared/turn-detector-protocol';
import type { AsrInit, AsrLike, LocalEngines, TurnDetectorLike } from './engines';
import type { AsrPartialTag, AsrResult } from '../../lib/local-inference/engine/AsrEngine';
import type { TranslationLike, TtsLike, TtsReady } from '../../lib/local-inference/sessions/engines';
import type { LocalInferenceConfig } from './config';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export class FakeAsr implements AsrLike {
  onPartialResult: AsrLike['onPartialResult'] = null;
  onResult: AsrLike['onResult'] = null;
  onSpeechStart: AsrLike['onSpeechStart'] = null;
  onDrained: AsrLike['onDrained'] = null;
  onError: AsrLike['onError'] = null;
  onFatal: AsrLike['onFatal'] = null;

  config: LocalInferenceConfig['asr'] | null = null;
  inits: Array<{ modelId: string; options: AsrInit }> = [];
  /** The epochs `stop` was called with. */
  stops: number[] = [];
  fed: Int16Array[] = [];
  /** The sample rate each `feedAudio` was told. */
  rates: number[] = [];
  flushes = 0;
  disposes = 0;
  private loading = deferred<void>();

  init(modelId: string, options: AsrInit): Promise<void> {
    this.inits.push({ modelId, options });
    return this.loading.promise;
  }
  /** The model loaded: the pending `init` resolves. */
  ready(): void { this.loading.resolve(); }
  failInit(message: string): void { this.loading.reject(new Error(message)); }

  /** Like the real engines, the buffer is transferred to the worker: the array handed in is detached. */
  feedAudio(samples: Int16Array, sampleRate: number): void {
    const copy = new Int16Array(samples);
    structuredClone(samples.buffer, { transfer: [samples.buffer] });
    this.fed.push(copy);
    this.rates.push(sampleRate);
  }
  flush(): void { this.flushes++; }
  stop(epoch: number): void { this.stops.push(epoch); }
  dispose(): void { this.disposes++; }

  partial(text: string, tag?: AsrPartialTag): void { this.onPartialResult?.(text, tag); }
  final(text: string, end?: SegmentEnd & Partial<Pick<AsrResult, 'press' | 'epoch'>>): void { this.onResult?.({ text, durationMs: 1000, recognitionTimeMs: 100, ...end }); }
  /** A result of a detector segment: tagged with its press and the epoch it was cut in. */
  result(text: string, tag: { press?: number; epoch?: number } = {}, end?: SegmentEnd): void { this.final(text, { ...end, ...tag } as SegmentEnd & Pick<AsrResult, 'press' | 'epoch'>); }
  /** The recognizer decoded or dropped everything before the drain mark `seq`. */
  drained(seq = 0): void { this.onDrained?.(seq); }
  speechStart(): void { this.onSpeechStart?.(); }
  /** An error message from the ready worker (one utterance). */
  fail(message: string): void { this.onError?.(message); }
  /** The worker died. */
  die(message = 'RuntimeError: unreachable'): void { this.onFatal?.(message); }
}

export class FakeTranslation implements TranslationLike {
  onError: TranslationLike['onError'] = null;

  inits: Array<{ sourceLang: string; targetLang: string; modelId?: string }> = [];
  calls: Array<{ text: string; systemPrompt: string; wrapTranscript: boolean }> = [];
  disposes = 0;
  private loading = deferred<unknown>();
  private pending: Array<Deferred<TranslationResult>> = [];

  init(sourceLang: string, targetLang: string, modelId?: string): Promise<unknown> {
    this.inits.push({ sourceLang, targetLang, modelId });
    return this.loading.promise;
  }
  ready(): void { this.loading.resolve({ loadTimeMs: 1, device: 'wasm' }); }
  failInit(message: string): void { this.loading.reject(new Error(message)); }

  translate(text: string, systemPrompt: string, wrapTranscript: boolean): Promise<TranslationResult> {
    this.calls.push({ text, systemPrompt, wrapTranscript });
    const request = deferred<TranslationResult>();
    this.pending.push(request);
    return request.promise;
  }
  /** Answers the oldest request still waiting. */
  answer(translatedText: string): void {
    const request = this.pending.shift();
    request?.resolve({ sourceText: '', translatedText, inferenceTimeMs: 5 });
  }
  reject(error: unknown): void { this.pending.shift()?.reject(error); }
  /** A failure no request carries (TranslationEngine.onError). */
  fatal(message: string): void { this.onError?.(message); }
  dispose(): void { this.disposes++; }
}

export class FakeTts implements TtsLike {
  onFatal: TtsLike['onFatal'] = null;

  inits: string[] = [];
  disposes = 0;
  private loading = deferred<TtsReady>();

  /**
   * Synthesis behaviour for `speech.ts` tests; the defaults reproduce the
   * class's old fixed answers (empty samples, no stream chunks) so the
   * adapter tests that never inspect synthesized audio are unaffected.
   */
  rate = 24000;
  samplesPerSentence = 0;
  chunksPerSentence = 0;
  samplesPerChunk = 0;
  /** Zero-based call indices, counted across `generate` and `generateStream`
   *  together, that reject instead of synthesizing. */
  failOn = new Set<number>();
  /** Set: `generate` stays pending, a sentence still being synthesized, until
   *  `die()` or `dispose()` rejects it — as the real engine rejects its pending request. */
  holdGenerate = false;
  /** With `holdGenerate`: death and dispose leave the held sentence pending —
   *  nothing rejects Edge TTS's decode handshake — and only `release()` settles it. */
  holdPastDeath = false;

  generateCalls: Array<{ text: string; sid?: number; speed?: number; lang?: string }> = [];
  streamCalls: Array<{ text: string; sid: number; speed: number; lang?: string; voice?: string }> = [];
  private callIndex = 0;
  private pendingGenerate: Deferred<TtsResult> | null = null;

  init(modelId: string): Promise<TtsReady> {
    this.inits.push(modelId);
    return this.loading.promise;
  }
  ready(ready: TtsReady = { sampleRate: 24000 }): void { this.loading.resolve(ready); }
  failInit(message: string): void { this.loading.reject(new Error(message)); }

  async generate(text: string, sid?: number, speed?: number, lang?: string): Promise<TtsResult> {
    const index = this.callIndex++;
    this.generateCalls.push({ text, sid, speed, lang });
    if (this.failOn.has(index)) throw new Error(`fake synthesis failed for "${text}"`);
    if (this.holdGenerate) {
      this.pendingGenerate = deferred<TtsResult>();
      return this.pendingGenerate.promise;
    }
    return { samples: new Float32Array(this.samplesPerSentence), sampleRate: this.rate, generationTimeMs: 0 };
  }

  async generateStream(
    text: string,
    sid: number,
    speed: number,
    lang?: string,
    onChunk?: (samples: Float32Array, sampleRate: number) => void,
    voice?: string,
  ): Promise<{ generationTimeMs: number }> {
    const index = this.callIndex++;
    this.streamCalls.push({ text, sid, speed, lang, voice });
    if (this.failOn.has(index)) throw new Error(`fake synthesis failed for "${text}"`);
    for (let i = 0; i < this.chunksPerSentence; i++) {
      onChunk?.(new Float32Array(this.samplesPerChunk), this.rate);
    }
    return { generationTimeMs: 0 };
  }
  dispose(): void {
    this.disposes++;
    this.rejectPending(new Error('TTS engine disposed'));
  }
  /** The worker died: `onFatal` first, then the pending request rejects — the real engine's order. */
  die(message = 'RuntimeError: unreachable'): void {
    this.onFatal?.(message);
    this.rejectPending(new Error(message));
  }
  /** Settles the held sentence with its samples: a late answer from synthesis that may already be abandoned. */
  release(): void {
    this.pendingGenerate?.resolve({ samples: new Float32Array(this.samplesPerSentence), sampleRate: this.rate, generationTimeMs: 0 });
    this.pendingGenerate = null;
  }
  private rejectPending(error: Error): void {
    if (this.holdPastDeath) return;
    this.pendingGenerate?.reject(error);
    this.pendingGenerate = null;
  }
}

/** Smart Turn's runtime as the adapter sees it: a connection per ASR load, null when it cannot run. */
export class FakeTurn {
  connects = 0;
  releases = 0;
  available = true;
  readonly port = {} as MessagePort;

  connect(): Promise<TurnConnection | null> {
    this.connects++;
    if (!this.available) return Promise.resolve(null);
    return Promise.resolve({ port: this.port, release: () => { this.releases++; } });
  }
}

/** The turn detector, as the adapter drives it: it records every call, and the test makes it fail or die. */
export class FakeDetector implements TurnDetectorLike {
  onSpeechStart: TurnDetectorLike['onSpeechStart'] = null;
  onFailed: TurnDetectorLike['onFailed'] = null;
  onFatal: TurnDetectorLike['onFatal'] = null;

  inits: TurnDetectorInit[] = [];
  /** Every buffer handed over, copied before the transfer. */
  fed: Int16Array[] = [];
  begins: number[] = [];
  drains: Array<number | undefined> = [];
  cancels: number[] = [];
  stops: number[] = [];
  disposes = 0;
  private loading = deferred<unknown>();

  init(o: TurnDetectorInit): Promise<unknown> {
    this.inits.push(o);
    return this.loading.promise;
  }
  /** The detector loaded: the pending `init` resolves. */
  ready(): void { this.loading.resolve({ loadTimeMs: 1 }); }
  /** Silero could not load: the pending `init` rejects as the real one does. */
  failInit(code: TurnFailureCode, message: string): void { this.loading.reject(new TurnDetectorError(message, code)); }

  /** Like the real detector, the buffer is transferred to the worker. */
  feedAudio(pcm: Int16Array): void {
    const copy = new Int16Array(pcm);
    structuredClone(pcm.buffer, { transfer: [pcm.buffer] });
    this.fed.push(copy);
  }
  begin(press: number): void { this.begins.push(press); }
  drain(press?: number): void { this.drains.push(press); }
  cancel(press: number): void { this.cancels.push(press); }
  stop(epoch: number): void { this.stops.push(epoch); }
  dispose(): void { this.disposes++; }

  /** The leg's one failure. */
  fail(code: TurnFailureCode, message = code === 'turn_detection_overloaded' ? 'Turn detection cannot keep up on this device.' : 'Silero did not load'): void { this.onFailed?.({ code, message }); }
  /** The worker died after it was ready. */
  die(message = 'RuntimeError: unreachable'): void { this.onFatal?.(message); }
  speechStart(): void { this.onSpeechStart?.(); }
}

/** One of each fake, and the `LocalEngines` that hands them out; `created` lists what the adapter asked for. */
export function createFakeEngines() {
  const asr = new FakeAsr();
  const translation = new FakeTranslation();
  const tts = new FakeTts();
  const turn = new FakeTurn();
  const detector = new FakeDetector();
  const created: Array<'asr' | 'translation' | 'tts' | 'detector'> = [];
  const engines: LocalEngines = {
    asr: (config) => { created.push('asr'); asr.config = config; return asr; },
    translation: () => { created.push('translation'); return translation; },
    tts: () => { created.push('tts'); return tts; },
    turn: () => turn.connect(),
    detector: () => { created.push('detector'); return detector; },
  };
  return { engines, asr, translation, tts, turn, detector, created };
}
