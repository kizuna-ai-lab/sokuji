import { AsrEngine, type AsrPartialTag, type AsrResult } from '../../lib/local-inference/engine/AsrEngine';
import { StreamingAsrEngine } from '../../lib/local-inference/engine/StreamingAsrEngine';
import { TranslationEngine } from '../../lib/local-inference/engine/TranslationEngine';
import { TtsEngine } from '../../lib/local-inference/engine/TtsEngine';
import { TurnDetector, type TurnDetectorInit } from '../../lib/local-inference/engine/TurnDetector';
import { turnRuntime, type TurnConnection } from '../../lib/turn/TurnRuntime';
import type { VadWebConfig } from '../../lib/local-inference/types';
import type { TurnFailureCode } from '../../lib/local-inference/workers/_shared/turn-detector-protocol';
import type { LocalInferenceConfig } from './config';
import type { TranslationLike, TtsLike } from '../../lib/local-inference/sessions/engines';

/**
 * The narrow shapes the LocalInference adapter drives, declared from today's
 * engine classes (`src/lib/local-inference/engine/`), whose only changes are
 * ruling 6's: a `disposed` check in `init()` and a public `onFatal` hook.
 * `defaultEngines` puts the real classes behind them; tests pass fakes.
 */

export interface AsrInit {
  /** What the recognizer's own VAD reads: sherpa-onnx and Voxtral 4B. The WebGPU recognizers run none. */
  vadConfig?: VadWebConfig;
  /** The source language hint. */
  language: string;
  /** AST: the model itself translates into this language (Granite Speech). */
  translateTo?: string;
  /** The voxtral worker's own sentence endpoint (default on): off only while the adapter's stream shape seals — exactly one layer may cut. */
  punctuationEndpoint?: boolean;
  /** The turn detector's port: segments for a segment recognizer (WebGPU, sherpa offline), audio and marks for Voxtral 4B; transferred. Required by the WebGPU ones, ignored by an own-turns one. */
  segmentPort?: MessagePort;
}

/** An utterance the ASR finished: the engine's own shape. */
export type { AsrResult };

/** `AsrEngine` or `StreamingAsrEngine` behind one shape. */
export interface AsrLike {
  init(modelId: string, options: AsrInit): Promise<void>;
  feedAudio(samples: Int16Array, sampleRate: number): void;
  flush(): void;
  /** Raise the recognizer's epoch: the older epoch's queued segments are dropped. A no-op for an engine that cuts its own turns. */
  stop(epoch: number): void;
  dispose(): void;
  /** The cumulative hypothesis for the utterance so far, never a delta. `tag`: the segment's press and epoch, when the recognizer decodes the detector's segments. */
  onPartialResult: ((text: string, tag?: AsrPartialTag) => void) | null;
  /** The recognizer decoded or dropped everything the detector sent before its drain mark `seq`. */
  onDrained: ((seq: number) => void) | null;
  /** `startSample`: where the utterance began in the audio fed since `init`, at 16 kHz, when the recognizer says. */
  onResult: ((result: AsrResult) => void) | null;
  onSpeechStart: (() => void) | null;
  /** An error message from the ready worker: one utterance failed, the engine goes on. */
  onError: ((error: string) => void) | null;
  /** The ready worker died: nothing more will be transcribed. */
  onFatal: ((error: string) => void) | null;
}

/** The turn detector, as the adapter drives it: `TurnDetector`'s public shape. */
export interface TurnDetectorLike {
  init(o: TurnDetectorInit): Promise<unknown>;
  /** The buffer is transferred: the caller keeps no use of `pcm`. */
  feedAudio(pcm: Int16Array): void;
  begin(press: number): void;
  drain(press?: number): void;
  cancel(press: number): void;
  stop(epoch: number): void;
  dispose(): void;
  onSpeechStart: (() => void) | null;
  /** The leg's one failure; fires at most once. */
  onFailed: ((failure: { code: TurnFailureCode; message: string }) => void) | null;
  /** The detector worker died after it was ready. */
  onFatal: ((error: string) => void) | null;
}

/** What the adapter drives: today's engine classes by default, fakes in tests. */
export interface LocalEngines {
  asr(config: LocalInferenceConfig['asr']): AsrLike;
  translation(): TranslationLike;
  tts(): TtsLike;
  /** A connection to the Smart Turn worker; null when it cannot run. */
  turn?: () => Promise<TurnConnection | null>;
  /** A turn detector for a leg whose recognizer takes our turn detection. */
  detector?: () => TurnDetectorLike;
}

function asrOver(engine: AsrEngine | StreamingAsrEngine): AsrLike {
  const asr: AsrLike = {
    onPartialResult: null,
    onResult: null,
    onSpeechStart: null,
    onDrained: null,
    onError: null,
    onFatal: null,
    async init(modelId, { vadConfig, language, translateTo, punctuationEndpoint, segmentPort }) {
      if (engine instanceof StreamingAsrEngine) {
        await engine.init(modelId, { language, vadConfig, punctuationEndpoint: punctuationEndpoint ?? true, segmentPort });
      } else {
        await engine.init(modelId, vadConfig, language, translateTo ? { task: 'translate', targetLanguage: translateTo } : undefined, segmentPort);
      }
    },
    feedAudio: (samples, sampleRate) => engine.feedAudio(samples, sampleRate),
    flush: () => engine.flush(),
    // Only a recognizer that decodes the detector's segments has an epoch.
    stop: (epoch) => { if (engine instanceof AsrEngine) engine.stop(epoch); },
    dispose: () => engine.dispose(),
  };
  // The streaming engine's partials carry no tag.
  engine.onPartialResult = (text: string, tag?: AsrPartialTag) => asr.onPartialResult?.(text, tag);
  if (engine instanceof AsrEngine) engine.onDrained = (seq) => asr.onDrained?.(seq);
  engine.onResult = (result: AsrResult) => asr.onResult?.(result);
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
  turn: () => turnRuntime.connect(),
  detector: () => new TurnDetector(),
};
