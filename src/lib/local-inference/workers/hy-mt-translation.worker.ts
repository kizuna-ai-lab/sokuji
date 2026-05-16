/**
 * HY-MT1.5-1.8B Translation Worker — Tencent Hunyuan MT 1.5 via WebGPU.
 *
 * Production worker for multilingual translation using a translation-specialized
 * decoder-only LLM (hunyuan_v1_dense architecture). Model files are pre-downloaded
 * into IndexedDB and served via a blob URL cache (same pattern as the qwen and
 * translategemma translation workers).
 *
 * Prompt format follows the onnx-community model card exactly: user-only message,
 * no system prompt, greedy decoding. The shared prompts.ts machinery is intentionally
 * bypassed because HY-MT is purpose-built for translation and does not need the
 * filler/native-name reinforcement designed for general-purpose LLMs.
 */

import { pipeline, env } from '@huggingface/transformers';

// Disable WASM proxy (we're already in a worker).
// wasmPaths is set in the init handler from the main thread's resolved URL.
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
}

// ─── BCP-47 → English language names for the prompt template ────────────────
// Mirrors manifest.languages one-for-one (36 entries).

const LANG_NAMES: Record<string, string> = {
  zh: 'Chinese',    en: 'English',    fr: 'French',     pt: 'Portuguese',
  es: 'Spanish',    ja: 'Japanese',   tr: 'Turkish',    ru: 'Russian',
  ar: 'Arabic',     ko: 'Korean',     th: 'Thai',       it: 'Italian',
  de: 'German',     vi: 'Vietnamese', ms: 'Malay',      id: 'Indonesian',
  tl: 'Filipino',   hi: 'Hindi',      pl: 'Polish',     cs: 'Czech',
  nl: 'Dutch',      km: 'Khmer',      my: 'Burmese',    fa: 'Persian',
  gu: 'Gujarati',   ur: 'Urdu',       te: 'Telugu',     mr: 'Marathi',
  he: 'Hebrew',     bn: 'Bengali',    ta: 'Tamil',      uk: 'Ukrainian',
  bo: 'Tibetan',    kk: 'Kazakh',     mn: 'Mongolian',  ug: 'Uyghur',
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
  systemPrompt: string;    // Ignored — HY-MT uses model-card user-only template.
  wrapTranscript: boolean; // Ignored — model card sends raw segment, no <transcript> tags.
}

interface DisposeMessage {
  type: 'dispose';
}

type WorkerMessage = InitMessage | TranslateMessage | DisposeMessage;

let generator: any = null;

// ─── Blob URL cache (same pattern as qwen-translation.worker.ts) ───────────

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

    if (msg.ortWasmBaseUrl && env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = msg.ortWasmBaseUrl;
    }

    const gpu = (self as any).navigator?.gpu;
    if (!gpu) {
      self.postMessage({ type: 'error', error: 'WebGPU not available. HY-MT translation requires WebGPU.' });
      return;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      self.postMessage({ type: 'error', error: 'No WebGPU adapter found. HY-MT translation requires WebGPU.' });
      return;
    }

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
    self.postMessage({ type: 'error', id: msg.id, error: 'HY-MT model not loaded' });
    return;
  }

  try {
    const startTime = performance.now();

    const targetName = LANG_NAMES[msg.targetLang] ?? msg.targetLang;
    const userPrompt =
      `Translate the following segment into ${targetName}, without additional explanation.\n\n${msg.text}`;

    const result = await generator(
      [{ role: 'user', content: userPrompt }],
      { max_new_tokens: 512, do_sample: false },
    );

    let translatedText = '';
    if (Array.isArray(result) && result.length > 0) {
      const output = result[0] as any;
      if (output?.generated_text) {
        if (Array.isArray(output.generated_text)) {
          const lastMsg = output.generated_text[output.generated_text.length - 1];
          translatedText = lastMsg?.content || '';
        } else {
          translatedText = output.generated_text;
        }
      }
    }
    translatedText = translatedText.trim();

    self.postMessage({
      type: 'result',
      id: msg.id,
      sourceText: msg.text,
      translatedText,
      inferenceTimeMs: Math.round(performance.now() - startTime),
      systemPrompt: userPrompt,
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
