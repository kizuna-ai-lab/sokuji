import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getManifestEntry, segmentLimitFor } from '../modelManifest';
import { DETECTOR_WORKER_TYPES } from '../../turn/turnDetection';

// sherpa-onnx's (a classic script) and Voxtral 4B's (audio and marks) workers have tests of their own: workers/turnDetection.consistency.test.ts.
const OWN_SCRIPT = new Set<string>(['sherpa-onnx', 'voxtral-webgpu']);
const read = (path: string) => readFileSync(join(__dirname, path), 'utf8');
const voxtralRt = read('voxtral-webgpu.worker.ts');
const sherpa = readFileSync(join(__dirname, '../../../../public/workers/sherpa-onnx-asr.worker.js'), 'utf8');

const limit = (id: string, task: 'transcribe' | 'translate' = 'transcribe', language = 'en') =>
  segmentLimitFor(getManifestEntry(id), { task, language });

// The five WebGPU recognizers on the shared detector take the limit from the manifest, through the
// detector's init message, and declare none of their own. The detector worker cuts the turns, so a
// constant left in a recognizer would be a second copy that nothing reads and the manifest test cannot see.
describe('the five recognizers on the detector declare no limit of their own', () => {
  const LIMIT_CONSTANT = /\b(?:WHISPER_MAX_SEGMENT_SAMPLES|VOXTRAL_3B_MAX_SEGMENT_SAMPLES|GRANITE_(?:TRANSLATE_)?MAX_SPEECH_SECONDS|QWEN3_ASR_(?:DEFAULT_)?MAX_SPEECH_SECONDS)\b/;
  it.each(DETECTOR_WORKER_TYPES.filter((type) => !OWN_SCRIPT.has(type)).map((type) => `${type}.worker.ts`))('%s', (name) => {
    expect(read(name)).not.toMatch(LIMIT_CONSTANT);
    expect(read(name)).not.toContain('resolveMaxSpeechFrames');
  });
});

// Voxtral 4B still cuts its own segments until step 3, so its constant stays, pinned. The sherpa-onnx worker keeps its
// own VAD (and its 9 s / 20 s) for a load with no segment port, until step 5; the detector's cut comes from the manifest.
describe('the manifest limit equals the one still in the worker', () => {
  it('Voxtral Realtime: 35 s', () => {
    expect(voxtralRt).toContain('const VOXTRAL_REALTIME_MAX_SPEECH_SECONDS = 35;');
    expect(limit('voxtral-mini-4b-webgpu')).toEqual({ maxSpeechSeconds: 35 });
  });
});

describe('sherpa-onnx worker', () => {
  it("still cuts Moonshine v2 at 9 s and everything else at 20 s for a load with no port; the manifest says it as a 9 s segment, the pad included, and 20 s of speech", () => {
    expect(sherpa).toContain("asrEngine === 'moonshine-v2' ? 9 : 20");
    expect(limit('moonshine-base-zh-quant')).toEqual({ maxSegmentSamples: 9 * 16000 });
    expect(limit('sensevoice-int8')).toEqual({ maxSpeechSeconds: 20 });
  });
});
