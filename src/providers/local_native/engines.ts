import { SAMPLE_RATE } from '../../lib/contract/adapter';
import { NativeAsrClient } from '../../lib/local-inference/native/NativeAsrClient';
import { NativeTranslateClient } from '../../lib/local-inference/native/NativeTranslateClient';
import { NativeTtsClient } from '../../lib/local-inference/native/NativeTtsClient';
import { SidecarConnection, type ISidecarConnection } from '../../lib/local-inference/native/SidecarConnection';
import type { Clock } from '../../lib/contract/clock';
import { TurnDetector } from '../../lib/local-inference/engine/TurnDetector';
import type { SegmentLimit } from '../../lib/local-inference/workers/_shared/max-speech-frames';
import type { MarksOutput } from '../../lib/local-inference/workers/_shared/turn-detector-protocol';
import { turnRuntime, type TurnConnection } from '../../lib/turn/TurnRuntime';
import type { TurnDetectorLike } from '../localInference/engines';
import type { NativeDevice } from '../../lib/local-inference/native/nativeCatalog';
import type { NativeInitReport } from '../../lib/local-inference/native/nativeModels';
import type { LocalNativeConfig } from './config';

/**
 * The narrow shapes Local Native's adapter drives, over today's sidecar
 * clients (`src/lib/local-inference/native/`) and the app's turn detector.
 * Each stage owns its socket, as the sidecar routes binary frames and frees
 * memory per connection. `onClosed`: the socket went away unasked — the
 * stage will answer nothing more (`dispose()` never fires it). Every socket
 * and timer runs on the clock its seam is handed: the run's (#578 ruling 23).
 * Tests pass fakes (`fakeEngines.ts`).
 */

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
  /** `timeoutMs`: how long the request may wait for its answer; the connection's default when absent. */
  translate(text: string, systemPrompt: string, wrapTranscript: boolean, timeoutMs?: number): Promise<{ translatedText: string; inferenceTimeMs: number }>;
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

/**
 * The leg's turns: the shared turn detector in its audio-and-marks delivery. The leg's audio goes in; the same audio
 * comes out, in order, with `start`, `end` and `cancel` marks between its samples, so a consumer that acts on a mark
 * when it receives it cuts at the right position, whatever the detector's delay (spec C1).
 */
export interface NativeTurnsLike {
  init(o: { turns: 'auto' | 'manual'; vad: LocalNativeConfig['vad']; limit: SegmentLimit; turnPort?: MessagePort }): Promise<void>;
  /** The leg's audio, 24 kHz; the buffer is transferred, so the caller keeps no use of it. */
  feed(pcm: Int16Array): void;
  /** A manual turn: the key went down (`press` numbers it), came up (drain), or the turn was dropped. */
  begin(press: number): void;
  drain(press: number): void;
  cancel(press: number): void;
  dispose(): void;
  /** The leg's audio, relayed in order. */
  onAudio: ((pcm: Int16Array) => void) | null;
  /** A turn edge, between the samples it separates. */
  onMark: ((event: 'start' | 'end' | 'cancel') => void) | null;
  /** Everything held at a drain has been delivered (audio and marks) before this. */
  onDrained: (() => void) | null;
  /** The detector failed or died: no more turns will come. */
  onError: ((message: string) => void) | null;
}

export interface LocalNativeEngines {
  asr(clock: Clock): NativeAsrLike;
  translation(clock: Clock): NativeTranslationLike;
  tts(clock: Clock): NativeTtsLike;
  turns(): NativeTurnsLike;
  /** A connection to the Smart Turn worker; null when it cannot run. */
  turn?: () => Promise<TurnConnection | null>;
}

export function nativeAsr(clock: Clock, conn: ISidecarConnection = new SidecarConnection(clock)): NativeAsrLike {
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

export function nativeTranslation(clock: Clock, conn: ISidecarConnection = new SidecarConnection(clock)): NativeTranslationLike {
  const client = new NativeTranslateClient(conn);
  const translation: NativeTranslationLike = {
    onPartial: null,
    onError: null,
    onClosed: null,
    init: ({ sourceLang, targetLang, modelId, device, variant, asrModel, ttsModel }) =>
      client.init(sourceLang, targetLang, modelId, device, asrModel ?? null, ttsModel ?? null, variant),
    translate: (text, systemPrompt, wrapTranscript, timeoutMs) => client.translate(text, systemPrompt, wrapTranscript, timeoutMs),
    dispose: () => client.dispose(),
  };
  client.onPartial = (text) => translation.onPartial?.(text);
  client.onError = (message) => translation.onError?.(message);
  conn.onClose((error) => translation.onClosed?.(error.message));
  return translation;
}

export function nativeTts(clock: Clock, conn: ISidecarConnection = new SidecarConnection(clock)): NativeTtsLike {
  const client = new NativeTtsClient(conn, clock);
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

export function nativeTurns(detector: TurnDetectorLike = new TurnDetector()): NativeTurnsLike {
  let port: MessagePort | null = null;
  const turns: NativeTurnsLike = {
    onAudio: null,
    onMark: null,
    onDrained: null,
    onError: null,
    async init({ turns: mode, vad, limit, turnPort }) {
      const { port1, port2 } = new MessageChannel();
      port = port2;
      port2.onmessage = (e: MessageEvent<MarksOutput>) => {
        const msg = e.data;
        if (msg.type === 'audio') turns.onAudio?.(msg.pcm);
        else if (msg.type === 'mark') turns.onMark?.(msg.event);
        else if (msg.type === 'drained') turns.onDrained?.();
      };
      detector.onFailed = ({ message }) => turns.onError?.(message);
      detector.onFatal = (error) => turns.onError?.(error);
      try {
        await detector.init({ turns: mode, vad, limit, delivery: 'marks', output: port1, ...(turnPort ? { turnPort } : {}) });
      } catch (error) {
        port1.close();
        port2.close();
        port = null;
        throw error;
      }
    },
    feed: (pcm) => detector.feedAudio(pcm),
    begin: (press) => detector.begin(press),
    drain: (press) => detector.drain(press),
    cancel: (press) => detector.cancel(press),
    dispose: () => {
      detector.dispose();
      if (port) { port.onmessage = null; port.close(); port = null; }
    },
  };
  return turns;
}

export const nativeEngines: LocalNativeEngines = {
  asr: (clock) => nativeAsr(clock),
  translation: (clock) => nativeTranslation(clock),
  tts: (clock) => nativeTts(clock),
  turns: () => nativeTurns(),
  turn: () => turnRuntime.connect(),
};
