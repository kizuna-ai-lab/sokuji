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
  'qwen3-asr-webgpu.worker.ts',
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

// PTT / Push-to-Translate release finalizes the current utterance by posting
// {type:'flush'} (MainPanel.createResponse → AsrEngine.flush → session.post).
// The trailing silence tail fed on release (~700ms) is shorter than the default
// VAD redemption window (vadMinSilenceDuration 1.4s → 1400ms), so silence alone
// can NEVER close the segment — the worker MUST honor the flush message. A worker
// that silently drops 'flush' leaks the pending utterance into the next press,
// surfacing it one utterance late (the original whisper-webgpu regression: no
// 'flush' case at all).
//
// Guard the ROUTING chain — 'flush' must reach a defined handleFlush() — rather
// than any specific finalization mechanism: workers finalize differently
// (frameProcessor.endSegment for VAD-segmented ASR, stopGenerate for the streaming
// generate-loop voxtral worker), so asserting `endSegment` in the flush path would
// wrongly fail voxtral-webgpu. `endSegment` also appears in every worker's dispose
// path, so an "endSegment appears somewhere" assertion is a false positive.
describe('ASR worker flush handling (PTT finalization)', () => {
  it.each(ASR_WORKERS)('%s routes the flush message to a defined handleFlush()', (name) => {
    const src = read(name);
    expect(src, `${name}: message router drops 'flush' instead of routing it to handleFlush()`)
      .toMatch(/case\s+['"]flush['"]\s*:\s*(?:await\s+)?handleFlush\(/);
    expect(src, `${name}: router calls handleFlush() but the function is never defined`)
      .toMatch(/(?:async\s+)?function\s+handleFlush\b/);
  });
});

// #470: an ASR worker must never `await` its model decode from inside feedAudio. Awaiting
// there holds `processingVad` for the whole decode (0.5–2.5 s on the fleet GPUs), and the guard
// at the top of feedAudio then drops every audio message arriving meanwhile — on gapless audio
// that is the first words of the next utterance, and on the 20 s max-speech cap it is words at
// every boundary. Decodes are fire-and-forget (`void schedule(...)`) on SpeechEnd, on the cap
// and on flush, serialized behind a worker-local promise that handleFlush drains. voxtral-3b
// and qwen3-asr established the pattern (#469); whisper, cohere and granite adopted it in #497.
//
// Each path gets a positive AND a negative assertion on its own slice, with every anchor
// required to exist: the first version of this guard anchored the cap slice on a comment that
// in whisper first appears on the `maxSpeechFrames` declaration and used a section header
// cohere does not have, so `indexOf` widened the slice until it contained a sibling's `void`
// and the cap-path assertion passed vacuously for two of the three workers.
const NON_BLOCKING_DECODE_WORKERS = [
  ['whisper-webgpu.worker.ts', 'scheduleWhisper', 'pendingWhisperDecode'],
  ['cohere-transcribe-webgpu.worker.ts', 'scheduleTranscription', 'currentTranscriptionPromise'],
  ['granite-speech-webgpu.worker.ts', 'scheduleGraniteInference', 'pendingGraniteDecode'],
  ['qwen3-asr-webgpu.worker.ts', 'transcribe', 'currentDecodePromise'],
  ['voxtral-3b-webgpu.worker.ts', 'runVoxtral3B', 'currentDecodePromise'],
] as const;

/**
 * `src.slice(from, to)` with both anchors required, in order. A missing anchor must fail the
 * test loudly — `indexOf` returning -1 silently turns a slice into "the rest of the file".
 */
function sliceBetween(src: string, name: string, from: string, to: string): string {
  const a = src.indexOf(from);
  expect(a, `${name}: anchor ${JSON.stringify(from)} not found`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf(to, a + from.length);
  expect(b, `${name}: anchor ${JSON.stringify(to)} not found after ${JSON.stringify(from)}`)
    .toBeGreaterThanOrEqual(0);
  return src.slice(a, b);
}

describe('ASR worker VAD decode handoff (#470)', () => {
  it.each(NON_BLOCKING_DECODE_WORKERS)('%s fires %s without awaiting it on every segment-closing path', (name, schedule, pending) => {
    const src = read(name);
    const paths: Array<[string, string]> = [
      ['SpeechEnd', sliceBetween(src, name, 'case Message.SpeechEnd:', 'case Message.VADMisfire:')],
      ['max-speech cap', sliceBetween(src, name, 'speechFramesSinceStart >= maxSpeechFrames', 'speechFramesSinceStart = 0;')],
      ['flush', sliceBetween(src, name, 'async function handleFlush', 'async function handleDispose')],
    ];
    const voidCall = new RegExp(`\\bvoid\\s+${schedule}\\(`);
    const awaitCall = new RegExp(`\\bawait\\s+${schedule}\\(`);
    for (const [label, slice] of paths) {
      expect(slice, `${name}: the ${label} path must fire-and-forget ${schedule}()`).toMatch(voidCall);
      expect(slice, `${name}: the ${label} path must not await ${schedule}() (holds processingVad, drops audio)`).not.toMatch(awaitCall);
    }
    const [, flush] = paths[2];
    expect(flush, `${name}: handleFlush must drain ${pending} so PTT release resolves after the utterance's text is posted`)
      .toMatch(new RegExp(`await\\s+${pending}\\b`));
  });
});

// handleDispose nulls the module-level model reference BEFORE its final drain of the decode
// chain (so a queued decode exits at its guard), which means a decode already past that guard
// can resume with the global gone. The segment body must therefore read the model through a
// local captured before its first await — qwen3-asr's `const m = model` — never the module
// global. granite once did `await processor(...)` and then `model.generate(...)`, which threw
// inside its try and posted a spurious "Granite inference failed" during dispose (#497 review).
// whisper and cohere read their global synchronously before the first await, so this guard is
// granite-specific.
describe('ASR worker decode body holds its model in a local', () => {
  it('granite-speech-webgpu.worker.ts never dereferences the module globals after capturing them', () => {
    const src = read('granite-speech-webgpu.worker.ts');
    const body = sliceBetween(src, 'granite', 'async function runGraniteInferenceSegment', '// ─── Audio Feed Pipeline');
    expect(body, 'capture `model` into a local before the first await').toMatch(/= model;/);
    expect(body, 'capture `processor` into a local before the first await').toMatch(/= processor;/);
    // Presence is not enough: a capture placed after the first awaited call would reintroduce
    // the race, so both must precede it. Comments in the body must not spell an `await x(`.
    const firstAwait = body.search(/\bawait\s+[A-Za-z_$][\w$]*\s*\(/);
    expect(firstAwait, 'the segment body should contain an awaited call').toBeGreaterThanOrEqual(0);
    expect(body.indexOf('= model;'), 'capture `model` above the first await').toBeLessThan(firstAwait);
    expect(body.indexOf('= processor;'), 'capture `processor` above the first await').toBeLessThan(firstAwait);
    expect(body, 'must not dereference the module global `model` (nulled by handleDispose mid-decode)').not.toMatch(/\bmodel\./);
    expect(body, 'must not call or dereference the module global `processor`').not.toMatch(/\bprocessor[.(]/);
  });
});
