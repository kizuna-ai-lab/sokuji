/**
 * Qwen3.5 Translation Worker — Qwen3.5-0.8B-ONNX via WebGPU
 *
 * Uses from_pretrained API with Qwen3_5ForConditionalGeneration + AutoProcessor
 * (VLM architecture, but used text-only for translation).
 * Model files are pre-downloaded into IndexedDB and served via blob URL cache.
 */

import {
  AutoProcessor,
  DynamicCache,
  Qwen3_5ForConditionalGeneration,
  Tensor,
  TextStreamer,
  env,
} from './_shared/transformers-all';
import { initTransformersEnv } from './_shared/transformers-env';
import { buildDefaultLocalPrompt } from '../prompts';
import { acquireWebGpuAdapter, bindCheckedWebGpuAdapter } from './shaderF16Gate';

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

// ─── Init handler ──────────────────────────────────────────────────────────

async function handleInit(msg: InitMessage) {
  try {
    const startTime = performance.now();
    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId });

    // WebGPU check
    const gpu = (self as any).navigator?.gpu;
    if (!gpu) {
      self.postMessage({ type: 'error', error: 'WebGPU not available. Qwen3.5 translation requires WebGPU.' });
      return;
    }
    // One acquisition, remembered on the runtime env: the gate below reuses
    // this adapter rather than asking for a second one that could differ.
    const adapter = await acquireWebGpuAdapter(env.backends.onnx);
    if (!adapter) {
      self.postMessage({ type: 'error', error: 'No WebGPU adapter found. Qwen3.5 translation requires WebGPU.' });
      return;
    }

    // Configure Transformers.js to use blob URL cache
    initTransformersEnv(env, msg);

    self.postMessage({ type: 'status', status: 'loading', modelId: msg.hfModelId, device: 'webgpu' });

    // Load processor and model (VLM architecture)
    processor = await AutoProcessor.from_pretrained(msg.hfModelId);

    const dtype = msg.dtype || {
      embed_tokens: 'q4' as const,
      vision_encoder: 'q4' as const,
      decoder_model_merged: 'q4' as const,
    };

    await bindCheckedWebGpuAdapter(env.backends.onnx, dtype, 'Qwen3.5 translation');

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

// ─── Chunked prefill — Qwen3.5 only (#306) ─────────────────────────────────

/**
 * Feed the prompt one token at a time instead of in a single batched pass.
 *
 * Qwen3.5's ONNX export unrolls its recurrent layers along the sequence
 * dimension, so one forward over M prompt tokens costs roughly 380ms + 136ms*M
 * on a GB10 while a forward over a single token costs 47ms. Both shipped sizes
 * spend the same ~16s on a 110-token prompt (0.8B 16,031ms vs 2B 16,228ms, at
 * 2.5x the parameters) — a cost flat in FLOPs but linear in sequence length is
 * per-position scheduling, not compute. Decode is unaffected and healthy at
 * ~29 tok/s, which is why the symptom reads as "slow model" rather than "slow
 * prompt".
 *
 * Measured end to end on a 110-token prompt: 16.7s -> 3.6s on a GB10, 16.2s ->
 * 3.6s on an RTX 4070 SUPER, 2.8s -> 2.0s on an M4. Every chunk size was
 * verified to select the same next token before this landed.
 *
 * Do not copy this into another worker. Every other model in the roster has a
 * healthy batched path and pays only the per-dispatch floor, so the same loop
 * makes Qwen3-0.6B 3.4x, Qwen2.5-0.5B 4.8x and HunyuanMT-1.8B 12.6x SLOWER.
 * Chunk sizes between 2 and 32 lose even here — only a single token per pass
 * escapes the bad path. `qwen35ChunkedPrefill.consistency.test.ts` pins that.
 */
async function prefillOneTokenAtATime(inputIds: any): Promise<any> {
  // generate() needs at least one unprocessed token left to take its first
  // step, and below a couple of tokens there is nothing to win.
  const upTo = inputIds.dims[1] - 1;
  if (upTo < 2) return null;

  const ids = inputIds.data as BigInt64Array;
  const mask: bigint[] = [];
  let cache: any = null;

  try {
    for (let at = 0; at < upTo; at++) {
      mask.push(1n);
      const outputs = await model.forward({
        input_ids: new Tensor('int64', [ids[at]], [1, 1]),
        attention_mask: new Tensor('int64', [...mask], [1, mask.length]),
        // Transformers.js derives position_ids from the full attention mask,
        // which is the wrong length once the cache already covers part of it.
        // Qwen3.5 takes 3D mrope positions; text-only means all three rows are
        // the same 0-indexed run (its `_get_text_only_rope_index`).
        position_ids: new Tensor('int64', [BigInt(at), BigInt(at), BigInt(at)], [3, 1, 1]),
        past_key_values: cache,
      });

      // `getPastKeyValues` is not exported, so rename the `present*` outputs
      // the way it does. Qwen3.5's cache is hybrid: conv and recurrent state
      // sit beside the attention KV, and missing either name makes the next
      // run fail with "Missing the following inputs: past_conv.0, ...".
      const entries: Record<string, any> = {};
      for (const name of Object.keys(outputs)) {
        if (!name.startsWith('present')) continue;
        entries[name
          .replace('present_ssm', 'past_ssm')
          .replace('present_conv', 'past_conv')
          .replace('present_recurrent', 'past_recurrent')
          .replace('present', 'past_key_values')] = outputs[name];
      }
      // update() disposes the GPU buffers it replaces; a plain object here
      // would leak one cache per token.
      if (cache) cache.update(entries);
      else cache = new DynamicCache(entries);
    }

    const covered = cache.get_seq_length();
    if (covered !== upTo) {
      throw new Error(`chunked prefill covered ${covered} of ${upTo} tokens`);
    }
    return cache;
  } catch {
    // A transformers.js change that breaks any of the shapes above must not
    // break translation, only slow it: fall back to the single batched pass
    // this worker used before #306. `inferenceTimeMs` returning to ~16s is the
    // signal that this happened.
    await cache?.dispose().catch(() => {});
    return null;
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

    // generate() is handed the full input_ids alongside the cache; it computes
    // positions over the whole prompt and then slices off the tokens the cache
    // already covers, so only the final token is processed here.
    const prefilled = await prefillOneTokenAtATime(inputs.input_ids);
    try {
      await model.generate({
        ...inputs,
        ...(prefilled ? { past_key_values: prefilled } : {}),
        max_new_tokens: 256,
        do_sample: false,
        streamer,
      });
    } finally {
      // A caller-supplied cache is deliberately kept alive by generate(), so
      // releasing it is ours to do — once per utterance, not once per session.
      await prefilled?.dispose();
    }

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
