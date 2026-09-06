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

/** Loads a model on WebGPU but takes no f16 variant. Reasons, not just names. */
const EXEMPT: Record<string, string> = {
  // Raw ORT with no dtype at all: supertonic-3 ships no f16 variant (no
  // requiredFeatures in its manifest card), so there is nothing to gate.
  'supertonic-tts.worker.ts': 'no dtype; supertonic-3 has no f16 variant',
  // wasm only — the single "webgpu" in the file is a comment pointing at the
  // worker its VAD scaffolding was copied from.
  'zoom-vad.worker.ts': 'VAD runs on wasm',
  // Hardcodes dtype: 'q8' and never asks for the WebGPU device.
  'translation.worker.ts': "hardcoded q8, no WebGPU device",
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

  it('keeps the exemption list honest', () => {
    // An exemption for a worker that does call the gate, or that no longer
    // exists, is stale and hides the next miss.
    const names = new Set(workerSources().map(w => w.name));
    const stale = Object.keys(EXEMPT).filter(
      n => !names.has(n) || workerSources().find(w => w.name === n)!.source.includes('assertShaderF16Supported('),
    );
    expect(stale).toEqual([]);
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
