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
    expect(src, `${name} does not import initTransformersEnv`).toMatch(/from\s+['"]\.\/_shared\/transformers-env['"]/);
    expect(src, `${name} does not call initTransformersEnv`).toMatch(/initTransformersEnv\(/);
  });
});

// The shared harness (initTransformersEnv) does not manage ortEnv.wasm.wasmPaths
// for the VAD InferenceSession — each ASR worker must keep setting it directly.
// A future edit could drop this silently since the guard above wouldn't catch it.
const ASR_WORKERS = [
  'whisper-webgpu.worker.ts',
  'cohere-transcribe-webgpu.worker.ts',
  'voxtral-3b-webgpu.worker.ts',
  'voxtral-webgpu.worker.ts',
  'granite-speech-webgpu.worker.ts',
];

describe('ASR worker ortEnv wasmPaths', () => {
  it.each(ASR_WORKERS)('%s still sets ortEnv.wasm.wasmPaths', (name) => {
    const src = read(name);
    expect(src, `${name} no longer assigns ortEnv.wasm.wasmPaths`).toMatch(/ortEnv\.wasm\.wasmPaths\s*=/);
  });

  // The assignment must run BEFORE the VAD InferenceSession is created — that
  // ordering is the whole reason it's kept out of initTransformersEnv. Presence
  // alone wouldn't catch a regression that moves it after the initVad() call.
  // Anchor on the call site (`await initVad(`), not the top-level `async function
  // initVad(` definition.
  it.each(ASR_WORKERS)('%s sets ortEnv.wasm.wasmPaths before the initVad() call', (name) => {
    const src = read(name);
    const assignIdx = src.search(/ortEnv\.wasm\.wasmPaths\s*=/);
    const vadCallIdx = src.indexOf('await initVad(');
    expect(assignIdx, `${name}: ortEnv.wasm.wasmPaths assignment not found`).toBeGreaterThanOrEqual(0);
    expect(vadCallIdx, `${name}: 'await initVad(' call anchor not found`).toBeGreaterThanOrEqual(0);
    expect(assignIdx, `${name}: ortEnv.wasm.wasmPaths must be set before the initVad() call`).toBeLessThan(vadCallIdx);
  });
});

// PTT / Push-to-Translate release finalizes the current VAD segment by posting
// {type:'flush'} (MainPanel.createResponse → AsrEngine.flush → session.post).
// The trailing silence tail fed on release (~700ms) is shorter than the default
// VAD redemption window (vadMinSilenceDuration 1.4s → 1400ms), so silence alone
// can NEVER close the segment — the worker MUST honor the flush message and force
// frameProcessor.endSegment(). A worker that silently drops 'flush' leaks the
// pending utterance into the next press, surfacing it one utterance late.
// (Regression guard: whisper-webgpu.worker.ts originally had no 'flush' case.)
describe('ASR worker flush handling (PTT finalization)', () => {
  it.each(ASR_WORKERS)('%s routes the flush message to endSegment', (name) => {
    const src = read(name);
    expect(src, `${name}: message router has no case 'flush' (PTT release is a no-op)`)
      .toMatch(/case\s+['"]flush['"]\s*:/);
    expect(src, `${name}: flush path never force-finalizes via frameProcessor.endSegment`)
      .toMatch(/endSegment\(/);
  });
});
