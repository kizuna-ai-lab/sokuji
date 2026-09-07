import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every worker that can load an f16 variant on WebGPU must call the gate.
 *
 * The gate first shipped covering seven workers and missed three more that also
 * hand a dtype to a WebGPU loader — Qwen3.5, HY-MT and TranslateGemma, each with
 * a `q4f16` variant in the manifest. Hand-enumerating the workers is what
 * failed, so this enumerates them from disk: a new WebGPU worker cannot be added
 * without either wiring the gate or naming itself below with a reason.
 *
 * The predicate is deliberately loose (mentions WebGPU AND loads a model) and
 * the exemptions carry the judgement, because the three shapes a worker uses to
 * reach the GPU — `device: 'webgpu'`, `executionProviders: ['webgpu']`, and a
 * computed `device` variable — are exactly what a tighter pattern kept missing.
 */

const WORKERS_DIR = __dirname;

const MANIFEST = readFileSync(join(WORKERS_DIR, '..', 'modelManifest.ts'), 'utf8');

/** The `requiredFeatures` of a model card, or '' when the card is not found. */
function cardSource(modelId: string): string {
  const at = MANIFEST.indexOf(`id: '${modelId}'`);
  return at < 0 ? '' : MANIFEST.slice(at, at + 3000);
}

/**
 * Loads a model on WebGPU but cannot reach an f16 variant.
 *
 * Each exemption carries the condition that makes it sound, as a predicate the
 * test runs — not just prose. A name-only exemption never expires: the worker
 * could later take an f16 dtype, or its model could gain an f16 variant, and
 * this file would keep waving it through. That is the same hand-maintained
 * hole the test exists to close.
 */
const EXEMPT: Record<string, { reason: string; stillHolds: (source: string) => boolean }> = {
  'supertonic-tts.worker.ts': {
    // It DOES reach the GPU (executionProviders: [ep], where ep can be
    // 'webgpu'), but it selects no dtype, so the gate would be a no-op — and
    // supertonic-3 declares no f16 variant for it to load either. Both halves
    // are load-bearing: a dtype would make the gate meaningful, and an f16
    // variant would let f16 files through even without one.
    reason: 'selects no dtype, and supertonic-3 declares no f16 variant',
    stillHolds: source => !source.includes('dtype') && !cardSource('supertonic-3').includes('shader-f16'),
  },
  'zoom-vad.worker.ts': {
    // wasm only — the single "webgpu" in the file is a comment pointing at the
    // worker its VAD scaffolding was copied from.
    reason: 'VAD runs on wasm and selects no dtype',
    stillHolds: source => source.includes("executionProviders: ['wasm']") && !source.includes('dtype'),
  },
  'translation.worker.ts': {
    // Hardcodes q8 and never asks for the GPU. Reads every dtype in the file
    // rather than asserting the absence of a non-q8 one: a negative lookahead
    // after `\s*` matches at the zero-width position and reports every file as
    // failing, which is how the first draft of this predicate was wrong.
    reason: "every dtype is 'q8', and it never asks for a WebGPU device",
    stillHolds: source => {
      const dtypes = [...source.matchAll(/dtype:\s*'([^']+)'/g)].map(m => m[1]);
      return dtypes.length > 0
        && dtypes.every(d => d === 'q8')
        && !/device:\s*'webgpu'/.test(source)
        && !/executionProviders:\s*\[\s*'webgpu'/.test(source);
    },
  },
};

const LOADS_A_MODEL = /from_pretrained\(|pipeline as any\)\(|await pipeline\(|InferenceSession\.create\(/;

function workerSources(): { name: string; source: string }[] {
  return readdirSync(WORKERS_DIR)
    .filter(f => f.endsWith('.worker.ts'))
    .map(name => ({ name, source: readFileSync(join(WORKERS_DIR, name), 'utf8') }));
}

function candidates() {
  return workerSources().filter(
    w => w.source.toLowerCase().includes('webgpu') && LOADS_A_MODEL.test(w.source),
  );
}

describe('the shader-f16 gate covers every WebGPU worker', () => {
  it('finds the workers to check', () => {
    // Guards the guard: a predicate that matched nothing would pass every
    // assertion below without checking anything.
    expect(candidates().length).toBeGreaterThanOrEqual(13);
  });

  it('every WebGPU worker calls assertShaderF16Supported', () => {
    const missing = candidates()
      .filter(w => !(w.name in EXEMPT))
      .filter(w => !w.source.includes('assertShaderF16Supported('))
      .map(w => w.name);
    expect(missing).toEqual([]);
  });

  it('re-checks the condition behind every exemption', () => {
    // The reason is not documentation here — it is executed. A worker that
    // grew a dtype, moved onto the GPU, or whose model gained an f16 variant
    // loses its exemption and must wire the gate.
    const broken = Object.entries(EXEMPT)
      .map(([name, { reason, stillHolds }]) => {
        const worker = workerSources().find(w => w.name === name);
        if (!worker) return `${name}: exempted but no such worker`;
        if (worker.source.includes('assertShaderF16Supported(')) return `${name}: calls the gate, exemption is stale`;
        if (!stillHolds(worker.source)) return `${name}: no longer true that ${reason}`;
        return null;
      })
      .filter(Boolean);
    expect(broken).toEqual([]);
  });

  it('every worker that calls it also imports it', () => {
    const broken = workerSources()
      .filter(w => w.source.includes('assertShaderF16Supported('))
      .filter(w => !w.source.includes("from './shaderF16Gate'"))
      .map(w => w.name);
    expect(broken).toEqual([]);
  });

  // The import once landed inside a multi-line `import type { … }` block —
  // a syntax error the bundler catches, but only after a full build.
  it('never puts the import inside another import block', () => {
    const broken = workerSources()
      .filter(w => /import type \{[^}]*\n\s*import \{ assertShaderF16Supported/.test(w.source))
      .map(w => w.name);
    expect(broken).toEqual([]);
  });
});
