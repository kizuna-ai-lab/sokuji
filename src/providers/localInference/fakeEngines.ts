/**
 * Test support: engines the test drives by hand, behind the adapter's narrow
 * shapes (`engines.ts`). Each `init` stays pending until the test settles it.
 */
import type { TranslationResult } from '../../lib/local-inference/engine/TranslationEngine';
import type { TtsResult } from '../../lib/local-inference/engine/TtsEngine';
import type { AsrInit, AsrLike, LocalEngines, TranslationLike, TtsLike, TtsReady } from './engines';
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
  onError: AsrLike['onError'] = null;
  onFatal: AsrLike['onFatal'] = null;

  config: LocalInferenceConfig['asr'] | null = null;
  inits: Array<{ modelId: string; options: AsrInit }> = [];
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
  dispose(): void { this.disposes++; }

  partial(text: string): void { this.onPartialResult?.(text); }
  final(text: string): void { this.onResult?.({ text, durationMs: 1000, recognitionTimeMs: 100 }); }
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

/** One of each fake, and the `LocalEngines` that hands them out; `created` lists what the adapter asked for. */
export function createFakeEngines() {
  const asr = new FakeAsr();
  const translation = new FakeTranslation();
  const tts = new FakeTts();
  const created: Array<'asr' | 'translation' | 'tts'> = [];
  const engines: LocalEngines = {
    asr: (config) => { created.push('asr'); asr.config = config; return asr; },
    translation: () => { created.push('translation'); return translation; },
    tts: () => { created.push('tts'); return tts; },
  };
  return { engines, asr, translation, tts, created };
}
