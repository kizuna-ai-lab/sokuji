/**
 * Qwen Translation Worker — Qwen2.5-0.5B-Instruct via WebGPU
 *
 * Production worker for multilingual translation using a decoder-only LLM.
 * Model files are pre-downloaded into IndexedDB and served via blob URL cache
 * (same pattern as the Opus-MT translation worker).
 */

import { pipeline, env } from './_shared/transformers-all';
import { initTransformersEnv } from './_shared/transformers-env';
import { buildDefaultLocalPrompt } from '../prompts';

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
  systemPrompt: string;
  wrapTranscript: boolean;
}

interface DisposeMessage {
  type: 'dispose';
}

type WorkerMessage = InitMessage | TranslateMessage | DisposeMessage;

let generator: any = null;
let currentModelId: string = '';

// ─── Init handler ──────────────────────────────────────────────────────────

async function handleInit(msg: InitMessage) {
  try {
    const startTime = performance.now();
    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId });

    // WebGPU check
    const gpu = (self as any).navigator?.gpu;
    if (!gpu) {
      self.postMessage({ type: 'error', error: 'WebGPU not available. Qwen translation requires WebGPU.' });
      return;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      self.postMessage({ type: 'error', error: 'No WebGPU adapter found. Qwen translation requires WebGPU.' });
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
    currentModelId = msg.hfModelId;
    self.postMessage({ type: 'ready', modelId: msg.hfModelId, loadTimeMs: elapsed, device: 'webgpu' });
  } catch (error: any) {
    self.postMessage({ type: 'error', error: error.message || String(error) });
  }
}

// ─── Translate handler ─────────────────────────────────────────────────────

async function handleTranslate(msg: TranslateMessage) {
  if (!generator) {
    self.postMessage({ type: 'error', id: msg.id, error: 'Qwen model not loaded' });
    return;
  }

  try {
    const startTime = performance.now();

    // /no_think is Qwen3-specific; Qwen2.5 doesn't understand it
    const isQwen3 = currentModelId.toLowerCase().includes('qwen3');
    const resolvedPrompt = msg.systemPrompt && msg.systemPrompt.trim()
      ? msg.systemPrompt
      : buildDefaultLocalPrompt(msg.sourceLang, msg.targetLang);
    const systemPrompt = isQwen3 ? `${resolvedPrompt} /no_think` : resolvedPrompt;

    const userContent = msg.wrapTranscript
      ? `<transcript>${msg.text}</transcript>`
      : msg.text;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    const result = await generator(messages, {
      max_new_tokens: 256,
      do_sample: false,
      temperature: 0.0,
      tokenizer_encode_kwargs: { enable_thinking: false },
    });

    const elapsed = Math.round(performance.now() - startTime);

    let translatedText = '';
    if (Array.isArray(result) && result.length > 0) {
      const output = result[0] as any;
      if (output.generated_text) {
        if (Array.isArray(output.generated_text)) {
          const lastMsg = output.generated_text[output.generated_text.length - 1];
          translatedText = lastMsg?.content || '';
        } else {
          translatedText = output.generated_text;
        }
      }
    }

    translatedText = translatedText.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

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
  if (generator) {
    await generator?.dispose?.();
    generator = null;
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
