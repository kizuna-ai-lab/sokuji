import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { createNativeVadWorker } from '../../lib/local-inference/native/createNativeVadWorker';
import { NativeAsrClient } from '../../lib/local-inference/native/NativeAsrClient';
import { NativeTranslateClient } from '../../lib/local-inference/native/NativeTranslateClient';
import { NativeTtsClient } from '../../lib/local-inference/native/NativeTtsClient';
import { SidecarConnection, type ISidecarConnection } from '../../lib/local-inference/native/SidecarConnection';
import type { LocalNativeConfig } from './config';
import type { NativeDevice } from './settings';

/**
 * The narrow shapes Local Native's adapter drives, over today's sidecar
 * clients (`src/lib/local-inference/native/`) and the renderer VAD worker.
 * Each stage owns its socket, as the sidecar routes binary frames and frees
 * memory per connection. `onClosed`: the socket went away unasked — the
 * stage will answer nothing more (`dispose()` never fires it). Tests pass
 * fakes (`fakeEngines.ts`).
 */

/** What a stage's init reply reports: the sidecar's resolved plan. */
export interface NativeInitReport {
  loadTimeMs?: number;
  backend?: string;
  device?: string;
  computeType?: string;
  rtf?: number;
  tokensPerSec?: number;
  memoryBytes?: number;
  fallbackReason?: string;
}

export interface NativeTtsReady extends NativeInitReport {
  sampleRate: number;
  /** The family streams its synthesis in chunks. */
  streaming: boolean;
  /** The family clones a voice from a clip (the old catalog's fallback for the capability). */
  clones: boolean;
}

export interface NativeAsrLike {
  init(o: { language: string; modelId: string; device: NativeDevice; variant?: string }): Promise<NativeInitReport>;
  /** Contract-rate pcm, sent as is: the socket copies it. */
  feedAudio(pcm: Int16Array): void;
  /** A VAD edge; the sidecar cuts its utterances on these (spec Amendment A1 of the sidecar design). */
  sendVadMark(event: 'start' | 'end' | 'cancel'): void;
  flush(): Promise<void>;
  dispose(): void;
  /** The cumulative hypothesis for the utterance, never a delta. */
  onPartialResult: ((text: string) => void) | null;
  onResult: ((r: { text: string; durationMs: number; recognitionTimeMs: number }) => void) | null;
  /** An id-less error push: one chunk failed, the engine goes on. */
  onError: ((message: string) => void) | null;
  onClosed: ((message: string) => void) | null;
}

export interface NativeTranslationLike {
  init(o: { sourceLang: string; targetLang: string; modelId: string; device: NativeDevice; variant?: string; asrModel?: string; ttsModel?: string }): Promise<NativeInitReport>;
  translate(text: string, systemPrompt: string, wrapTranscript: boolean): Promise<{ translatedText: string; inferenceTimeMs: number }>;
  dispose(): void;
  /** The cleaned accumulation so far, once per token: never a delta. */
  onPartial: ((text: string) => void) | null;
  onError: ((message: string) => void) | null;
  onClosed: ((message: string) => void) | null;
}

export interface NativeTtsLike {
  init(o: { modelId: string; device: NativeDevice; language: string; variant?: string }): Promise<NativeTtsReady>;
  setVoice(name: string): Promise<void>;
  setReferenceVoice(audio: Float32Array, sampleRate: number, transcript?: string): Promise<void>;
  /** Streaming families call `onChunk` with 24 kHz Float32 and resolve with no samples; one-shot ones resolve with the clip at its own rate. */
  generate(text: string, speed: number, onChunk?: (pcm: Float32Array) => void): Promise<{ samples: Float32Array; sampleRate: number; generationTimeMs: number }>;
  dispose(): void;
  onError: ((message: string) => void) | null;
  onClosed: ((message: string) => void) | null;
}

export interface NativeVadLike {
  init(config: LocalNativeConfig['vad']): Promise<void>;
  feed(pcm: Int16Array): void;
  /** Ends the open speech segment now (a turn's end). */
  flush(): void;
  dispose(): void;
  onSpeechStart: (() => void) | null;
  onSpeechEnd: (() => void) | null;
  onSpeechCancel: (() => void) | null;
  /** The ready worker failed: no more edges will come. */
  onError: ((message: string) => void) | null;
}

export interface LocalNativeEngines {
  asr(): NativeAsrLike;
  translation(): NativeTranslationLike;
  tts(): NativeTtsLike;
  vad(): NativeVadLike;
}

export function nativeAsr(conn: ISidecarConnection = new SidecarConnection()): NativeAsrLike {
  const client = new NativeAsrClient(conn);
  const asr: NativeAsrLike = {
    onPartialResult: null,
    onResult: null,
    onError: null,
    onClosed: null,
    init: ({ language, modelId, device, variant }) => client.init(language, modelId, SAMPLE_RATE, device, variant),
    feedAudio: (pcm) => client.feedAudio(pcm, SAMPLE_RATE),
    sendVadMark: (event) => client.sendVadMark(event),
    flush: () => client.flush(),
    dispose: () => client.dispose(),
  };
  client.onPartialResult = (text) => asr.onPartialResult?.(text);
  client.onResult = (r) => asr.onResult?.({ text: r.text, durationMs: r.durationMs, recognitionTimeMs: r.recognitionTimeMs });
  client.onError = (message) => asr.onError?.(message);
  conn.onClose((error) => asr.onClosed?.(error.message));
  return asr;
}

export function nativeTranslation(conn: ISidecarConnection = new SidecarConnection()): NativeTranslationLike {
  const client = new NativeTranslateClient(conn);
  const translation: NativeTranslationLike = {
    onPartial: null,
    onError: null,
    onClosed: null,
    init: ({ sourceLang, targetLang, modelId, device, variant, asrModel, ttsModel }) =>
      client.init(sourceLang, targetLang, modelId, device, asrModel ?? null, ttsModel ?? null, variant),
    translate: (text, systemPrompt, wrapTranscript) => client.translate(text, systemPrompt, wrapTranscript),
    dispose: () => client.dispose(),
  };
  client.onPartial = (text) => translation.onPartial?.(text);
  client.onError = (message) => translation.onError?.(message);
  conn.onClose((error) => translation.onClosed?.(error.message));
  return translation;
}

export function nativeTts(conn: ISidecarConnection = new SidecarConnection()): NativeTtsLike {
  const client = new NativeTtsClient(conn);
  const tts: NativeTtsLike = {
    onError: null,
    onClosed: null,
    init: ({ modelId, device, language, variant }) => client.init(modelId, device, language, variant),
    setVoice: (name) => client.setVoice(name),
    setReferenceVoice: (audio, sampleRate, transcript) => client.setReferenceVoice(audio, sampleRate, transcript),
    generate: (text, speed, onChunk) => client.generate(text, speed, onChunk ? (pcm) => onChunk(pcm) : undefined),
    dispose: () => client.dispose(),
  };
  client.onError = (message) => tts.onError?.(message);
  // The connection keeps one close handler, and the client's own rejects its
  // streams: this one takes its place, so it disposes the client — which
  // rejects them — before saying so.
  conn.onClose((error) => {
    client.dispose();
    tts.onClosed?.(error.message);
  });
  return tts;
}

export function nativeVad(factory: () => Worker | null = createNativeVadWorker): NativeVadLike {
  const worker = factory();
  let ready = false;
  const vad: NativeVadLike = {
    onSpeechStart: null,
    onSpeechEnd: null,
    onSpeechCancel: null,
    onError: null,
    init: (config) => new Promise<void>((resolve, reject) => {
      if (!worker) { resolve(); return; }
      const failed = (message: string) => {
        if (ready) vad.onError?.(message);
        else reject(new Error(message));
      };
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; message?: string };
        if (m.type === 'ready') { ready = true; resolve(); }
        else if (m.type === 'speech_start') vad.onSpeechStart?.();
        else if (m.type === 'speech_end') vad.onSpeechEnd?.();
        else if (m.type === 'speech_cancel') vad.onSpeechCancel?.();
        else if (m.type === 'error') failed(m.message ?? 'VAD worker failed');
      };
      worker.onerror = (e: ErrorEvent) => failed(e.message || 'VAD worker failed');
      worker.postMessage({
        type: 'init',
        ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
        vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
        // Three knobs and no max duration: the worker cuts at 19 s itself, under the sidecar's own backstop.
        vadConfig: { threshold: config.threshold, minSilenceDuration: config.minSilenceDuration, minSpeechDuration: config.minSpeechDuration },
      });
    }),
    feed: (pcm) => worker?.postMessage({ type: 'audio', pcm, sampleRate: SAMPLE_RATE }),
    flush: () => worker?.postMessage({ type: 'flush' }),
    dispose: () => {
      worker?.postMessage({ type: 'dispose' });
      worker?.terminate();
    },
  };
  return vad;
}

export const nativeEngines: LocalNativeEngines = {
  asr: () => nativeAsr(),
  translation: () => nativeTranslation(),
  tts: () => nativeTts(),
  vad: () => nativeVad(),
};
