import { AsrEngine } from '../../lib/local-inference/engine/AsrEngine';
import { StreamingAsrEngine } from '../../lib/local-inference/engine/StreamingAsrEngine';
import { TranslationEngine, type TranslationResult } from '../../lib/local-inference/engine/TranslationEngine';
import { TtsEngine, type AudioChunkCallback, type TtsResult } from '../../lib/local-inference/engine/TtsEngine';
import type { VadWebConfig } from '../../lib/local-inference/types';
import type { LocalInferenceConfig } from './config';

/**
 * The narrow shapes the LocalInference adapter drives, declared from today's
 * engine classes (`src/lib/local-inference/engine/`), which stay as they are
 * (ruling 6). `defaultEngines` puts the real classes behind them; tests pass
 * fakes.
 */

export interface AsrInit {
  vadConfig: VadWebConfig;
  /** The source language hint. */
  language: string;
  /** AST: the model itself translates into this language (Granite Speech). */
  translateTo?: string;
}

/** `AsrEngine` or `StreamingAsrEngine` behind one shape. */
export interface AsrLike {
  init(modelId: string, options: AsrInit): Promise<void>;
  feedAudio(samples: Int16Array, sampleRate: number): void;
  flush(): void;
  dispose(): void;
  /** The cumulative hypothesis for the utterance so far, never a delta. */
  onPartialResult: ((text: string) => void) | null;
  onResult: ((result: { text: string; durationMs: number; recognitionTimeMs: number }) => void) | null;
  onSpeechStart: (() => void) | null;
  /** An error message from the ready worker: one utterance failed, the engine goes on. */
  onError: ((error: string) => void) | null;
  /** The ready worker died: nothing more will be transcribed. */
  onFatal: ((error: string) => void) | null;
}

/** `TranslationEngine`, as it is. */
export interface TranslationLike {
  init(sourceLang: string, targetLang: string, modelId?: string): Promise<unknown>;
  translate(text: string, systemPrompt: string, wrapTranscript: boolean): Promise<TranslationResult>;
  dispose(): void;
  /** A failure no request carries — the worker died, or erred without an id: no translation will complete. */
  onError: ((error: string) => void) | null;
}

/** What a TTS load reports that the adapter reads. */
export interface TtsReady {
  sampleRate: number;
  voices?: Array<{ sid: number }>;
}

export interface TtsLike {
  init(modelId: string): Promise<TtsReady>;
  generate(text: string, sid?: number, speed?: number, lang?: string): Promise<TtsResult>;
  generateStream(text: string, sid: number, speed: number, lang?: string, onChunk?: AudioChunkCallback, voice?: string): Promise<{ generationTimeMs: number }>;
  dispose(): void;
  /** The ready worker died: nothing more will be spoken. */
  onFatal: ((error: string) => void) | null;
}

/** What the adapter drives: today's engine classes by default, fakes in tests. */
export interface LocalEngines {
  asr(config: LocalInferenceConfig['asr']): AsrLike;
  translation(): TranslationLike;
  tts(): TtsLike;
}

/**
 * Each engine hands two different failures to one `onError`: its worker
 * dying (`WorkerSession`'s `onerror` → `onFatalError`) and an `error` message
 * from the ready worker, which is per chunk and recoverable (the streaming
 * worker resets and goes on). Only the first ends the session. The engine
 * keeps its worker private and must not change for this, so the one place a
 * death shows is the worker's own `onerror`: wrapped here, once the engine is
 * ready, to call `onDeath` and to say — while the engine's own handler runs
 * inside it — that the `onError` under way is the death.
 *
 * Reaches through two private fields (`engine.session.worker`), pinned by
 * `engines.test.ts` against the real classes; if the shape ever moves, no
 * death is seen and every error stays recoverable.
 */
function watchWorkerDeath(engine: object, onDeath: (message: string) => void): () => boolean {
  let dying = false;
  const worker = (engine as { session?: { worker?: Worker } | null }).session?.worker;
  if (!worker) return () => false;
  const original = worker.onerror;
  worker.onerror = (event: ErrorEvent) => {
    dying = true;
    try {
      original?.call(worker, event);
    } finally {
      dying = false;
    }
    onDeath(event.message || 'Worker error');
  };
  return () => dying;
}

function asrOver(engine: AsrEngine | StreamingAsrEngine): AsrLike {
  let dying = () => false;
  const asr: AsrLike = {
    onPartialResult: null,
    onResult: null,
    onSpeechStart: null,
    onError: null,
    onFatal: null,
    async init(modelId, { vadConfig, language, translateTo }) {
      if (engine instanceof StreamingAsrEngine) {
        // The worker's own punctuation endpoint stays on: nothing above it
        // cuts an utterance (the stream shape, which would, is plan 1e-2b's).
        await engine.init(modelId, { language, vadConfig, punctuationEndpoint: true });
      } else {
        await engine.init(modelId, vadConfig, language, translateTo ? { task: 'translate', targetLanguage: translateTo } : undefined);
      }
      dying = watchWorkerDeath(engine, (message) => asr.onFatal?.(message));
    },
    feedAudio: (samples, sampleRate) => engine.feedAudio(samples, sampleRate),
    flush: () => engine.flush(),
    dispose: () => engine.dispose(),
  };
  engine.onPartialResult = (text) => asr.onPartialResult?.(text);
  engine.onResult = (result: { text: string; durationMs: number; recognitionTimeMs: number }) => asr.onResult?.(result);
  engine.onSpeechStart = () => asr.onSpeechStart?.();
  engine.onError = (error) => {
    if (!dying()) asr.onError?.(error);
  };
  return asr;
}

function ttsOver(engine: TtsEngine): TtsLike {
  const tts: TtsLike = {
    onFatal: null,
    async init(modelId) {
      const ready = await engine.init(modelId);
      watchWorkerDeath(engine, (message) => tts.onFatal?.(message));
      return ready;
    },
    generate: (text, sid, speed, lang) => engine.generate(text, sid, speed, lang),
    generateStream: (text, sid, speed, lang, onChunk, voice) => engine.generateStream(text, sid, speed, lang, onChunk, voice),
    dispose: () => engine.dispose(),
  };
  return tts;
}

export const defaultEngines: LocalEngines = {
  asr: (config) => asrOver(config.streaming ? new StreamingAsrEngine() : new AsrEngine()),
  translation: () => new TranslationEngine(),
  tts: () => ttsOver(new TtsEngine()),
};
