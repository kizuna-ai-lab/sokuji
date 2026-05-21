/**
 * Barrel shim for @huggingface/transformers — pins the worker-shared import
 * surface so every worker bundles an identical chunk, allowing Vite to emit
 * a single shared `hf-transformers-*.js` instead of one per worker.
 *
 * The surface listed below is the *union of what every transformers-using
 * worker in this repo imports today*. It is not the complete transformers
 * API. When adding a new worker that needs a class not yet listed here,
 * add it to both the pin array and the `export { … }` block — otherwise
 * that worker's tree-shake will diverge and Vite will emit a separate
 * hf-transformers chunk for it.
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
