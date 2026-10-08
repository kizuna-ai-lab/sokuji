// Probe: replay voxtral-webgpu.worker.ts's exact streaming loop on the CPU and log every
// decoder step's top-5 logits, so the token the model picks at each position can be read.
// Research note: docs/superpowers/notes/2026-10-08-voxtral-realtime-ished-root-cause.md
//
// Run from a scratch directory (the repo stubs onnxruntime-node out):
//   npm i onnxruntime-node @huggingface/transformers@4.2.0
//   VX_MODEL_DIR=<dir> VX_CLIP=<jfk.wav> node probe.mjs [case ...]      (FIX=1 stops before the audio-less step)
// VX_MODEL_DIR holds onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX/ (a symlink to the HF
// snapshot works); VX_CLIP is a 16 kHz mono wav (the cases below assume ggml's jfk.wav).
import { readFileSync } from 'node:fs';
import {
  env, BaseStreamer, StoppingCriteria,
  VoxtralRealtimeForConditionalGeneration, VoxtralRealtimeProcessor,
} from '@huggingface/transformers';
const FIX = process.env.FIX === '1'; // stop before the audio-less step (what Python transformers does)

env.localModelPath = process.env.VX_MODEL_DIR; // dir holding onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX/
env.allowRemoteModels = false;
env.allowLocalModels = true;

const MODEL = 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX';
const SR = 16000;
const PAD_ID = 32n, EOS_ID = 2n;
const TOK_SAMPLES = 1280; // 80 ms

function wav16k(path) {
  const b = readFileSync(path);
  let off = 12, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4); const size = b.readUInt32LE(off + 4);
    if (id === 'data') { data = { start: off + 8, size }; break; }
    off += 8 + size + (size & 1);
  }
  const n = data.size / 2; const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(data.start + i * 2) / 32768;
  return out;
}
const cat = (...parts) => {
  const n = parts.reduce((s, p) => s + p.length, 0); const o = new Float32Array(n); let w = 0;
  for (const p of parts) { o.set(p, w); w += p.length; } return o;
};
const zeros = (sec) => new Float32Array(Math.round(sec * SR));
const noise = (sec, amp) => { const o = zeros(sec); for (let i = 0; i < o.length; i++) o[i] = (Math.random() * 2 - 1) * amp; return o; };
const sec = (x, a, b) => x.subarray(Math.round(a * SR), Math.round(b * SR));

const jfk = wav16k(process.env.VX_CLIP);
const pre = zeros(0.5); // stands in for the 0.8 s pre-roll (the clip's own lead is 0.32 s)
const tail7 = zeros(7 * TOK_SAMPLES / SR), tail17 = zeros(17 * TOK_SAMPLES / SR);

// speech "And so, my fellow Americans," ends ~2.58 s; "ask" starts ~3.28 s.
const CASES = {
  A_pause_cut:        () => cat(pre, sec(jfk, 0, 3.08), tail7),       // cut inside the pause
  B_onset_cut:        () => cat(pre, sec(jfk, 0, 3.36), tail7),       // 80 ms of "ask" onset included
  C_word_end_cut:     () => cat(pre, sec(jfk, 0, 2.60), tail7),       // cut right at the word end
  D_full_clip:        () => cat(pre, jfk, tail7),
  E_onset_cut_tail17: () => cat(pre, sec(jfk, 0, 3.36), tail17),
  F_onset_cut_notail: () => cat(pre, sec(jfk, 0, 3.36)),
  H_zeros_only:       () => zeros(3.0),
  I_onset_cut_noise:  () => cat(pre, sec(jfk, 0, 3.36), noise(7 * TOK_SAMPLES / SR, 0.002)),
  J_midword_cut:      () => cat(pre, sec(jfk, 0, 2.30), tail7),       // inside "Americans"
  K_pause_cut_long:   () => cat(pre, sec(jfk, 0, 3.08), zeros(1.4), tail7), // 1.4 s real-ish silence then pad
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CASES);

const dtype = { audio_encoder: 'q4', embed_tokens: 'q4', decoder_model_merged: 'q4' };
const t0 = performance.now();
const model = await VoxtralRealtimeForConditionalGeneration.from_pretrained(MODEL, { dtype, device: 'cpu' });
const processor = await VoxtralRealtimeProcessor.from_pretrained(MODEL);
const tokenizer = processor.tokenizer;
console.log(`model loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

const { hop_length, n_fft } = processor.feature_extractor.config;
const winHalf = Math.floor(n_fft / 2);
const samplesPerTok = processor.audio_length_per_tok * hop_length;
const MAX_TOK_PER_CALL = 32; // boundedBatchEndSample's cap

function logSoftmaxTop(data, k) {
  let mx = -Infinity; for (let i = 0; i < data.length; i++) if (data[i] > mx) mx = data[i];
  let s = 0; for (let i = 0; i < data.length; i++) s += Math.exp(data[i] - mx);
  const lse = mx + Math.log(s);
  const idx = Array.from({ length: data.length }, (_, i) => i);
  idx.sort((a, b) => data[b] - data[a]);
  return { lse, top: idx.slice(0, k).map((i) => [i, data[i] - lse]) };
}
const piece = (id) => JSON.stringify(tokenizer.decode([BigInt(id)], { skip_special_tokens: false }));

async function run(name) {
  const audio = CASES[name]();
  const numSamplesFirst = processor.num_samples_first_audio_chunk;
  const firstChunk = await processor(audio.subarray(0, numSamplesFirst), { is_streaming: true, is_first_audio_chunk: true });
  let encTokens = 0; // audio tokens the encoder has produced so far (exact)
  let lastYielded = false;
  const encSession = model.sessions['audio_encoder'];
  const origEncRun = encSession.run.bind(encSession);
  encSession.run = async (...a) => { const r = await origEncRun(...a); encTokens += r.audio_embeds.dims[1]; return r; };
  async function* chunks() {
    yield firstChunk.input_features;
    let melFrameIdx = processor.num_mel_frames_first_audio_chunk;
    let startIdx = melFrameIdx * hop_length - winHalf;
    while (true) {
      const endNeeded = startIdx + processor.num_samples_per_audio_chunk;
      if (audio.length < endNeeded) break;
      const extra = Math.min(Math.floor((audio.length - endNeeded) / samplesPerTok), MAX_TOK_PER_CALL - 1);
      const batchEnd = endNeeded + extra * samplesPerTok;
      const c = await processor(audio.slice(startIdx, batchEnd), { is_streaming: true, is_first_audio_chunk: false });
      const frames = c.input_features.dims[2];
      const nextStart = (melFrameIdx + frames) * hop_length - winHalf;
      if (audio.length < nextStart + processor.num_samples_per_audio_chunk) lastYielded = true;
      yield c.input_features;
      melFrameIdx += frames;
      startIdx = melFrameIdx * hop_length - winHalf;
    }
    lastYielded = true;
  }

  const steps = [];
  const origForward = model.forward.bind(model);
  model.forward = async (inputs) => {
    const out = await origForward(inputs);
    const lg = out.logits; const [, seq, vocab] = lg.dims;
    const last = lg.data.subarray((seq - 1) * vocab, seq * vocab);
    const { lse, top } = logSoftmaxTop(last, 5);
    steps.push({ promptLen: inputs.input_ids.dims[1], top, lpPad: last[32] - lse, lpEos: last[2] - lse, encTokens });
    return out;
  };
  let generated = 0;
  const stopBeforeAudioless = new (class extends StoppingCriteria {
    _call(ids) { return ids.map(() => lastYielded && 38 + generated >= encTokens); }
  })();
  const emitted = [];
  const streamer = new (class extends BaseStreamer {
    put(v) { emitted.push(...v[0]); if (emitted.length > 39) generated++; }
    end() {}
  })();
  const tA = performance.now();
  await model.generate({ input_ids: firstChunk.input_ids, input_features: chunks(), max_new_tokens: 4096, streamer,
    ...(FIX ? { stopping_criteria: stopBeforeAudioless } : {}) });
  model.forward = origForward;
  encSession.run = origEncRun;
  const dt = (performance.now() - tA) / 1000;

  // emitted[0..38] is the prompt echo; generated tokens follow, one per decoder step after prefill
  const gen = emitted.slice(39);
  const text = tokenizer.decode(gen, { skip_special_tokens: true });
  console.log(`\n=== ${name}${FIX ? ' [FIX]' : ''}: audio ${(audio.length / SR).toFixed(2)} s, encoder tokens ${encTokens}, generated ${gen.length} steps (${steps.length} forwards) in ${dt.toFixed(1)} s`);
  console.log(`text: ${JSON.stringify(text)}`);
  console.log(`tokens: ${gen.map(Number).join(' ')}`);
  // per-step: step i (0-based generated) consumed audio token 39+i; the last step has none if 39+i >= realTok
  for (let i = 0; i < gen.length; i++) {
    const s = steps[i]; // steps[0] is the prefill forward, which samples gen[0]
    const id = Number(gen[i]);
    // gen[0] comes from the prefill forward (positions 0..38); gen[i>=1] from the forward that consumed position 38+i.
    const pos = i === 0 ? 38 : 38 + i;
    const hasAudio = pos < encTokens; // encTokens is final here: positions past it never got an audio embedding
    const audioMs = hasAudio ? ((pos - 32 + 1) * 80) : null; // real audio seen up to this position (after the 32 zero-pad tokens)
    const flag = id === 32 ? '' : ' <<<';
    const top = s.top.map(([t, lp]) => `${t}${t === 32 ? '[PAD]' : t === 2 ? '[EOS]' : piece(t)}:${lp.toFixed(2)}`).join('  ');
    console.log(`#${String(i).padStart(3)} ${hasAudio ? `a=${String(audioMs).padStart(5)}ms` : 'NO-AUDIO'} -> ${String(id).padStart(6)} ${id === 32 ? '[PAD]' : piece(id).padEnd(12)} lpPad=${s.lpPad.toFixed(2)} lpEos=${s.lpEos.toFixed(2)} | ${top}${flag}`);
  }
}

for (const n of names) await run(n);
