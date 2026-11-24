/**
 * Which legs our turn detection serves, decided per leg from the resolved model.
 * `shared`: the app's detector (VAD, and Smart Turn where stored) ends the turn. `own`: the model ends it itself.
 */
import { segmentLimitFor, type ModelManifestEntry } from '../local-inference/modelManifest';
import { resolveMaxSpeechFrames } from '../local-inference/workers/_shared/max-speech-frames';
import type { TurnDetectionSettings } from './turnDetectionSettings';

export type TurnDetection = 'shared' | 'own';

/** The vad-web workers that wire the gate (workers/turnDetection.consistency.test.ts). Step 2 adds 'sherpa-onnx' for `type: 'asr'`; step 3 'voxtral-webgpu'. */
export const DETECTOR_WORKER_TYPES = [
  'whisper-webgpu',
  'cohere-transcribe-webgpu',
  'granite-speech-webgpu',
  'qwen3-asr-webgpu',
  'voxtral-3b-webgpu',
] as const;

type Entry = Pick<ModelManifestEntry, 'type' | 'asrWorkerType'> | undefined;

export function turnDetectionOf(entry: Entry): TurnDetection {
  return entry?.type === 'asr' && (DETECTOR_WORKER_TYPES as readonly (string | undefined)[]).includes(entry.asrWorkerType)
    ? 'shared'
    : 'own';
}

/** Whether the settings panel applies to the model: every 'asr' entry, and an 'asr-stream' one with a worker type (Voxtral 4B). Deleted in step 5, when it equals `turnDetectionOf(e) === 'shared'`. */
export function takesOurTurnDetection(entry: Entry): boolean {
  if (!entry) return false;
  return entry.type === 'asr' || (entry.type === 'asr-stream' && !!entry.asrWorkerType);
}

export interface TurnDetectionLeg {
  entry: ModelManifestEntry | undefined;
  turns: 'auto' | 'manual';
  task: 'transcribe' | 'translate';
  language: string;
}

export interface TurnDetectionScope {
  shown: boolean;
  smartOffered: boolean;
  /** The longest segment, in seconds, the shown legs' recognizers are handed; set only when below Max speech. */
  limitSeconds?: number;
}

const VAD_FRAME_SECONDS = 0.032;

export function turnDetectionScope(legs: readonly TurnDetectionLeg[], td: TurnDetectionSettings): TurnDetectionScope {
  const shownLegs = legs.filter((l) => takesOurTurnDetection(l.entry));
  const scope: TurnDetectionScope = {
    shown: shownLegs.length > 0,
    smartOffered: legs.some((l) => l.turns === 'auto' && turnDetectionOf(l.entry) === 'shared'),
  };
  const frames = shownLegs.map((l) => resolveMaxSpeechFrames(td.maxSpeech, td.prePad * 1000, segmentLimitFor(l.entry, l)));
  if (frames.length > 0) {
    const limitSeconds = Math.round(Math.min(...frames) * VAD_FRAME_SECONDS * 10) / 10;
    if (limitSeconds < td.maxSpeech) scope.limitSeconds = limitSeconds;
  }
  return scope;
}
