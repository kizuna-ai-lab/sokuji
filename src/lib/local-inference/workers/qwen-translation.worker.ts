/**
 * Qwen Translation Worker — Qwen2.5-0.5B-Instruct via WebGPU
 *
 * Production worker for multilingual translation using a decoder-only LLM.
 * Model files are pre-downloaded into IndexedDB and served via blob URL cache
 * (same pattern as the Opus-MT translation worker).
 */

import { pipeline, env } from '@huggingface/transformers';

// Disable WASM proxy (we're already in a worker).
// wasmPaths is set in the init handler from the main thread's resolved URL.
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

// ─── Language name map for prompts ─────────────────────────────────────────

const LANG_NAMES: Record<string, string> = {
  ja: 'Japanese', zh: 'Chinese', en: 'English', ko: 'Korean',
  de: 'German', fr: 'French', es: 'Spanish', ru: 'Russian',
  ar: 'Arabic', pt: 'Portuguese', th: 'Thai', vi: 'Vietnamese',
  id: 'Indonesian', tr: 'Turkish', nl: 'Dutch', pl: 'Polish',
  it: 'Italian', hi: 'Hindi', sv: 'Swedish', da: 'Danish',
  fi: 'Finnish', hu: 'Hungarian', ro: 'Romanian', no: 'Norwegian',
  uk: 'Ukrainian', cs: 'Czech', et: 'Estonian', af: 'Afrikaans',
};

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

// ─── Blob URL cache (same pattern as translation.worker.ts) ────────────────

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
      self.postMessage({ type: 'error', error: 'WebGPU not available. Qwen translation requires WebGPU.' });
      return;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      self.postMessage({ type: 'error', error: 'No WebGPU adapter found. Qwen translation requires WebGPU.' });
      return;
    }

    // Configure Transformers.js to use blob URL cache
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = createBlobUrlCache(msg.fileUrls);

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
    self.postMessage({ type: 'error', id: msg.id, error: 'Qwen model not loaded' });
    return;
  }

  try {
    const startTime = performance.now();

    const srcName = LANG_NAMES[msg.sourceLang] || msg.sourceLang;
    const tgtName = LANG_NAMES[msg.targetLang] || msg.targetLang;

    const systemPrompt =
      `Translate ${srcName} → ${tgtName}. Input is ASR speech. /no_think\n` +
      `Drop fillers (um, uh, えーと, あのー, 那个). Fix stuttering and repetitions.\n` +
      `Output ONLY the ${tgtName} translation. Nothing else.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: msg.text },
    ];

    const result = await generator(messages, {
      max_new_tokens: 256,
      do_sample: false,
      temperature: 0.0,
      tokenizer_encode_kwargs: { enable_thinking: false },
    });

    const elapsed = Math.round(performance.now() - startTime);

    // Extract generated text from chat output
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

    // Strip <think> blocks: closed ones, and unclosed trailing ones (hit max_new_tokens)
    translatedText = translatedText.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim();

    // Same output format as Opus-MT worker
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
