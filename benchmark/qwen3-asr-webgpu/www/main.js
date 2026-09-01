// Spike harness: Qwen3-ASR-0.6B (andrewleech ONNX layout) on onnxruntime-web.
// URL params:
//   ep=webgpu|wasm         execution provider (default webgpu)
//   model=qwen3-asr-0.6b   directory under ./models/
//   enc=encoder.onnx  init=decoder_init.onnx  step=decoder_step.onnx
//   data=<shared external data file name or empty>   (e.g. decoder_weights.int4.data)
//   initData=/stepData=    per-decoder external data files (FP32 layout: decoder_init.onnx.data)
//   embed=embed_tokens.bin embedDtype=fp32|fp16
//   clips=jfk.wav,ja-cv0.wav   maxTokens=256   repeat=1 (extra warm runs of first clip)
// Results: window.__result (JSON) and a "RESULT {...}" console line per clip.

import { logMel, parseWav } from './mel.js';
import { loadTokenizer } from './tokenizer.js';

const q = new URLSearchParams(location.search);
const EP = q.get('ep') || 'webgpu';
const MODEL = q.get('model') || 'qwen3-asr-0.6b';
const ENC = q.get('enc') || 'encoder.onnx';
const INIT = q.get('init') || 'decoder_init.onnx';
const STEP = q.get('step') || 'decoder_step.onnx';
const DATA = q.get('data') || '';
const INIT_DATA = q.get('initData') || '';
const STEP_DATA = q.get('stepData') || '';
const EMBED = q.get('embed') || 'embed_tokens.bin';
const EMBED_DTYPE = q.get('embedDtype') || 'fp32';
const CLIPS = (q.get('clips') || 'jfk.wav').split(',').filter(Boolean);
const MAX_TOKENS = parseInt(q.get('maxTokens') || '256', 10);
const REPEAT = parseInt(q.get('repeat') || '1', 10);
const THREADS = q.get('threads');

const S = document.getElementById('S');
const M = document.getElementById('M');
const status = (t) => { S.textContent = t; console.log('STATUS ' + t); };
const emit = (obj) => { M.textContent += JSON.stringify(obj) + '\n'; console.log('RESULT ' + JSON.stringify(obj)); };
window.__result = { done: false, clips: [] };

// Prompt constants (src/prompt.py)
const IM_START = 151644, IM_END = 151645, ENDOFTEXT = 151643;
const AUDIO_START = 151669, AUDIO_END = 151670, AUDIO_PAD = 151676, ASR_TEXT = 151704;
const NL = 198;
const EOS = new Set([ENDOFTEXT, IM_END]);
const CONV_WINDOW = 100, TOKENS_PER_WINDOW = 13;
const convOut = (t) => Math.floor((t + 1) / 2);
function audioTokenCount(melFrames) {
  const leave = melFrames % CONV_WINDOW;
  let t = convOut(leave); t = convOut(t); t = convOut(t);
  return t + Math.floor(melFrames / CONV_WINDOW) * TOKENS_PER_WINDOW;
}
function buildPrompt(nAudio) {
  const ids = [IM_START, 9125, NL, IM_END, NL, IM_START, 882, NL, AUDIO_START];
  const audioStart = ids.length;
  for (let i = 0; i < nAudio; i++) ids.push(AUDIO_PAD);
  ids.push(AUDIO_END, IM_END, NL, IM_START, 77091, NL);
  return { ids, audioStart };
}

// float16 helpers (Float16Array where available)
const hasF16 = typeof Float16Array !== 'undefined';
function f32ToF16(src) {
  if (hasF16) return new Uint16Array(new Float16Array(src).buffer);
  const out = new Uint16Array(src.length);
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  for (let i = 0; i < src.length; i++) {
    f32[0] = src[i]; const x = u32[0];
    const sign = (x >>> 16) & 0x8000; let exp = ((x >>> 23) & 0xff) - 112; let mant = (x >>> 13) & 0x3ff;
    if (exp <= 0) { out[i] = sign; continue; }
    if (exp >= 31) { out[i] = sign | 0x7c00; continue; }
    out[i] = sign | (exp << 10) | mant;
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
  const adapterInfo = gpu ? (gpu.info || {}) : null;
  const f16Shader = gpu ? gpu.features.has('shader-f16') : false;
  const env = { ep: EP, ua: navigator.userAgent, crossOriginIsolated: !!self.crossOriginIsolated, threads, hardwareConcurrency: navigator.hardwareConcurrency,
    webgpu: !!gpu, adapter: adapterInfo ? { vendor: adapterInfo.vendor, architecture: adapterInfo.architecture, device: adapterInfo.device, description: adapterInfo.description } : null, shaderF16: f16Shader, hasFloat16Array: hasF16, ortVersion: ort.env.versions?.web || null };
  emit({ env });
  if (EP === 'webgpu' && !gpu) throw new Error('WebGPU adapter unavailable');

  const base = `./models/${MODEL}/`;
  const t0 = performance.now();
  const filters = await (await fetch('./mel_filters.json')).json();
  const tok = await loadTokenizer(base + 'tokenizer.json');
  const cfg = await (await fetch(base + 'config.json')).json();
  const hidden = cfg.decoder.hidden_size;

  // embeddings
  const embBuf = await (await fetch(base + EMBED)).arrayBuffer();
  const embed = EMBED_DTYPE === 'fp16' ? new Uint16Array(embBuf) : new Float32Array(embBuf);
  const vocab = embed.length / hidden;
  const tEmb = performance.now();

  // shared external data (fetched once, shared by both decoders)
  const ext = {};
  async function extOpt(name) {
    if (!name) return undefined;
    if (!ext[name]) { const buf = await (await fetch(base + name)).arrayBuffer(); ext[name] = new Uint8Array(buf); }
    return [{ path: name, data: ext[name] }];
  }
  const so = (extra) => ({ executionProviders: [EP], graphOptimizationLevel: 'all', ...extra });
  status('loading encoder');
  const tE0 = performance.now();
  const encSess = await ort.InferenceSession.create(base + ENC, so({}));
  const tE1 = performance.now();
  status('loading decoder_init');
  const initExt = await extOpt(DATA || INIT_DATA);
  const initSess = await ort.InferenceSession.create(base + INIT, so({ externalData: initExt, preferredOutputLocation: EP === 'webgpu' ? { present_keys: 'gpu-buffer', present_values: 'gpu-buffer' } : undefined }));
  const tI1 = performance.now();
  status('loading decoder_step');
  const stepExt = await extOpt(DATA || STEP_DATA);
  const stepSess = await ort.InferenceSession.create(base + STEP, so({ externalData: stepExt, preferredOutputLocation: EP === 'webgpu' ? { present_keys: 'gpu-buffer', present_values: 'gpu-buffer' } : undefined }));
  const tS1 = performance.now();
  const meta = (s) => Object.fromEntries((s.inputNames || []).map((n, i) => [n, s.inputMetadata?.[i]?.type || '?']));
  const encIn = meta(encSess), initIn = meta(initSess), stepIn = meta(stepSess);
  const encOutMeta = Object.fromEntries((encSess.outputNames || []).map((n, i) => [n, encSess.outputMetadata?.[i]?.type || '?']));
  emit({ load: { tokenizerAndEmbedMs: Math.round(tEmb - t0), encoderMs: Math.round(tE1 - tE0), initMs: Math.round(tI1 - tE1), stepMs: Math.round(tS1 - tI1), totalMs: Math.round(tS1 - t0) }, io: { enc: encIn, encOut: encOutMeta, init: initIn, step: stepIn }, embed: { dtype: EMBED_DTYPE, vocab, hidden } });
  const encMelType = encIn.mel || 'float32';
  const initAudioType = initIn.audio_features || 'float32';
  const stepEmbType = stepIn.input_embeds || 'float32';

  function embedRow(id, type) {
    const row = embed.subarray(id * hidden, (id + 1) * hidden);
    if (EMBED_DTYPE === 'fp16') return type === 'float16' ? new Uint16Array(row) : f16ToF32(row);
    return type === 'float16' ? f32ToF16(row) : new Float32Array(row);
  }
  const mk = (type, data, dims) => new ort.Tensor(type, data, dims);
  const argmax = (a) => { let bi = 0, bv = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > bv) { bv = a[i]; bi = i; } return bi; };

  async function transcribe(clip, label) {
    const r = { clip: label };
    const wav = parseWav(await (await fetch('./clips/' + clip)).arrayBuffer());
    r.audioSec = +(wav.length / 16000).toFixed(2);
    let t = performance.now();
    const mel = logMel(wav, filters);
    r.melMs = Math.round(performance.now() - t);
    r.melFrames = mel.T;
    // encoder
    t = performance.now();
    const melData = encMelType === 'float16' ? f32ToF16(mel.data) : mel.data;
    const encOut = await encSess.run({ mel: mk(encMelType, melData, [1, mel.nMels, mel.T]) });
    const af = encOut.audio_features;
    r.encoderMs = Math.round(performance.now() - t);
    const nAudio = af.dims[1];
    r.audioTokens = nAudio;
    const expected = audioTokenCount(mel.T);
    if (expected !== nAudio) r.audioTokenMismatch = { expected, got: nAudio };
    // prefill
    const { ids, audioStart } = buildPrompt(nAudio);
    let afData = af.data;
    if (af.type !== initAudioType) afData = initAudioType === 'float16' ? f32ToF16(af.data) : f16ToF32(af.data);
    const feeds = {
      input_ids: mk('int64', BigInt64Array.from(ids, (x) => BigInt(x)), [1, ids.length]),
      position_ids: mk('int64', BigInt64Array.from({ length: ids.length }, (_, i) => BigInt(i)), [1, ids.length]),
      audio_features: mk(initAudioType, afData, af.dims),
      audio_offset: mk('int64', BigInt64Array.from([BigInt(audioStart)]), [1]),
    };
    t = performance.now();
    let out = await initSess.run(feeds);
    const asF32 = (t) => (t.type === 'float16' ? f16ToF32(t.data) : t.data);
    let logits = asF32(out.logits);
    const vocabN = out.logits.dims[out.logits.dims.length - 1];
    let next = argmax(logits.subarray(logits.length - vocabN));
    r.prefillMs = Math.round(performance.now() - t);
    r.promptTokens = ids.length;
    let pk = out.present_keys, pv = out.present_values;
    const gen = [next];
    let pos = ids.length;
    const tD = performance.now();
    let steps = 0;
    while (!EOS.has(next) && gen.length < MAX_TOKENS) {
      const sf = {
        input_embeds: mk(stepEmbType, embedRow(next, stepEmbType), [1, 1, hidden]),
        position_ids: mk('int64', BigInt64Array.from([BigInt(pos)]), [1, 1]),
        past_keys: pk, past_values: pv,
      };
      const so2 = await stepSess.run(sf);
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
    r.totalMs = r.melMs + r.encoderMs + r.prefillMs + r.decodeMs;
    r.rtf = +(r.totalMs / 1000 / r.audioSec).toFixed(3);
    const cut = gen.indexOf(ASR_TEXT);
    r.prefix = cut >= 0 ? tok.decode(gen.slice(0, cut)) : null;
    r.text = tok.decode(cut >= 0 ? gen.slice(cut + 1) : gen);
    r.hitEos = EOS.has(next);
    return r;
  }

  const manifest = await (await fetch('./clips/manifest.json')).json().catch(() => ({}));
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
