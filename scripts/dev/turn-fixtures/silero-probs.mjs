// Records Silero v5's speech probability for every 512-sample frame of the recorded Japanese sentences, in
// e2e/support/speech.ts's order and with its pauses, so turn-detector.replay.test.ts replays real speech
// without running Silero. Node only:  node scripts/dev/turn-fixtures/silero-probs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FRAME = 512;
const CONTEXT = 64;
const RATE = 16000;
// Same lists as e2e/support/speech.ts (SENTENCES order, PAUSES_MS after each).
const CLIPS = ['umbrella', 'door', 'meeting', 'book', 'dinner', 'cafe', 'train', 'wait'];
const PAUSES_MS = [2400, 400, 2200, 1800, 1400, 2000, 900, 3000];

function pcm16Mono16k(file) {
  const wav = fs.readFileSync(file);
  let at = 12;
  let rate = 0;
  while (at + 8 <= wav.length) {
    const id = wav.toString('ascii', at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      if (wav.readUInt16LE(at + 8) !== 1 || wav.readUInt16LE(at + 10) !== 1 || wav.readUInt16LE(at + 22) !== 16) throw new Error(`${file}: not 16-bit mono PCM`);
      rate = wav.readUInt32LE(at + 12);
    } else if (id === 'data') {
      if (rate !== RATE) throw new Error(`${file}: ${rate} Hz, expected ${RATE}`);
      const n = Math.min(size, wav.length - at - 8) >> 1;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = wav.readInt16LE(at + 8 + 2 * i) / 32768;
      return out;
    }
    at += 8 + size + (size & 1);
  }
  throw new Error(`${file}: no data chunk`);
}

const clips = CLIPS.map((name) => pcm16Mono16k(path.join(repo, 'scripts/dev/wire-probe/assets/ja', `${name}.wav`)));
const join = (parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const pause = (i) => new Float32Array(Math.round((PAUSES_MS[i] / 1000) * RATE));

const ort = await import(pathToFileURL(path.join(repo, 'node_modules/onnxruntime-web/dist/ort.node.min.mjs')).href);
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = path.join(repo, 'node_modules/onnxruntime-web/dist') + '/';
const session = await ort.InferenceSession.create(fs.readFileSync(path.join(repo, 'public/wasm/vad/silero_vad_v5.onnx')), { executionProviders: ['wasm'] });
const sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(RATE)]), []);

/** One pass over a whole timeline: no state reset, the context carried as the workers carried it. */
async function probabilities(timeline) {
  let state = new ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  let context = new Float32Array(CONTEXT);
  const frames = [];
  for (let at = 0; at + FRAME <= timeline.length; at += FRAME) {
    const frame = timeline.subarray(at, at + FRAME);
    const input = new Float32Array(CONTEXT + FRAME);
    input.set(context);
    input.set(frame, CONTEXT);
    context = frame.slice(FRAME - CONTEXT);
    const result = await session.run({ input: new ort.Tensor('float32', input, [1, CONTEXT + FRAME]), sr, state });
    state = result.stateN;
    frames.push(Math.round(result.output.data[0] * 10000) / 10000);
  }
  return frames;
}

// The sentences with their pauses, and the same sentences back to back (for the Max speech scenario).
const frames = await probabilities(join(clips.flatMap((clip, i) => [clip, pause(i)])));
const framesNoPause = await probabilities(join(clips));
const out = path.join(repo, 'src/lib/local-inference/workers/_shared/__fixtures__/ja-sentences.silero.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ frames, framesNoPause, clips: CLIPS, pausesMs: PAUSES_MS }));
console.log(`${frames.length} frames with pauses, ${framesNoPause.length} without; speech frames >= 0.3: ${frames.filter((p) => p >= 0.3).length}`);
await session.release();
