import { describe, it, expect } from 'vitest';
import { getManifestEntry, type ModelManifestEntry } from '../local-inference/modelManifest';
import { TURN_DETECTION_DEFAULTS } from './turnDetectionSettings';
import { DETECTOR_WORKER_TYPES, takesOurTurnDetection, turnDetectionOf, turnDetectionScope, type TurnDetectionLeg } from './turnDetection';

/** Compile-time: every detector worker type is a worker type the manifest has. */
const _typesExist: readonly NonNullable<ModelManifestEntry['asrWorkerType']>[] = DETECTOR_WORKER_TYPES;
void _typesExist;

const leg = (id: string, turns: 'auto' | 'manual'): TurnDetectionLeg => ({ entry: getManifestEntry(id), turns, task: 'transcribe', language: 'en' });

describe('turnDetectionOf', () => {
  it.each(['whisper-base-webgpu', 'cohere-transcribe-webgpu', 'granite-speech', 'qwen3-asr-0.6b-webgpu', 'voxtral-mini-3b-webgpu'])('%s is shared', (id) => {
    expect(turnDetectionOf(getManifestEntry(id))).toBe('shared');
  });

  it.each(['sensevoice-int8', 'moonshine-tiny-ja-quant', 'voxtral-mini-4b-webgpu'])('%s is own in step 1 and still takes our settings', (id) => {
    expect(turnDetectionOf(getManifestEntry(id))).toBe('own');
    expect(takesOurTurnDetection(getManifestEntry(id))).toBe(true);
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
    expect(turnDetectionScope([leg('whisper-base-webgpu', 'auto'), leg('sensevoice-int8', 'auto')], td)).toMatchObject({ shown: true, smartOffered: true });
    expect(turnDetectionScope([leg('sensevoice-int8', 'auto')], td)).toMatchObject({ shown: true, smartOffered: false });
    expect(turnDetectionScope([leg('stream-en-kroko', 'auto')], td)).toMatchObject({ shown: false, smartOffered: false });
    expect(turnDetectionScope([], td)).toMatchObject({ shown: false, smartOffered: false });
  });

  it('a manual speaker on Whisper offers Smart only through an automatic participant on Whisper', () => {
    expect(turnDetectionScope([leg('whisper-base-webgpu', 'manual'), leg('sensevoice-int8', 'auto')], td).smartOffered).toBe(false);
    expect(turnDetectionScope([leg('whisper-base-webgpu', 'manual'), leg('whisper-base-webgpu', 'auto')], td).smartOffered).toBe(true);
  });
});
