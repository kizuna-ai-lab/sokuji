/**
 * The bench cache (port of accel.py's bench half): measured RTF and decode throughput, and op coverage, kept in
 * `accel-bench.v2.json` under SOKUJI_BENCH_DIR (default ~/.cache/sokuji-sidecar). Every key starts with the
 * generation that produced it; the last three generations are kept. Reads and writes are best-effort and never throw;
 * a write goes through a temp file and a rename, so a crash never leaves a torn file. The old Python file is ignored.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cacheKey, type Plan } from '../planner';
import type { Machine } from './machine';
import { seams } from './seams';

export type BenchEntries = Record<string, unknown>;

const GENERATIONS_KEY = '_generations';
const KEEP_GENERATIONS = 3;

export function benchCachePath(): string {
  const base = process.env.SOKUJI_BENCH_DIR ?? path.join(os.homedir(), '.cache', 'sokuji-sidecar');
  return path.join(base, 'accel-bench.v2.json');
}

/** [entries, generations]; a missing or corrupt file is [{}, []]. */
export function benchRead(): [BenchEntries, string[]] {
  try {
    const data = JSON.parse(fs.readFileSync(benchCachePath(), 'utf8')) as unknown;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return [{}, []];
    const { [GENERATIONS_KEY]: gens, ...entries } = data as Record<string, unknown>;
    return [entries, Array.isArray(gens) ? gens.map(String) : []];
  } catch {
    return [{}, []];
  }
}

/** The entries alone: what the planner is handed. */
export function benchLoad(): BenchEntries {
  return benchRead()[0];
}

/**
 * Rotates the generation list (last three kept), keeps a key only when its first `|` segment is a kept generation,
 * and writes through a temp file. "" is a generation like any other ("identity unknown"). Never throws.
 */
export function benchSave(entries: BenchEntries, { generation }: { generation: string }): void {
  const file = benchCachePath();
  const tmp = `${file}.tmp`;
  try {
    const [, old] = benchRead();
    let gens = [...old];
    if (!gens.includes(generation)) gens.push(generation);
    gens = gens.slice(-KEEP_GENERATIONS);
    const keep = new Set(gens);
    const kept = Object.fromEntries(Object.entries(entries).filter(([k]) => keep.has(k.split('|', 1)[0])));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ [GENERATIONS_KEY]: gens, ...kept }));
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // nothing to clean
    }
  }
}

/** The measure-and-cache skeleton: `ns` namespaces the key ("", "tps:", "tts:"); `run` measures, or null to skip. */
async function measure(
  backend: unknown, plan: Plan, modelId: string, machine: Machine,
  { ns, run, force = false }: { ns: string; run: (backend: unknown) => Promise<number | null>; force?: boolean },
): Promise<number | null> {
  try {
    const key = cacheKey(machine, ns, modelId, plan.backend, plan.device, plan.computeType);
    const cache = benchLoad();
    if (!force && key in cache) return cache[key] as number;
    const val = await run(backend);
    if (val === null) return null;
    cache[key] = val;
    benchSave(cache, { generation: machine.generation });
    return val;
  } catch {
    return null;
  }
}

export const BENCH_SECONDS = 3.0;

interface Transcribes { transcribe(samples: Float32Array, language: string | null): Promise<unknown> }

/** RTF (elapsed / audio seconds) of a fixed 3 s tone through `transcribe`, cached per key unless forced. Never throws. */
export function measureRtf(backend: unknown, plan: Plan, modelId: string, machine: Machine, { force = false } = {}): Promise<number | null> {
  return measure(backend, plan, modelId, machine, {
    ns: '', force,
    run: async (b) => {
      const sr = 16000;
      const n = Math.trunc(BENCH_SECONDS * sr);
      const clip = new Float32Array(n);
      for (let i = 0; i < n; i++) clip[i] = 0.05 * Math.sin(2.0 * Math.PI * 220.0 * (i / sr));
      const t0 = seams.now();
      await (b as Transcribes).transcribe(clip, null);
      return (seams.now() - t0) / 1000 / BENCH_SECONDS;
    },
  });
}

// Long enough that decode dominates the prompt overhead, short enough to keep init snappy.
export const BENCH_TRANSLATE_TEXT = 'The weather is lovely today, so I think I will go for a long walk in the park this afternoon.';
export const BENCH_TRANSLATE_SRC = 'English';
export const BENCH_TRANSLATE_TGT = 'French';

interface Translates { translate(text: string, systemPrompt: string, src: string, tgt: string, opts?: { wrap?: boolean }): Promise<[string, number]> }

/** Decode throughput (generated tokens / seconds) after one warm-up pass, under "tps:". Never throws. */
export function measureTps(backend: unknown, plan: Plan, modelId: string, machine: Machine, { force = false } = {}): Promise<number | null> {
  return measure(backend, plan, modelId, machine, {
    ns: 'tps:', force,
    run: async (b) => {
      const t = b as Translates;
      await t.translate(BENCH_TRANSLATE_TEXT, '', BENCH_TRANSLATE_SRC, BENCH_TRANSLATE_TGT, { wrap: false }); // warm-up
      const t0 = seams.now();
      const [, nNew] = await t.translate(BENCH_TRANSLATE_TEXT, '', BENCH_TRANSLATE_SRC, BENCH_TRANSLATE_TGT, { wrap: false });
      const dt = (seams.now() - t0) / 1000;
      if (dt <= 0 || nNew <= 0) return null;
      return nNew / dt;
    },
  });
}

export const BENCH_TTS_TEXT = 'The weather is lovely today, so I will go for a walk in the park.';

interface Generates { generate(text: string, speed: number): Promise<[Float32Array, number, number, number?]> }

/** TTS RTF (generation seconds / audio seconds) of a fixed sentence, under "tts:"; the per-synth rate counts. */
export function measureRtfTts(backend: unknown, plan: Plan, modelId: string, machine: Machine, { force = false } = {}): Promise<number | null> {
  return measure(backend, plan, modelId, machine, {
    ns: 'tts:', force,
    run: async (b) => {
      const [samples, rate, genMs, channels = 1] = await (b as Generates).generate(BENCH_TTS_TEXT, 1.0);
      const audioS = samples.length / channels / rate;           // interleaved samples → seconds
      if (audioS <= 0) return null;
      return genMs / 1000.0 / audioS;
    },
  });
}
