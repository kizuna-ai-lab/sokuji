/**
 * Translation Web Worker — Opus-MT via @huggingface/transformers
 * Runs ONNX inference in a background thread.
 *
 * Model files are pre-downloaded into IndexedDB and passed in as blob URLs.
 * A customCache bridge lets Transformers.js find those files without any
 * network requests to HuggingFace Hub.
 */

import { pipeline, env } from '@huggingface/transformers';
import type { TranslationPipeline } from '@huggingface/transformers';

// Disable WASM proxy (we're already in a worker)
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

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

/**
 * Create a custom cache object that serves pre-downloaded blob URLs
 * to Transformers.js, avoiding any HuggingFace Hub network requests.
 *
 * Transformers.js requests files via URLs like:
 *   https://huggingface.co/Xenova/opus-mt-ja-en/resolve/main/config.json
 *   https://huggingface.co/Xenova/opus-mt-ja-en/resolve/main/onnx/encoder_model_quantized.onnx
 *
 * We extract the path after /resolve/main/ and look it up in our fileUrls map.
 */
function createBlobUrlCache(fileUrls: Record<string, string>) {
  return {
    async match(request: string | Request | undefined): Promise<Response | undefined> {
      if (!request) return undefined;

      const url = typeof request === 'string' ? request : request.url;

      // Extract filename from HuggingFace URL pattern:
      // https://huggingface.co/{org}/{model}/resolve/main/{path}
      const resolveMainMarker = '/resolve/main/';
      const idx = url.indexOf(resolveMainMarker);
      if (idx === -1) return undefined;

      const filename = url.slice(idx + resolveMainMarker.length);
      const blobUrl = fileUrls[filename];
      if (!blobUrl) return undefined;

      // Fetch the blob URL to get a proper Response object
      const response = await fetch(blobUrl);
      return response;
    },

    // No-op: files are already stored in IndexedDB
    async put(_request: string | Request, _response: Response): Promise<void> {},
  };
}

async function handleInit(msg: InitMessage) {
  try {
    const startTime = performance.now();
    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId });

    // Configure Transformers.js to use our blob URL cache instead of network
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);

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
    translator = await (pipeline as any)('translation', msg.hfModelId, {
      dtype: 'q8',
      device,
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
