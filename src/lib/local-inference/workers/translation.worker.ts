/**
 * Translation Web Worker — Opus-MT via @huggingface/transformers
 * Runs ONNX inference in a background thread.
 */

import { pipeline, env } from '@huggingface/transformers';
import type { TranslationPipeline } from '@huggingface/transformers';

// Disable local model check (always fetch from HuggingFace Hub)
env.allowLocalModels = false;
// Use WASM backend (no WebGPU in workers yet in most browsers)
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

interface InitMessage {
  type: 'init';
  modelId: string; // e.g. 'Xenova/opus-mt-ja-en'
}

interface TranslateMessage {
  type: 'translate';
  id: string;
  text: string;
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
    self.postMessage({ type: 'status', status: 'loading', modelId: msg.modelId });

    // Create the translation pipeline
    // @huggingface/transformers handles:
    // - Model download from HuggingFace Hub
    // - ONNX session creation with onnxruntime-web WASM backend
    // - Tokenizer loading (SentencePiece)
    // - Caching in browser Cache API
    translator = await (pipeline as any)('translation', msg.modelId, {
      dtype: 'q8',  // Use quantized model for smaller size
      device: 'wasm',
      progress_callback: (progress: any) => {
        if (progress.status === 'progress') {
          self.postMessage({
            type: 'progress',
            modelId: msg.modelId,
            file: progress.file,
            loaded: progress.loaded,
            total: progress.total,
            progress: progress.progress,
          });
        }
      },
    }) as TranslationPipeline;

    currentModelId = msg.modelId;
    const elapsed = Math.round(performance.now() - startTime);
    self.postMessage({ type: 'ready', modelId: msg.modelId, loadTimeMs: elapsed });
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
