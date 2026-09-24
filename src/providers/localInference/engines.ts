import { AsrEngine } from '../../lib/local-inference/engine/AsrEngine';
import { StreamingAsrEngine } from '../../lib/local-inference/engine/StreamingAsrEngine';
import { TranslationEngine, type TranslationResult } from '../../lib/local-inference/engine/TranslationEngine';
import { TtsEngine, type AudioChunkCallback, type TtsResult } from '../../lib/local-inference/engine/TtsEngine';
import type { VadWebConfig } from '../../lib/local-inference/types';
import type { LocalInferenceConfig } from './config';

/**
 * The narrow shapes the LocalInference adapter drives, declared from today's
 * engine classes (`src/lib/local-inference/engine/`), whose only changes are
 * ruling 6's: a `disposed` check in `init()` and a public `onFatal` hook.
 * `defaultEngines` puts the real classes behind them; tests pass fakes.
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

/** `TranslationEngine`, as it is: its `onError` carries only fatal failures. */
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

/** `TtsEngine`, as it is. */
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

function asrOver(engine: AsrEngine | StreamingAsrEngine): AsrLike {
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
    },
    feedAudio: (samples, sampleRate) => engine.feedAudio(samples, sampleRate),
    flush: () => engine.flush(),
    dispose: () => engine.dispose(),
  };
  engine.onPartialResult = (text) => asr.onPartialResult?.(text);
  engine.onResult = (result: { text: string; durationMs: number; recognitionTimeMs: number }) => asr.onResult?.(result);
  engine.onSpeechStart = () => asr.onSpeechStart?.();
  // Two failures, kept apart by the engine's own hook: a ready worker's
  // `error` message is one chunk (the streaming worker resets and goes on);
  // the worker dying is the end of it.
  engine.onError = (error) => asr.onError?.(error);
  engine.onFatal = (error) => asr.onFatal?.(error);
  return asr;
}

export const defaultEngines: LocalEngines = {
  asr: (config) => asrOver(config.streaming ? new StreamingAsrEngine() : new AsrEngine()),
  translation: () => new TranslationEngine(),
  tts: () => new TtsEngine(),
};
