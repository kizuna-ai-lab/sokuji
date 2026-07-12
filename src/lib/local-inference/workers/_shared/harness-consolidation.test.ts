import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Every transformers.js worker must route through the shared harness — no
// re-inlined createBlobUrlCache, no hand-written env block. Guards against drift.
const TRANSFORMERS_WORKERS = [
  'translation.worker.ts',
  'qwen-translation.worker.ts',
  'qwen35-translation.worker.ts',
  'hy-mt-translation.worker.ts',
  'translategemma-translation.worker.ts',
  'whisper-webgpu.worker.ts',
  'cohere-transcribe-webgpu.worker.ts',
  'voxtral-3b-webgpu.worker.ts',
  'voxtral-webgpu.worker.ts',
  'granite-speech-webgpu.worker.ts',
];

// Capture import.meta.url at module scope: reading it lazily from inside a
// separately-declared function resolves to a truncated (root-relative) URL
// under this Vite/Vitest version, so it must be captured here instead.
const here = import.meta.url;

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../${name}`, here)), 'utf8');
}

describe('worker harness consolidation', () => {
  it.each(TRANSFORMERS_WORKERS)('%s routes through the shared harness', (name) => {
    const src = read(name);
    expect(src, `${name} still defines a local createBlobUrlCache`).not.toMatch(/function\s+createBlobUrlCache/);
    expect(src, `${name} still hand-sets env.customCache`).not.toMatch(/env\.customCache\s*=\s*createBlobUrlCache/);
    expect(src, `${name} does not import initTransformersEnv`).toContain("from './_shared/transformers-env'");
    expect(src, `${name} does not call initTransformersEnv`).toMatch(/initTransformersEnv\(/);
  });
});
