/**
 * Which legs our turn detection serves, decided per leg from the resolved model.
 * `shared`: the app's detector (VAD, and Smart Turn where stored) ends the turn. `own`: the model ends it itself.
 */
import type { DetectorDelivery } from '../local-inference/workers/_shared/turn-detector-protocol';
import { segmentLimitFor, type ModelManifestEntry } from '../local-inference/modelManifest';
import { resolveMaxSpeechFrames } from '../local-inference/workers/_shared/max-speech-frames';
import type { TurnDetectionSettings } from './turnDetectionSettings';

export type TurnDetection = 'shared' | 'own';

/**
 * The workers that take the detector's output (workers/turnDetection.consistency.test.ts): the segment recognizers, and
 * 'voxtral-webgpu' (Voxtral 4B), which takes the audio with marks. An `asr` entry with no `asrWorkerType` is sherpa-onnx's;
 * an `asr-stream` one with none is sherpa streaming, which cuts its own turns.
 */
export const DETECTOR_WORKER_TYPES = [
  'sherpa-onnx',
  'voxtral-webgpu',
  'whisper-webgpu',
  'cohere-transcribe-webgpu',
  'granite-speech-webgpu',
  'qwen3-asr-webgpu',
  'voxtral-3b-webgpu',
] as const;

type Entry = Pick<ModelManifestEntry, 'type' | 'asrWorkerType'> | undefined;

export function turnDetectionOf(entry: Entry): TurnDetection {
  if (!entry) return 'own';
  let worker: string | undefined;
  if (entry.type === 'asr') worker = entry.asrWorkerType ?? 'sherpa-onnx';
  else if (entry.type === 'asr-stream') worker = entry.asrWorkerType;
  return worker !== undefined && (DETECTOR_WORKER_TYPES as readonly string[]).includes(worker) ? 'shared' : 'own';
}

/** What a `shared` leg's recognizer takes from the detector: Voxtral 4B holds the audio itself and takes it with marks. */
export function detectorDeliveryOf(entry: Entry): DetectorDelivery {
  return entry?.type === 'asr-stream' && entry.asrWorkerType === 'voxtral-webgpu' ? 'marks' : 'segments';
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

/**
 * Local Native's scope: its sidecar's models are not manifest entries, so the legs say only whether their turns are
 * automatic. Every leg takes the app's turn detection; Smart is offered through an automatic one; `capSeconds` is the
 * longest speech the sidecar's backstops allow a segment.
 */
export function nativeTurnDetectionScope(turns: readonly ('auto' | 'manual')[], td: TurnDetectionSettings, capSeconds: number): TurnDetectionScope {
  const scope: TurnDetectionScope = { shown: turns.length > 0, smartOffered: turns.includes('auto') };
  if (turns.length > 0 && capSeconds < td.maxSpeech) scope.limitSeconds = capSeconds;
  return scope;
}
