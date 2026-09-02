// Spike harness: Qwen3-ASR-0.6B ONNX on onnxruntime-web, layout v1 (andrewleech) or v2 (ours).
// URL params:
//   ep=webgpu|wasm         execution provider (default webgpu)
//   model=<dir under ./models/>   or   base=<absolute URL prefix, e.g. https://huggingface.co/<repo>/resolve/main/>
//   variant=q4|q4f16       v2 only; default q4f16 when the adapter has shader-f16, else q4
//   force=<iso>            v2 only; teacher-force "language <Name><asr_text>" from prompt_config.json
//   enc= init= step= data= initData= stepData= embed= embedDtype=   explicit file overrides (v1 needs them)
//   clips=a.wav,b.wav  maxTokens=256  repeat=1 (extra warm runs of the first clip)  threads=N (wasm)
// Results: window.__result and one "RESULT {...}" console line per clip.

import { logMel, parseWav } from './mel.js';
import { loadTokenizer } from './tokenizer.js';

const q = new URLSearchParams(location.search);
const EP = q.get('ep') || 'webgpu';
const MODEL = q.get('model') || 'qwen3-asr-0.6b';
const BASE = q.get('base') || `./models/${MODEL}/`;
const CLIPS = (q.get('clips') || 'jfk.wav').split(',').filter(Boolean);
const MAX_TOKENS = parseInt(q.get('maxTokens') || '256', 10);
const REPEAT = parseInt(q.get('repeat') || '1', 10);
const THREADS = q.get('threads');
const FORCE = q.get('force') || '';

const S = document.getElementById('S');
const M = document.getElementById('M');
const status = (t) => { S.textContent = t; console.log('STATUS ' + t); };
const emit = (obj) => { M.textContent += JSON.stringify(obj) + '\n'; console.log('RESULT ' + JSON.stringify(obj)); };
window.__result = { done: false, clips: [] };

// v1 prompt constants (src/prompt.py); v2 reads them from prompt_config.json
const V1 = { prefix: [151644, 9125, 198, 151645, 198, 151644, 882, 198, 151669], suffix: [151670, 151645, 198, 151644, 77091, 198], audioPad: 151676, asrText: 151704, eos: [151643, 151645] };
const convOut = (t) => Math.floor((t + 1) / 2);
function audioTokenCount(melFrames, convWindow = 100, perWindow = 13) {
  const leave = melFrames % convWindow;
  return convOut(convOut(convOut(leave))) + Math.floor(melFrames / convWindow) * perWindow;
}

const hasF16 = typeof Float16Array !== 'undefined';
function f32ToF16(src) {
  if (hasF16) return new Uint16Array(new Float16Array(src).buffer);
  const out = new Uint16Array(src.length);
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  for (let i = 0; i < src.length; i++) {
    f32[0] = src[i]; const x = u32[0];
    const sign = (x >>> 16) & 0x8000; const exp = ((x >>> 23) & 0xff) - 112; const mant = (x >>> 13) & 0x3ff;
    out[i] = exp <= 0 ? sign : exp >= 31 ? sign | 0x7c00 : sign | (exp << 10) | mant;
  }
  return out;
}
function f16ToF32(src) {
  if (hasF16) return new Float32Array(new Float16Array(src.buffer, src.byteOffset, src.length));
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const h = src[i]; const s = (h & 0x8000) ? -1 : 1; const e = (h >> 10) & 0x1f; const f = h & 0x3ff;
    out[i] = e === 0 ? s * Math.pow(2, -14) * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  return out;
}

async function fetchJsonOrNull(url) {
  try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; }
}

async function main() {
  const ort = await import('./ort/ort.webgpu.min.mjs');
  ort.env.wasm.wasmPaths = new URL('./ort/', location.href).href;
  const threads = THREADS ? parseInt(THREADS, 10) : (self.crossOriginIsolated ? Math.min(navigator.hardwareConcurrency || 4, 8) : 1);
  ort.env.wasm.numThreads = threads;
  let gpu = null;
  for (let attempt = 0; attempt < 6 && navigator.gpu && !gpu; attempt++) {
    gpu = await navigator.gpu.requestAdapter().catch(() => null);
    if (!gpu) await new Promise((r) => setTimeout(r, 1500));
  }
  const info = gpu ? (gpu.info || {}) : null;
  const f16Shader = gpu ? gpu.features.has('shader-f16') : false;
  emit({ env: { ep: EP, ua: navigator.userAgent, crossOriginIsolated: !!self.crossOriginIsolated, threads, hardwareConcurrency: navigator.hardwareConcurrency,
    webgpu: !!gpu, adapter: info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null,
    shaderF16: f16Shader, hasFloat16Array: hasF16, ortVersion: ort.env.versions?.web || null, base: BASE } });
  if (EP === 'webgpu' && !gpu) throw new Error('WebGPU adapter unavailable');

  const t0 = performance.now();
  const PC = await fetchJsonOrNull(BASE + 'prompt_config.json');
  const layout = PC ? 'v2' : 'v1';
  const variantKey = PC ? (q.get('variant') || (f16Shader ? 'q4f16' : 'q4')) : null;
  const V = PC ? PC.variants[variantKey] : null;
  if (PC && !V) throw new Error(`unknown variant ${variantKey}`);
  const ENC = q.get('enc') || (V ? V.encoder : 'encoder.onnx');
  const INIT = q.get('init') || (V ? V.decoder_init : 'decoder_init.onnx');
  const STEP = q.get('step') || (V ? V.decoder_step : 'decoder_step.onnx');
  const DATA = q.get('data') || (V ? V.weights : '');
  const INIT_DATA = q.get('initData') || '';
  const STEP_DATA = q.get('stepData') || '';
  const prompt = PC ? PC.prompt : { prefix_ids: V1.prefix, suffix_ids: V1.suffix, audio_pad_id: V1.audioPad, asr_text_id: V1.asrText, eos_ids: V1.eos };
  const EOS = new Set(prompt.eos_ids);
  const audioTok = PC ? PC.audio_tokens : { conv_window: 100, tokens_per_window: 13 };
  const forceIds = PC && FORCE ? (PC.language_prefix_ids[FORCE] || null) : null;

  const filters = await (await fetch(BASE + (PC ? PC.mel.filters_file : 'mel_filters.json'))).json().catch(async () => (await fetch('./mel_filters.json')).json());
  const tok = await loadTokenizer(BASE + 'tokenizer.json');
  const cfg = await (await fetch(BASE + 'config.json')).json();
  const hidden = PC ? PC.decoder.hidden_size : cfg.decoder.hidden_size;

  // embedding table
  const emb = PC ? PC.embedding : { file: q.get('embed') || 'embed_tokens.bin', dtype: (q.get('embedDtype') || 'fp32') === 'fp16' ? 'float16' : 'float32', shape: [cfg.decoder.vocab_size, hidden] };
  const embBuf = await (await fetch(BASE + emb.file)).arrayBuffer();
  const embI8 = emb.dtype === 'int8' ? new Int8Array(embBuf) : null;
  const embF16 = emb.dtype === 'float16' ? new Uint16Array(embBuf) : null;
  const embF32 = emb.dtype === 'float32' ? new Float32Array(embBuf) : null;
  const embScales = emb.dtype === 'int8' ? new Float32Array(await (await fetch(BASE + emb.scales_file)).arrayBuffer()) : null;
  const vocab = (embI8 || embF16 || embF32).length / hidden;
  const tEmb = performance.now();
  function embedRowF32(id, out, off) {
    const o = id * hidden;
    if (embI8) { const s = embScales[id]; for (let i = 0; i < hidden; i++) out[off + i] = embI8[o + i] * s; }
    else if (embF16) out.set(f16ToF32(embF16.subarray(o, o + hidden)), off);
    else out.set(embF32.subarray(o, o + hidden), off);
  }

  // sessions; a shared external-data file is fetched once and handed to both decoders
  const ext = {};
  async function extOpt(name) {
    if (!name) return undefined;
    if (!ext[name]) ext[name] = new Uint8Array(await (await fetch(BASE + name)).arrayBuffer());
    return [{ path: name, data: ext[name] }];
  }
  const so = (extra) => ({ executionProviders: [EP], graphOptimizationLevel: 'all', ...extra });
  const kvOnGpu = EP === 'webgpu' ? { present_keys: 'gpu-buffer', present_values: 'gpu-buffer' } : undefined;
  status('loading encoder');
  const tE0 = performance.now();
  const encSess = await ort.InferenceSession.create(BASE + ENC, so({}));
  const tE1 = performance.now();
  status('loading decoder_init');
  const initSess = await ort.InferenceSession.create(BASE + INIT, so({ externalData: await extOpt(DATA || INIT_DATA), preferredOutputLocation: kvOnGpu }));
  const tI1 = performance.now();
  status('loading decoder_step');
  const stepSess = await ort.InferenceSession.create(BASE + STEP, so({ externalData: await extOpt(DATA || STEP_DATA), preferredOutputLocation: kvOnGpu }));
  const tS1 = performance.now();
  const meta = (s) => Object.fromEntries((s.inputNames || []).map((n, i) => [n, s.inputMetadata?.[i]?.type || '?']));
  const encIn = meta(encSess), initIn = meta(initSess), stepIn = meta(stepSess);
  emit({ layout, variant: variantKey, files: { ENC, INIT, STEP, DATA: DATA || `${INIT_DATA}+${STEP_DATA}`, embed: emb.file, embedDtype: emb.dtype }, force: FORCE || null,
    load: { tokenizerAndEmbedMs: Math.round(tEmb - t0), encoderMs: Math.round(tE1 - tE0), initMs: Math.round(tI1 - tE1), stepMs: Math.round(tS1 - tI1), totalMs: Math.round(tS1 - t0) },
    io: { enc: encIn, init: initIn, step: stepIn }, embed: { dtype: emb.dtype, vocab, hidden } });
  const encMelType = encIn.mel || 'float32';
  const initEmbType = initIn.input_embeds || initIn.audio_features || 'float32';
  const stepEmbType = stepIn.input_embeds || 'float32';
  const v2Init = 'input_embeds' in initIn;
  const mk = (type, data, dims) => new ort.Tensor(type, data, dims);
  const asF32 = (t) => (t.type === 'float16' ? f16ToF32(t.data) : t.data);
  const argmax = (a) => { let bi = 0, bv = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > bv) { bv = a[i]; bi = i; } return bi; };
  const rowTyped = (id, type) => { const f = new Float32Array(hidden); embedRowF32(id, f, 0); return type === 'float16' ? f32ToF16(f) : f; };

  async function transcribe(clip, label) {
    const r = { clip: label, layout, variant: variantKey, forced: !!forceIds };
    const wav = parseWav(await (await fetch('./clips/' + clip)).arrayBuffer());
    r.audioSec = +(wav.length / 16000).toFixed(2);
    let t = performance.now();
    const mel = logMel(wav, filters);
    r.melMs = Math.round(performance.now() - t);
    r.melFrames = mel.T;
    t = performance.now();
    const encOut = await encSess.run({ mel: mk(encMelType, encMelType === 'float16' ? f32ToF16(mel.data) : mel.data, [1, mel.nMels, mel.T]) });
    const af = encOut.audio_features;
    r.encoderMs = Math.round(performance.now() - t);
    const nAudio = af.dims[1];
    r.audioTokens = nAudio;
    const expected = audioTokenCount(mel.T, audioTok.conv_window, audioTok.tokens_per_window);
    if (expected !== nAudio) r.audioTokenMismatch = { expected, got: nAudio };
    const ids = [...prompt.prefix_ids]; const audioStart = ids.length;
    for (let i = 0; i < nAudio; i++) ids.push(prompt.audio_pad_id);
    ids.push(...prompt.suffix_ids);
    if (forceIds) ids.push(...forceIds);
    const afF32 = asF32(af);
    let feeds;
    t = performance.now();
    if (v2Init) {
      const x = new Float32Array(ids.length * hidden);
      for (let i = 0; i < ids.length; i++) embedRowF32(ids[i], x, i * hidden);
      x.set(afF32, audioStart * hidden);
      r.promptBuildMs = Math.round(performance.now() - t);
      feeds = { input_embeds: mk(initEmbType, initEmbType === 'float16' ? f32ToF16(x) : x, [1, ids.length, hidden]),
                position_ids: mk('int64', BigInt64Array.from({ length: ids.length }, (_, i) => BigInt(i)), [1, ids.length]) };
    } else {
      feeds = { input_ids: mk('int64', BigInt64Array.from(ids, (v) => BigInt(v)), [1, ids.length]),
                position_ids: mk('int64', BigInt64Array.from({ length: ids.length }, (_, i) => BigInt(i)), [1, ids.length]),
                audio_features: mk(initEmbType, initEmbType === 'float16' ? f32ToF16(afF32) : afF32, af.dims),
                audio_offset: mk('int64', BigInt64Array.from([BigInt(audioStart)]), [1]) };
    }
    t = performance.now();
    let out = await initSess.run(feeds);
    let logits = asF32(out.logits);
    const vocabN = out.logits.dims[out.logits.dims.length - 1];
    let next = argmax(logits.subarray(logits.length - vocabN));
    r.prefillMs = Math.round(performance.now() - t);
    r.promptTokens = ids.length;
    let pk = out.present_keys, pv = out.present_values;
    const gen = [next]; let pos = ids.length; let steps = 0;
    const tD = performance.now();
    while (!EOS.has(next) && gen.length < MAX_TOKENS) {
      const so2 = await stepSess.run({ input_embeds: mk(stepEmbType, rowTyped(next, stepEmbType), [1, 1, hidden]),
        position_ids: mk('int64', BigInt64Array.from([BigInt(pos)]), [1, 1]), past_keys: pk, past_values: pv });
      pk.dispose?.(); pv.dispose?.();
      pk = so2.present_keys; pv = so2.present_values;
      logits = asF32(so2.logits);
      next = argmax(logits.subarray(logits.length - vocabN));
      gen.push(next); pos++; steps++;
    }
    pk.dispose?.(); pv.dispose?.();
    r.decodeMs = Math.round(performance.now() - tD);
    r.genTokens = gen.length;
    r.msPerToken = steps ? +(r.decodeMs / steps).toFixed(1) : null;
    r.totalMs = r.melMs + r.encoderMs + (r.promptBuildMs || 0) + r.prefillMs + r.decodeMs;
    r.rtf = +(r.totalMs / 1000 / r.audioSec).toFixed(3);
    const cut = gen.indexOf(prompt.asr_text_id);
    r.prefix = forceIds ? `forced:${FORCE}` : (cut >= 0 ? tok.decode(gen.slice(0, cut)) : null);
    r.text = tok.decode(cut >= 0 ? gen.slice(cut + 1) : gen);
    r.hitEos = EOS.has(next);
    return r;
  }

  const manifest = await fetchJsonOrNull('./clips/manifest.json') || {};
  for (let i = 0; i < CLIPS.length; i++) {
    const clip = CLIPS[i];
    const runs = i === 0 ? REPEAT + 1 : 1;
    for (let k = 0; k < runs; k++) {
      status(`transcribing ${clip} (${k + 1}/${runs})`);
      try {
        const r = await transcribe(clip, k === 0 && runs > 1 ? `${clip} [cold]` : clip);
        r.ref = manifest[clip]?.text || null;
        r.lang = manifest[clip]?.lang || null;
        emit(r);
        window.__result.clips.push(r);
      } catch (e) {
        emit({ clip, error: String(e && e.stack || e) });
        window.__result.clips.push({ clip, error: String(e) });
      }
    }
  }
  window.__result.done = true;
  status('done');
}

main().catch((e) => { emit({ fatal: String(e && e.stack || e) }); window.__result.fatal = String(e); window.__result.done = true; status('fatal: ' + e); });
