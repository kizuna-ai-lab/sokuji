/**
 * Qwen3.5 Translation Worker — Qwen3.5-0.8B-ONNX via WebGPU
 *
 * Uses from_pretrained API with Qwen3_5ForConditionalGeneration + AutoProcessor
 * (VLM architecture, but used text-only for translation).
 * Model files are pre-downloaded into IndexedDB and served via blob URL cache.
 */

import {
  AutoProcessor,
  Qwen3_5ForConditionalGeneration,
  TextStreamer,
  env,
} from '@huggingface/transformers';
import { buildDefaultLocalPrompt } from '../prompts';

// Disable WASM proxy (we're already in a worker).
// wasmPaths is set in the init handler from the main thread's resolved URL.
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

// ─── Message types ─────────────────────────────────────────────────────────

interface InitMessage {
  type: 'init';
  hfModelId: string;
  fileUrls: Record<string, string>;
  sourceLang: string;
  targetLang: string;
  dtype?: Record<string, string>;
  ortWasmBaseUrl?: string;
}

interface TranslateMessage {
  type: 'translate';
  id: string;
  text: string;
  sourceLang: string;
  targetLang: string;
  systemPrompt: string;
  wrapTranscript: boolean;
}

interface DisposeMessage {
  type: 'dispose';
}

type WorkerMessage = InitMessage | TranslateMessage | DisposeMessage;

let model: any = null;
let processor: any = null;

// ─── Blob URL cache (same pattern as other workers) ──────────────────────

function createBlobUrlCache(fileUrls: Record<string, string>) {
  return {
    async match(request: string | Request | undefined): Promise<Response | undefined> {
      if (!request) return undefined;
      const url = typeof request === 'string' ? request : request.url;

      const resolveMainMarker = '/resolve/main/';
      const idx = url.indexOf(resolveMainMarker);
      if (idx === -1) return undefined;

      const filename = url.slice(idx + resolveMainMarker.length);
      const blobUrl = fileUrls[filename];
      if (!blobUrl) return undefined;

      return fetch(blobUrl);
    },
    async put(_request: string | Request, _response: Response): Promise<void> {},
  };
}

// ─── Init handler ──────────────────────────────────────────────────────────

async function handleInit(msg: InitMessage) {
  try {
    const startTime = performance.now();
    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId });

    // Set ORT WASM paths from main thread's resolved URL
    if (msg.ortWasmBaseUrl && env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
    }

    // WebGPU check
    const gpu = (self as any).navigator?.gpu;
    if (!gpu) {
      self.postMessage({ type: 'error', error: 'WebGPU not available. Qwen3.5 translation requires WebGPU.' });
      return;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      self.postMessage({ type: 'error', error: 'No WebGPU adapter found. Qwen3.5 translation requires WebGPU.' });
      return;
    }

    // Configure Transformers.js to use blob URL cache
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);

    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId, device: 'webgpu' });

    // Load processor and model (VLM architecture)
    processor = await AutoProcessor.from_pretrained(msg.hfModelId);

    const dtype = msg.dtype || {
      embed_tokens: 'q4' as const,
      vision_encoder: 'q4' as const,
      decoder_model_merged: 'q4' as const,
    };

    model = await Qwen3_5ForConditionalGeneration.from_pretrained(msg.hfModelId, {
      dtype: dtype as any,
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
  if (!model || !processor) {
    self.postMessage({ type: 'error', id: msg.id, error: 'Qwen3.5 model not loaded' });
    return;
  }

  try {
    const startTime = performance.now();

    const resolvedPrompt = msg.systemPrompt && msg.systemPrompt.trim()
      ? msg.systemPrompt
      : buildDefaultLocalPrompt(msg.sourceLang, msg.targetLang);
    // Qwen3.5 supports /no_think (it's a Qwen3 family model)
    const systemPrompt = `${resolvedPrompt} /no_think`;

    const userContent = msg.wrapTranscript
      ? `<transcript>${msg.text}</transcript>`
      : msg.text;

    // Text-only messages (no image content)
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    // Apply chat template with thinking disabled
    const text = processor.apply_chat_template(messages, {
      add_generation_prompt: true,
      tokenizer_kwargs: { enable_thinking: false },
    });

    // Process text-only input (no images)
    const inputs = await processor(text);

    // Collect generated tokens
    let translatedText = '';
    const streamer = new TextStreamer(processor.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (token: string) => {
        translatedText += token;
      },
    });

    await model.generate({
      ...inputs,
      max_new_tokens: 256,
      do_sample: false,
      streamer,
    });

    translatedText = translatedText.trim();

    // Strip <think> blocks: closed ones, and unclosed trailing ones (hit max_new_tokens)
    translatedText = translatedText.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

    const elapsed = Math.round(performance.now() - startTime);

    self.postMessage({
      type: 'result',
      id: msg.id,
      sourceText: msg.text,
      translatedText,
      inferenceTimeMs: elapsed,
      systemPrompt,
    });
  } catch (error: any) {
    self.postMessage({ type: 'error', id: msg.id, error: error.message || String(error) });
  }
}

// ─── Dispose handler ───────────────────────────────────────────────────────

async function handleDispose() {
  if (model) {
    await model?.dispose?.();
    model = null;
  }
  processor = null;
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
