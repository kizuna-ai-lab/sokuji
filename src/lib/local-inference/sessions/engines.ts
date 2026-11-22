import type { TranslationResult } from '../engine/TranslationEngine';
import type { AudioChunkCallback, TtsResult } from '../engine/TtsEngine';

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
