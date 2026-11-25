import { describe, it, expect } from 'vitest';
import { asrLimitOf, getManifestEntry, MODEL_MANIFEST, segmentLimitFor } from './modelManifest';
import { resolveMaxSpeechFrames } from './workers/_shared/max-speech-frames';
import { DETECTOR_WORKER_TYPES } from '../turn/turnDetection';

const entry = (id: string) => {
  const e = getManifestEntry(id);
  if (!e) throw new Error(`no manifest entry ${id}`);
  return e;
};
const transcribe = (language: string) => ({ task: 'transcribe' as const, language });

describe('segmentLimitFor', () => {
  it('Whisper: a 29 s segment, 881 frames at a 30 s setting and a 0.8 s pad (28.992 s)', () => {
    expect(segmentLimitFor(entry('whisper-base-webgpu'), transcribe('ja'))).toEqual({ maxSegmentSamples: 464000 });
    expect(resolveMaxSpeechFrames(30, 800, { maxSegmentSamples: 464000 })).toBe(881);
  });

  it('resolves Qwen3-ASR by primary subtag and Granite by task', () => {
    const q = entry('qwen3-asr-0.6b-webgpu');
    expect(segmentLimitFor(q, transcribe('hi-IN'))).toEqual({ maxSpeechSeconds: 15 });
    expect(segmentLimitFor(q, transcribe('th_TH'))).toEqual({ maxSpeechSeconds: 20 });
    expect(segmentLimitFor(q, transcribe('zh-Hant'))).toEqual({ maxSpeechSeconds: 40 });
    expect(segmentLimitFor(entry('granite-speech'), { task: 'translate', language: 'en' })).toEqual({ maxSpeechSeconds: 20 });
    expect(segmentLimitFor(entry('granite-speech-4.1-2b'), transcribe('en'))).toEqual({ maxSpeechSeconds: 30 });
  });

  it.each([
    ['voxtral-mini-3b-webgpu', { maxSegmentSamples: 480000 }],
    ['cohere-transcribe-webgpu', {}],
    ['voxtral-mini-4b-webgpu', { maxSpeechSeconds: 35 }],
    ['moonshine-tiny-ja-quant', { maxSegmentSamples: 9 * 16000 }],
    ['sensevoice-int8', { maxSpeechSeconds: 20 }],
  ])('%s', (id, limit) => {
    expect(segmentLimitFor(entry(id), transcribe('ja'))).toEqual(limit);
  });

  it('a language that is a prototype key falls back to the default, never a function', () => {
    const q = entry('qwen3-asr-0.6b-webgpu');
    for (const language of ['constructor', 'toString', '__proto__']) {
      const limit = segmentLimitFor(q, transcribe(language));
      expect(typeof limit.maxSpeechSeconds).toBe('number');
    }
  });
  it('an unknown model has no limit', () => {
    expect(segmentLimitFor(undefined, transcribe('en'))).toEqual({});
  });
});

describe('asrLimitOf', () => {
  it('the nine Moonshine v2 entries declare a 9 s segment, the pad included', () => {
    const moonshine = MODEL_MANIFEST.filter((e) => e.asrEngine === 'moonshine-v2');
    expect(moonshine).toHaveLength(9);
    for (const e of moonshine) expect(asrLimitOf(e)).toEqual({ kind: 'segment', seconds: 9 });
  });

  it('a sherpa offline entry falls back to the 20 s the worker always used; a streaming one has none', () => {
    expect(asrLimitOf(entry('sensevoice-int8'))).toEqual({ kind: 'speech', seconds: 20 });
    expect(asrLimitOf(entry('stream-en-kroko'))).toBeUndefined();
  });

  it('every entry of a detector worker type except Cohere declares a limit', () => {
    const detector = MODEL_MANIFEST.filter((e) => (DETECTOR_WORKER_TYPES as readonly (string | undefined)[]).includes(e.asrWorkerType));
    expect(detector.length).toBeGreaterThan(0);
    for (const e of detector) {
      if (e.asrWorkerType === 'cohere-transcribe-webgpu') expect(e.asrLimit, e.id).toBeUndefined();
      else expect(e.asrLimit, e.id).toBeDefined();
    }
  });
});
