import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getManifestEntry, segmentLimitFor } from '../modelManifest';
import { DETECTOR_WORKER_TYPES } from '../../turn/turnDetection';

const WORKER_FILES: Record<string, string> = {
  'sherpa-onnx': '../../../../public/workers/sherpa-onnx-asr.worker.js',
};
const fileOf = (type: string) => join(__dirname, WORKER_FILES[type] ?? `${type}.worker.ts`);

const limit = (id: string, task: 'transcribe' | 'translate' = 'transcribe', language = 'en') =>
  segmentLimitFor(getManifestEntry(id), { task, language });

// Every recognizer on the shared detector takes the limit from the manifest, through the detector's init message, and
// declares none of its own. The detector worker cuts the turns, so a constant left in a recognizer would be a second
// copy that nothing reads and the manifest test cannot see.
describe('the recognizers on the detector declare no limit of their own', () => {
  const LIMIT_CONSTANT = /\b(?:WHISPER_MAX_SEGMENT_SAMPLES|VOXTRAL_3B_MAX_SEGMENT_SAMPLES|VOXTRAL_REALTIME_MAX_SPEECH_SECONDS|GRANITE_(?:TRANSLATE_)?MAX_SPEECH_SECONDS|QWEN3_ASR_(?:DEFAULT_)?MAX_SPEECH_SECONDS|maxSpeechDuration)\b/;
  it.each([...DETECTOR_WORKER_TYPES])('%s', (type) => {
    const source = readFileSync(fileOf(type), 'utf8');
    expect(source).not.toMatch(LIMIT_CONSTANT);
    expect(source).not.toContain('resolveMaxSpeechFrames');
  });
});

describe('the manifest holds the limits the workers used to carry', () => {
  it("Moonshine v2 is cut at a 9 s segment (the pad included), every other sherpa-onnx model at 20 s, Voxtral Realtime at 35 s", () => {
    expect(limit('moonshine-base-zh-quant')).toEqual({ maxSegmentSamples: 9 * 16000 });
    expect(limit('sensevoice-int8')).toEqual({ maxSpeechSeconds: 20 });
    expect(limit('voxtral-mini-4b-webgpu')).toEqual({ maxSpeechSeconds: 35 });
  });
});
