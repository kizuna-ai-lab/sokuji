import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getManifestEntry, segmentLimitFor } from '../modelManifest';

const read = (path: string) => readFileSync(join(__dirname, path), 'utf8');
const whisper = read('whisper-webgpu.worker.ts');
const voxtral3b = read('voxtral-3b-webgpu.worker.ts');
const granite = read('granite-speech-webgpu.worker.ts');
const qwen3 = read('qwen3-asr-webgpu.worker.ts');
const voxtralRt = read('voxtral-webgpu.worker.ts');
const sherpa = readFileSync(join(__dirname, '../../../../public/workers/sherpa-onnx-asr.worker.js'), 'utf8');

const limit = (id: string, task: 'transcribe' | 'translate' = 'transcribe', language = 'en') =>
  segmentLimitFor(getManifestEntry(id), { task, language });

// Task 13 deletes the five WebGPU workers' constants; the pins for those five go with them.
describe('the manifest limit equals the one still in the worker', () => {
  it('Whisper: 29 s segment', () => {
    expect(whisper).toContain('const WHISPER_MAX_SEGMENT_SAMPLES = 29 * VAD_SAMPLE_RATE;');
    expect(limit('whisper-small-webgpu')).toEqual({ maxSegmentSamples: 29 * 16000 });
  });
  it('Voxtral 3B: 30 s segment', () => {
    expect(voxtral3b).toContain('const VOXTRAL_3B_MAX_SEGMENT_SAMPLES = 30 * VAD_SAMPLE_RATE;');
    expect(limit('voxtral-mini-3b-webgpu')).toEqual({ maxSegmentSamples: 30 * 16000 });
  });
  it('Granite: 30 s, 20 s translating', () => {
    expect(granite).toContain('const GRANITE_MAX_SPEECH_SECONDS = 30;');
    expect(granite).toContain('const GRANITE_TRANSLATE_MAX_SPEECH_SECONDS = 20;');
    expect(limit('granite-speech')).toEqual({ maxSpeechSeconds: 30 });
    expect(limit('granite-speech', 'translate')).toEqual({ maxSpeechSeconds: 20 });
  });
  it('Qwen3-ASR: 15 s Hindi, 20 s Thai, 40 s otherwise', () => {
    expect(qwen3).toContain('{ hi: 15, th: 20 }');
    expect(qwen3).toContain('const QWEN3_ASR_DEFAULT_MAX_SPEECH_SECONDS = 40;');
    expect(limit('qwen3-asr-1.7b-webgpu', 'transcribe', 'hi')).toEqual({ maxSpeechSeconds: 15 });
    expect(limit('qwen3-asr-1.7b-webgpu', 'transcribe', 'th')).toEqual({ maxSpeechSeconds: 20 });
    expect(limit('qwen3-asr-1.7b-webgpu')).toEqual({ maxSpeechSeconds: 40 });
  });
  it('Voxtral Realtime: 35 s', () => {
    expect(voxtralRt).toContain('const VOXTRAL_REALTIME_MAX_SPEECH_SECONDS = 35;');
    expect(limit('voxtral-mini-4b-webgpu')).toEqual({ maxSpeechSeconds: 35 });
  });
});

describe('sherpa-onnx worker', () => {
  it("cuts Moonshine v2 at 9 s and everything else at 20 s, as the manifest says", () => {
    expect(sherpa).toContain("asrEngine === 'moonshine-v2' ? 9 : 20");
    expect(limit('moonshine-base-zh-quant')).toEqual({ maxSpeechSeconds: 9 });
    expect(limit('sensevoice-int8')).toEqual({ maxSpeechSeconds: 20 });
  });
});
