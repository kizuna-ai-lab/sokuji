/**
 * TranslateGemma Translation Worker — TranslateGemma 4B via WebGPU
 *
 * Production worker for multilingual translation using Google's purpose-built
 * translation model. Model files are pre-downloaded into IndexedDB and served
 * via blob URL cache (same pattern as the Qwen translation worker).
 *
 * TranslateGemma uses a structured content format with source/target language
 * codes rather than system prompts. The chat template internally constructs
 * the translation prompt.
 */

import { pipeline, env } from './_shared/transformers-all';
import { initTransformersEnv } from './_shared/transformers-env';

// ─── Message types ─────────────────────────────────────────────────────────

interface InitMessage {
  type: 'init';
  hfModelId: string;
  fileUrls: Record<string, string>;
  sourceLang: string;
  targetLang: string;
  dtype?: string;
  ortWasmBaseUrl?: string;
}

interface TranslateMessage {
  type: 'translate';
  id: string;
  text: string;
  sourceLang: string;
  targetLang: string;
}

interface DisposeMessage {
  type: 'dispose';
}

type WorkerMessage = InitMessage | TranslateMessage | DisposeMessage;

let generator: any = null;

// ─── Init handler ──────────────────────────────────────────────────────────

async function handleInit(msg: InitMessage) {
  try {
    const startTime = performance.now();
    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId });

    // WebGPU check
    const gpu = (self as any).navigator?.gpu;
    if (!gpu) {
      self.postMessage({ type: 'error', error: 'WebGPU not available. TranslateGemma requires WebGPU.' });
      return;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      self.postMessage({ type: 'error', error: 'No WebGPU adapter found. TranslateGemma requires WebGPU.' });
      return;
    }

    // Configure Transformers.js to use blob URL cache
    initTransformersEnv(env, msg);

    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId, device: 'webgpu' });

    generator = await (pipeline as any)('text-generation', msg.hfModelId, {
      dtype: msg.dtype || 'q4',
      device: 'webgpu',
    });

    const elapsed = Math.round(performance.now() - startTime);
    self.postMessage({ type: 'ready', modelId: msg.hfModelId, loadTimeMs: elapsed, device: 'webgpu' });
  } catch (error: any) {
    self.postMessage({ type: 'error', error: error.message || String(error) });
  }
}

// ─── Translate handler ─────────────────────────────────────────────────────

async function handleTranslate(msg: TranslateMessage) {
  if (!generator) {
    self.postMessage({ type: 'error', id: msg.id, error: 'TranslateGemma model not loaded' });
    return;
  }

  try {
    const startTime = performance.now();

    // TranslateGemma uses structured content with language codes
    // (not system prompts like Qwen). The chat template internally
    // constructs: "You are a professional X to Y translator..."
    const messages = [{
      role: 'user',
      content: [{
        type: 'text',
        source_lang_code: msg.sourceLang,
        target_lang_code: msg.targetLang,
        text: msg.text,
      }],
    }];

    const output = await generator(messages, {
      max_new_tokens: 1024,  // TODO: tune for real-time translation latency
    });

    const elapsed = Math.round(performance.now() - startTime);

    // Extract generated text from chat output
    let translatedText = '';
    if (Array.isArray(output) && output.length > 0) {
      const result = output[0] as any;
      if (result.generated_text) {
        if (Array.isArray(result.generated_text)) {
          const lastMsg = result.generated_text[result.generated_text.length - 1];
          translatedText = lastMsg?.content || '';
        } else {
          translatedText = result.generated_text;
        }
      }
    }

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

// ─── Dispose handler ───────────────────────────────────────────────────────

async function handleDispose() {
  if (generator) {
    try {
      await generator?.dispose?.();
    } catch {
      // Ignore cleanup errors per spec
    } finally {
      generator = null;
    }
  }
  self.postMessage({ type: 'disposed' });
}

// ─── Message router ────────────────────────────────────────────────────────

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
