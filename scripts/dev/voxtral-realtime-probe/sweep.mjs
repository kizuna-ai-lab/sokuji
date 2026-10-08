// Sweep the VAD cut point over a clip and report what the audio-less last step produces,
// with and without the stop-before-audio-less fix. Same setup as probe.mjs.
//   VX_MODEL_DIR=<dir> node sweep.mjs <wav16k> <fromSec> <toSec> <stepSec> [tailTokens=7] [preSec=0.5]
import { readFileSync } from 'node:fs';
import {
  env, BaseStreamer, StoppingCriteria,
  VoxtralRealtimeForConditionalGeneration, VoxtralRealtimeProcessor,
} from '@huggingface/transformers';

env.localModelPath = process.env.VX_MODEL_DIR; // dir holding onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX/
env.allowRemoteModels = false; env.allowLocalModels = true;
const MODEL = 'onnx-community/Voxtral-Mini-4B-Realtime-2602-ONNX';
const SR = 16000, TOK = 1280;

const [wavPath, fromS, toS, stepS, tailTokArg, preArg] = process.argv.slice(2);
const TAIL = Number(tailTokArg ?? 7), PRE = Number(preArg ?? 0.5);

function wav16k(path) {
  const b = readFileSync(path); let off = 12, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === 'data') { data = { start: off + 8, size }; break; }
    off += 8 + size + (size & 1);
  }
  const n = data.size / 2, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(data.start + i * 2) / 32768;
  return out;
}
const cat = (...p) => { const o = new Float32Array(p.reduce((s, x) => s + x.length, 0)); let w = 0; for (const x of p) { o.set(x, w); w += x.length; } return o; };
const clip = wav16k(wavPath);

const dtype = { audio_encoder: 'q4', embed_tokens: 'q4', decoder_model_merged: 'q4' };
const model = await VoxtralRealtimeForConditionalGeneration.from_pretrained(MODEL, { dtype, device: 'cpu' });
const processor = await VoxtralRealtimeProcessor.from_pretrained(MODEL);
const tok = processor.tokenizer;
const { hop_length, n_fft } = processor.feature_extractor.config;
const winHalf = Math.floor(n_fft / 2), samplesPerTok = processor.audio_length_per_tok * hop_length;
const piece = (id) => id === 32 ? '[PAD]' : id === 2 ? '[EOS]' : id === 33 ? '[WORD]' : JSON.stringify(tok.decode([BigInt(id)], { skip_special_tokens: false }));

function topk(data, k) {
  let mx = -Infinity; for (let i = 0; i < data.length; i++) if (data[i] > mx) mx = data[i];
  let s = 0; for (let i = 0; i < data.length; i++) s += Math.exp(data[i] - mx);
  const lse = mx + Math.log(s);
  const idx = Array.from({ length: data.length }, (_, i) => i).sort((a, b) => data[b] - data[a]).slice(0, k);
  return idx.map((i) => [i, data[i] - lse]);
}

async function run(audio, fix) {
  const firstChunk = await processor(audio.subarray(0, processor.num_samples_first_audio_chunk), { is_streaming: true, is_first_audio_chunk: true });
  let encTokens = 0, lastYielded = false, generated = 0, lastTop = null;
  const enc = model.sessions['audio_encoder']; const origRun = enc.run.bind(enc);
  enc.run = async (...a) => { const r = await origRun(...a); encTokens += r.audio_embeds.dims[1]; return r; };
  async function* chunks() {
    yield firstChunk.input_features;
    let melFrameIdx = processor.num_mel_frames_first_audio_chunk, startIdx = melFrameIdx * hop_length - winHalf;
    while (true) {
      const endNeeded = startIdx + processor.num_samples_per_audio_chunk;
      if (audio.length < endNeeded) break;
      const extra = Math.min(Math.floor((audio.length - endNeeded) / samplesPerTok), 31);
      const c = await processor(audio.slice(startIdx, endNeeded + extra * samplesPerTok), { is_streaming: true, is_first_audio_chunk: false });
      const frames = c.input_features.dims[2];
      if (audio.length < (melFrameIdx + frames) * hop_length - winHalf + processor.num_samples_per_audio_chunk) lastYielded = true;
      yield c.input_features;
      melFrameIdx += frames; startIdx = melFrameIdx * hop_length - winHalf;
    }
    lastYielded = true;
  }
  const origForward = model.forward.bind(model);
  model.forward = async (inputs) => {
    const out = await origForward(inputs);
    const [, seq, vocab] = out.logits.dims;
    lastTop = topk(out.logits.data.subarray((seq - 1) * vocab, seq * vocab), 4);
    return out;
  };
  const emitted = [];
  const streamer = new (class extends BaseStreamer { put(v) { emitted.push(...v[0]); if (emitted.length > 39) generated++; } end() {} })();
  const stop = new (class extends StoppingCriteria { _call(ids) { return ids.map(() => lastYielded && 38 + generated >= encTokens); } })();
  await model.generate({ input_ids: firstChunk.input_ids, input_features: chunks(), max_new_tokens: 4096, streamer, ...(fix ? { stopping_criteria: stop } : {}) });
  model.forward = origForward; enc.run = origRun;
  const gen = emitted.slice(39);
  return { text: tok.decode(gen, { skip_special_tokens: true }), gen, encTokens, lastTop };
}

for (let t = Number(fromS); t <= Number(toS) + 1e-9; t += Number(stepS)) {
  const audio = cat(new Float32Array(Math.round(PRE * SR)), clip.subarray(0, Math.round(t * SR)), new Float32Array(TAIL * TOK));
  const raw = await run(audio, false);
  const fixed = await run(audio, true);
  const last = Number(raw.gen[raw.gen.length - 1]);
  const audioless = raw.gen.length > fixed.gen.length ? `audio-less step -> ${piece(last)}  top: ${raw.lastTop.map(([i, lp]) => `${piece(i)}:${lp.toFixed(2)}`).join(' ')}` : 'no audio-less step';
  console.log(`cut=${t.toFixed(2)}s raw=${JSON.stringify(raw.text)} fixed=${JSON.stringify(fixed.text)} | ${audioless}`);
}
