/**
 * Shared Pocket TTS web-bench routine (#263). Mirrors scripts/bench-pocket-native.ts
 * on onnxruntime-web. Called from BOTH the bench worker and the main-thread entry so
 * we can compare worker vs main-thread and single- vs multi-thread WASM fairly.
 */
import { InferenceSession, Tensor, env as ortEnv } from './_shared/onnxruntime-all';
import {
  POCKET_MODEL_STEMS, POCKET_SAMPLE_RATE, POCKET_METADATA_FILE, POCKET_TOKENIZER_FILE,
  POCKET_BOS_FILE, POCKET_BUNDLE_BASE, type PocketSessionId,
} from '../pocket/pocketBundle';
import { PocketTokenizer } from '../pocket/pocketTokenizer';
import {
  setPocketTensor, encodeReference, resampleTo24k, buildVoiceConditionedState, generate,
  parseNpyFloat32, type PocketSessions, type PocketMetadata, type PocketTensorCtor,
} from '../pocket/pocketInferenceCore';

const TEXT = 'All processing is done locally on your device (CPU) within your browser '
  + 'with a single thread. No server is involved, ensuring privacy and security. '
  + 'You can disconnect from the Internet once this page is loaded.';
const REF_URL = '/pocket-ref.wav';

export interface BenchConfig {
  ep: 'wasm' | 'webgpu';
  threads: number;
  simd: boolean;
  reps: number;
  maxFrames: number;
  lsdSteps: number;
  ortWasmBaseUrl: string;
}

export interface BenchResult {
  type: 'result';
  cfg: BenchConfig;
  rtf: number;
  bestGenMs: number;
  audioSec: number;
  stage: string;
  reps: { genMs: number; rtf: number }[];
  coi: boolean;
}

async function fetchBuf(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return r.arrayBuffer();
}

function readWavMono(buf: ArrayBuffer): { samples: Float32Array; sampleRate: number } {
  const dv = new DataView(buf);
  const numChannels = dv.getUint16(22, true);
  const sampleRate = dv.getUint32(24, true);
  const bps = dv.getUint16(34, true);
  let off = 12;
  const bytes = new Uint8Array(buf);
  while (off + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
    const size = dv.getUint32(off + 4, true);
    if (id === 'data') {
      const start = off + 8;
      const n = Math.floor(size / (bps / 8) / numChannels);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let c = 0; c < numChannels; c++) acc += dv.getInt16(start + (i * numChannels + c) * 2, true) / 32768;
        out[i] = acc / numChannels;
      }
      return { samples: out, sampleRate };
    }
    off += 8 + size + (size & 1);
  }
  throw new Error('no data chunk in ref wav');
}

async function loadSessions(cfg: BenchConfig, log: (m: string) => void): Promise<PocketSessions> {
  const opts: InferenceSession.SessionOptions = {
    executionProviders: cfg.ep === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
  };
  const created: Partial<PocketSessions> = {};
  for (const id of Object.keys(POCKET_MODEL_STEMS) as PocketSessionId[]) {
    const file = POCKET_MODEL_STEMS[id];
    const t0 = performance.now();
    created[id] = await InferenceSession.create(await fetchBuf(`${POCKET_BUNDLE_BASE}/${file}`), opts);
    log(`loaded ${file} in ${Math.round(performance.now() - t0)}ms`);
  }
  return created as PocketSessions;
}

export async function runBench(cfg: BenchConfig, log: (m: string) => void): Promise<BenchResult> {
  const coi = !!(globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated;
  log(`config ${JSON.stringify(cfg)} coi=${coi}`);

  ortEnv.wasm.wasmPaths = cfg.ortWasmBaseUrl;
  ortEnv.wasm.numThreads = cfg.threads;
  ortEnv.wasm.simd = cfg.simd;
  setPocketTensor(Tensor as unknown as PocketTensorCtor);

  const meta = JSON.parse(new TextDecoder().decode(await fetchBuf(`${POCKET_BUNDLE_BASE}/${POCKET_METADATA_FILE}`))) as PocketMetadata;
  const bos = meta.insert_bos_before_voice ? parseNpyFloat32(await fetchBuf(`${POCKET_BUNDLE_BASE}/${POCKET_BOS_FILE}`)) : null;
  const tokenizer = new PocketTokenizer();
  await tokenizer.load(await fetchBuf(`${POCKET_BUNDLE_BASE}/${POCKET_TOKENIZER_FILE}`));
  const refWav = readWavMono(await fetchBuf(REF_URL));
  const ref24 = resampleTo24k(refWav.samples, refWav.sampleRate);
  log(`reference ${(refWav.samples.length / refWav.sampleRate).toFixed(2)}s @ ${refWav.sampleRate}Hz`);

  const tLoad = performance.now();
  const sessions = await loadSessions(cfg, log);
  log(`all sessions loaded in ${Math.round(performance.now() - tLoad)}ms`);

  const voiceEmb = await encodeReference(sessions, ref24);
  const flowState = await buildVoiceConditionedState(sessions, meta, voiceEmb, bos);
  const ids = tokenizer.encodeIds(TEXT);
  const tokenIds = new Tensor('int64', BigInt64Array.from(ids), [1, ids.length]);
  const tcOut = await sessions.textConditioner.run({ token_ids: tokenIds });
  const textEmbeddings = tcOut[sessions.textConditioner.outputNames[0]];

  const reps: { audioSec: number; genMs: number; stage: string }[] = [];
  for (let rep = 0; rep < cfg.reps; rep++) {
    let stageLine = '';
    const t0 = performance.now();
    const samples = await generate(
      sessions, meta, textEmbeddings as never, { ...flowState },
      { lsdSteps: cfg.lsdSteps, maxFrames: cfg.maxFrames, speed: 1.0, log: (m) => { if (m.includes('generate')) stageLine = m; } },
    );
    const genMs = performance.now() - t0;
    const audioSec = samples.length / POCKET_SAMPLE_RATE;
    reps.push({ audioSec, genMs, stage: stageLine });
    const maxAbs = samples.reduce((mx, s) => Math.max(mx, Math.abs(s)), 0);
    const nan = samples.reduce((n, s) => n + (Number.isNaN(s) ? 1 : 0), 0);
    log(`rep ${rep}: audioSec=${audioSec.toFixed(2)} genMs=${Math.round(genMs)} RTF=${(audioSec / (genMs / 1000)).toFixed(2)} maxAbs=${maxAbs.toFixed(3)} nan=${nan}`);
  }
  const best = reps.reduce((b, r) => (r.genMs < b.genMs ? r : b));
  return {
    type: 'result', cfg, coi,
    rtf: +(best.audioSec / (best.genMs / 1000)).toFixed(3),
    bestGenMs: Math.round(best.genMs), audioSec: +best.audioSec.toFixed(2), stage: best.stage,
    reps: reps.map((r) => ({ genMs: Math.round(r.genMs), rtf: +(r.audioSec / (r.genMs / 1000)).toFixed(2) })),
  };
}
