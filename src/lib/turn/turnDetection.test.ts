import { describe, it, expect } from 'vitest';
import { getManifestEntry, type ModelManifestEntry } from '../local-inference/modelManifest';
import { TURN_DETECTION_DEFAULTS } from './turnDetectionSettings';
import { DETECTOR_WORKER_TYPES, detectorDeliveryOf, takesOurTurnDetection, turnDetectionOf, turnDetectionScope, type TurnDetectionLeg } from './turnDetection';

/** Compile-time: every detector worker type is a worker type the manifest has. */
const _typesExist: readonly NonNullable<ModelManifestEntry['asrWorkerType']>[] = DETECTOR_WORKER_TYPES;
void _typesExist;

const leg = (id: string, turns: 'auto' | 'manual'): TurnDetectionLeg => ({ entry: getManifestEntry(id), turns, task: 'transcribe', language: 'en' });

describe('turnDetectionOf', () => {
  it.each(['whisper-base-webgpu', 'cohere-transcribe-webgpu', 'granite-speech', 'qwen3-asr-0.6b-webgpu', 'voxtral-mini-3b-webgpu', 'sensevoice-int8', 'moonshine-tiny-ja-quant', 'voxtral-mini-4b-webgpu'])('%s is shared', (id) => {
    expect(turnDetectionOf(getManifestEntry(id))).toBe('shared');
  });

  it('Voxtral 4B takes the audio with marks; every other shared model takes segments', () => {
    expect(detectorDeliveryOf(getManifestEntry('voxtral-mini-4b-webgpu'))).toBe('marks');
    for (const id of ['whisper-base-webgpu', 'sensevoice-int8', 'voxtral-mini-3b-webgpu']) {
      expect(detectorDeliveryOf(getManifestEntry(id))).toBe('segments');
    }
  });

  it('a streaming sherpa model is own and takes none', () => {
    expect(turnDetectionOf(getManifestEntry('stream-en-kroko'))).toBe('own');
    expect(takesOurTurnDetection(getManifestEntry('stream-en-kroko'))).toBe(false);
  });

  it('an unknown model is own and takes none', () => {
    expect(turnDetectionOf(undefined)).toBe('own');
    expect(takesOurTurnDetection(undefined)).toBe(false);
  });
});

describe('turnDetectionScope', () => {
  const td = TURN_DETECTION_DEFAULTS;

  it('shows the settings when any leg takes them, and offers Smart only through an automatic leg on a shared model', () => {
    expect(turnDetectionScope([leg('stream-en-kroko', 'auto'), leg('sensevoice-int8', 'auto')], td)).toMatchObject({ shown: true, smartOffered: true });
    expect(turnDetectionScope([leg('voxtral-mini-4b-webgpu', 'manual')], td)).toMatchObject({ shown: true, smartOffered: false });
    expect(turnDetectionScope([leg('stream-en-kroko', 'auto')], td)).toMatchObject({ shown: false, smartOffered: false });
    expect(turnDetectionScope([], td)).toMatchObject({ shown: false, smartOffered: false });
  });

  it('a manual speaker on Whisper offers Smart only through an automatic participant on Whisper', () => {
    expect(turnDetectionScope([leg('whisper-base-webgpu', 'manual'), leg('stream-en-kroko', 'auto')], td).smartOffered).toBe(false);
    expect(turnDetectionScope([leg('whisper-base-webgpu', 'manual'), leg('whisper-base-webgpu', 'auto')], td).smartOffered).toBe(true);
  });

  it('the Max speech note: 28.2 s for Whisper at 30 s with a 0.8 s pad, none at 20 s', () => {
    const whisper = leg('whisper-base-webgpu', 'auto');
    expect(turnDetectionScope([whisper], td).limitSeconds).toBe(28.2);
    expect(turnDetectionScope([whisper], { ...td, maxSpeech: 20 })).not.toHaveProperty('limitSeconds');
  });

  it('takes the smallest limit over the legs shown', () => {
    expect(turnDetectionScope([leg('whisper-base-webgpu', 'auto'), leg('moonshine-tiny-ja-quant', 'auto')], td).limitSeconds).toBe(8.2); // 9 s of segment less the 0.8 s pad
  });

  it('a model with no limit sets none', () => {
    expect(turnDetectionScope([leg('cohere-transcribe-webgpu', 'auto')], td)).not.toHaveProperty('limitSeconds');
  });
});
