/**
 * Behavioural contract between the streaming ASR worker and the vendored
 * sherpa-onnx glue (public/wasm/sherpa-onnx-asr-stream/sherpa-onnx-asr.js).
 *
 * The worker calls `createOnlineRecognizer(Module, null, modelType)` with the
 * sherpa model-architecture integer derived from the manifest's `asrEngine`.
 * Upstream ships that file as a demo where the architecture is a hardcoded
 * `let type = 0` (transducer) you edit by hand — so the third argument was
 * silently dropped and every streaming model initialised as a transducer.
 * For NeMo CTC packages (single `nemo-ctc.onnx`, no encoder/decoder/joiner)
 * that fails at session start: "transducer encoder './encoder.onnx' does not
 * exist" → "Init failed: function signature mismatch" (participant-mode
 * report, 2026-08-23).
 *
 * The glue runs in a worker via importScripts, so this test evals it in a vm
 * sandbox and swaps the OnlineRecognizer class for a config-capturing stub.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const GLUE_PATH = resolve(
  __dirname, '../../../../public/wasm/sherpa-onnx-asr-stream/sherpa-onnx-asr.js');
const WORKER_PATH = resolve(
  __dirname, '../../../../public/workers/sherpa-onnx-streaming-asr.worker.js');

function makeRecognizer(modelType?: number) {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(GLUE_PATH, 'utf8'), ctx);
  // Class bindings are mutable: replace the real OnlineRecognizer (whose
  // constructor calls into the WASM Module) with a capture stub.
  vm.runInContext(
    'OnlineRecognizer = function (config) { this.capturedConfig = config; };',
    ctx,
  );
  const args = modelType === undefined ? '{}, null' : `{}, null, ${modelType}`;
  return vm.runInContext(`createOnlineRecognizer(${args})`, ctx) as {
    capturedConfig: { modelConfig: Record<string, { model?: string; encoder?: string }> };
  };
}

describe('streaming ASR glue — model-architecture argument', () => {
  it('type 3 (stream-nemo-ctc) builds a NeMo CTC config, not a transducer one', () => {
    const { capturedConfig } = makeRecognizer(3);
    expect(capturedConfig.modelConfig.nemoCtc.model).toBe('./nemo-ctc.onnx');
    expect(capturedConfig.modelConfig.transducer.encoder).toBe('');
  });

  it('omitting the argument keeps the transducer default (existing models)', () => {
    const { capturedConfig } = makeRecognizer();
    expect(capturedConfig.modelConfig.transducer.encoder).toBe('./encoder.onnx');
    expect(capturedConfig.modelConfig.nemoCtc.model).toBe('');
  });

  it('the worker actually passes the model type as the third argument', () => {
    const worker = readFileSync(WORKER_PATH, 'utf8');
    expect(worker).toMatch(/createOnlineRecognizer\(\s*Module\s*,\s*null\s*,\s*modelType\s*\)/);
  });
});
