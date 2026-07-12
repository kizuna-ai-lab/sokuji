/**
 * Translation Web Worker — Opus-MT via @huggingface/transformers
 * Runs ONNX inference in a background thread.
 *
 * Model files are pre-downloaded into IndexedDB and passed in as blob URLs.
 * A customCache bridge lets Transformers.js find those files without any
 * network requests to HuggingFace Hub.
 */

import { pipeline, env, type TranslationPipeline } from './_shared/transformers-all';
import { initTransformersEnv } from './_shared/transformers-env';

/** Detect WebGPU availability in this worker context */
async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (self as any).navigator?.gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

interface InitMessage {
  type: 'init';
  hfModelId: string; // e.g. 'Xenova/opus-mt-ja-en'
  fileUrls: Record<string, string>; // filename → blob URL
  sourceLang?: string; // provided by engine, ignored by Opus-MT
  targetLang?: string;
  ortWasmBaseUrl?: string; // resolved absolute URL for ORT WASM files
}

interface TranslateMessage {
  type: 'translate';
  id: string;
  text: string;
  sourceLang?: string; // provided by engine, ignored by Opus-MT
  targetLang?: string;
}

interface DisposeMessage {
  type: 'dispose';
}

type WorkerMessage = InitMessage | TranslateMessage | DisposeMessage;

let translator: TranslationPipeline | null = null;
let currentModelId: string | null = null;
void currentModelId; // Used for tracking, suppress unused warning

async function handleInit(msg: InitMessage) {
  try {
    const startTime = performance.now();
    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId });

    // Configure Transformers.js to use our blob URL cache instead of network
    initTransformersEnv(env, msg);

    // Suppress known "MarianTokenizer is not yet supported by fast tokenizers" warning
    // from @huggingface/transformers — all Opus-MT models trigger this; it's informational only
    const _warn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('MarianTokenizer')) return;
      _warn.apply(console, args);
    };

    // WASM is faster than WebGPU for small Opus-MT models (~50MB).
    // WebGPU overhead (shader compilation, CPU↔GPU transfer per token) outweighs
    // the parallelism benefit. Reserve WebGPU for large models like NLLB-200 (600MB+).
    const device = 'wasm';
    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId, device });

    // Create the translation pipeline — Transformers.js finds all files via customCache
    // Use 'basic' graph optimization to avoid ORT 1.25 TransposeDQWeightsForMatMulNBits
    // fusion bug that fails on some quantized Opus-MT models (e.g. opus-mt-en-zh).
    translator = await (pipeline as any)('translation', msg.hfModelId, {
      dtype: 'q8',
      device,
      session_options: {
        graphOptimizationLevel: 'basic',
      },
    }) as TranslationPipeline;

    // Restore original console.warn
    console.warn = _warn;

    currentModelId = msg.hfModelId;
    const elapsed = Math.round(performance.now() - startTime);
    self.postMessage({ type: 'ready', modelId: msg.hfModelId, loadTimeMs: elapsed, device });
  } catch (error: any) {
    self.postMessage({ type: 'error', error: error.message || String(error) });
  }
}

async function handleTranslate(msg: TranslateMessage) {
  if (!translator) {
    self.postMessage({ type: 'error', id: msg.id, error: 'Translator not initialized' });
    return;
  }

  try {
    const startTime = performance.now();
    const result = await (translator as any)(msg.text, {
      max_length: 512,
    });
    const elapsed = Math.round(performance.now() - startTime);

    // result is an array of { translation_text: string }
    const translatedText = Array.isArray(result)
      ? (result[0] as any).translation_text
      : (result as any).translation_text;

    self.postMessage({
      type: 'result',
      id: msg.id,
      sourceText: msg.text,
      translatedText,
      inferenceTimeMs: elapsed,
    });
  } catch (error: any) {
    self.postMessage({ type: 'error', id: msg.id, error: error.message || String(error) });
  }
}

async function handleDispose() {
  if (translator) {
    // @ts-ignore - dispose may exist on the pipeline
    await translator?.dispose?.();
    translator = null;
    currentModelId = null;
  }
  self.postMessage({ type: 'disposed' });
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'init':
      await handleInit(msg);
      break;
    case 'translate':
      await handleTranslate(msg);
      break;
    case 'dispose':
      await handleDispose();
      break;
  }
};
