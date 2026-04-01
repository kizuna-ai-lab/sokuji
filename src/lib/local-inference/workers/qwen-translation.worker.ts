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

// Native language names to reinforce target language for small models
const NATIVE_NAMES: Record<string, string> = {
  ja: '日本語', zh: '中文', en: 'English', ko: '한국어',
  de: 'Deutsch', fr: 'Français', es: 'Español', ru: 'Русский',
  ar: 'العربية', pt: 'Português', th: 'ไทย', vi: 'Tiếng Việt',
};

// Language-specific filler words (only included when language is source or target
// to avoid confusing small models with unrelated scripts)
const LANG_FILLERS: Record<string, string[]> = {
  en: ['um', 'uh', 'well', 'like'],
  ja: ['えーと', 'あのー', 'まあ'],
  zh: ['那个', '嗯', '就是'],
  ko: ['음', '그', '저기'],
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
let currentModelId: string = '';

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

    const srcName = LANG_NAMES[msg.sourceLang] || msg.sourceLang;
    const tgtName = LANG_NAMES[msg.targetLang] || msg.targetLang;

    // /no_think is Qwen3-specific; Qwen2.5 doesn't understand it and it corrupts language instructions
    const isQwen3 = currentModelId.toLowerCase().includes('qwen3');
    const noThink = isQwen3 ? ' /no_think' : '';

    // Build filler list from only source/target languages to avoid confusing small models
    // (e.g. Japanese fillers in prompt can steer Qwen2.5-0.5B toward Japanese output)
    const langs = new Set([msg.sourceLang, msg.targetLang]);
    const fillers = Array.from(langs).flatMap(l => LANG_FILLERS[l] || []);
    if (!fillers.length) fillers.push('um', 'uh');
    const fillerList = fillers.join(', ');

    // Use native name (e.g. "中文 (Chinese)") to reinforce target language
    const nativeTgt = NATIVE_NAMES[msg.targetLang];
    const tgtLabel = nativeTgt ? `${nativeTgt} (${tgtName})` : tgtName;

    const systemPrompt =
      `You are a translator. Translate the speech transcript inside <transcript> tags from ${srcName} to ${tgtLabel}.${noThink}\n` +
      `Drop fillers (${fillerList}). Fix stuttering and repetitions.\n` +
      `Output ONLY the ${tgtLabel} translation. No explanation, no refusal.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `<transcript>${msg.text}</transcript>` },
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
