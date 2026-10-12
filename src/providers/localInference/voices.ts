import { getManifestEntry } from '../../lib/local-inference/modelManifest';
import type { DirectionVoice, LocalInferenceSettings } from './settings';

/**
 * A direction's stored voice, read field by field (#619). Local inference has
 * no `migrate`, so `voices` holds whatever was stored: a table that is not an
 * object, an entry that is not one, or a field of the wrong kind reads as
 * absent. Nothing is converted or written back.
 */
export function directionVoice(voices: LocalInferenceSettings['voices'], dir: string): DirectionVoice {
  // An array is an object too, and never a table of directions.
  const entry: unknown = voices && typeof voices === 'object' && !Array.isArray(voices) ? voices[dir] : undefined;
  if (!entry || typeof entry !== 'object') return {};
  const { edge, speaker } = entry as Record<string, unknown>;
  return {
    ...(typeof edge === 'string' && edge !== '' ? { edge } : {}),
    ...(typeof speaker === 'number' && Number.isFinite(speaker) ? { speaker } : {}),
  };
}

/** The speaker id a run uses: the direction's own, else the model's default (`ttsConfig.defaultSid`, Supertonic's 7), else 0. */
export function speakerIdFor(voice: DirectionVoice, modelId: string): number {
  return voice.speaker ?? getManifestEntry(modelId)?.ttsConfig?.defaultSid ?? 0;
}

/** The settings patch writing `patch` into one direction's entry; its other field and every other direction's entry stay as stored. */
export function withDirectionVoice(voices: LocalInferenceSettings['voices'], dir: string, patch: DirectionVoice): Pick<LocalInferenceSettings, 'voices'> {
  const table = voices && typeof voices === 'object' && !Array.isArray(voices) ? voices : {};
  return { voices: { ...table, [dir]: { ...directionVoice(table, dir), ...patch } } };
}
