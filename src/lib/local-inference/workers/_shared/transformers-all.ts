/**
 * Barrel shim for @huggingface/transformers — pins the full import surface
 * so every worker bundles an identical chunk, allowing Vite to emit a single
 * shared `hf-transformers-*.js` instead of one per worker.
 *
 * Vite bundles each worker as its own Rollup build, so manualChunks runs
 * per-worker. Without this shim each worker tree-shakes a different subset
 * of transformers (whisper needs AutomaticSpeechRecognitionPipeline, granite
 * needs GraniteSpeechForConditionalGeneration, etc.), producing 7+ distinct
 * chunks with overlapping content (~2.8 MB total).
 *
 * The pin assignment below is a real side effect that references every
 * concrete class via the namespace import, forcing them to be retained in
 * every consumer's bundle. Identical chunk content → identical content hash
 * → Vite emits one file shared by all workers.
 *
 * Bindings are re-exported directly from `@huggingface/transformers` so they
 * carry both value and type (classes live in both namespaces).
 */

import * as T from '@huggingface/transformers';

(self as { __transformersPin?: unknown }).__transformersPin = [
  T.pipeline,
  T.env,
  T.AutoProcessor,
  T.TextStreamer,
  T.BaseStreamer,
  T.GraniteSpeechForConditionalGeneration,
  T.VoxtralRealtimeForConditionalGeneration,
  T.VoxtralRealtimeProcessor,
  T.VoxtralForConditionalGeneration,
  T.VoxtralProcessor,
  T.Qwen3_5ForConditionalGeneration,
];

export {
  pipeline,
  env,
  AutoProcessor,
  TextStreamer,
  BaseStreamer,
  GraniteSpeechForConditionalGeneration,
  VoxtralRealtimeForConditionalGeneration,
  VoxtralRealtimeProcessor,
  VoxtralForConditionalGeneration,
  VoxtralProcessor,
  Qwen3_5ForConditionalGeneration,
} from '@huggingface/transformers';

export type {
  AutomaticSpeechRecognitionPipeline,
  ProgressInfo,
  TranslationPipeline,
} from '@huggingface/transformers';
