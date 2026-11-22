/**
 * Edge's own settings: the voice each direction speaks in, and the speed. They were the local provider's
 * (`voices[dir].edge`, `ttsSpeed`); `migrate` carries them over while Edge has stored nothing of its own.
 */
import type { MigrationInputs } from '../../lib/provider/types';

export interface EdgeSettings {
  /** An Edge voice (`ShortName`) by direction, keyed `directionKey(src, tgt)`. */
  voices: Record<string, string>;
  speed: number;
}

export const EDGE_DEFAULTS: EdgeSettings = { voices: {}, speed: 1.0 };

/** The local provider's storage keys Edge's values were kept under. */
export const LOCAL_VOICES_KEY = 'settings.localInference.voices';
export const LOCAL_SPEED_KEY = 'settings.localInference.ttsSpeed';

const isTable = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The table's entries that are a non-empty voice name; anything else is dropped. Undefined when none is left. */
function ownVoices(value: unknown): Record<string, string> | undefined {
  if (!isTable(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [dir, voice] of Object.entries(value)) if (typeof voice === 'string' && voice !== '') out[dir] = voice;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Each direction's `.edge` of the local provider's voice table. */
function localVoices(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isTable(value)) return out;
  for (const [dir, entry] of Object.entries(value)) {
    const edge = isTable(entry) ? entry.edge : undefined;
    if (typeof edge === 'string' && edge !== '') out[dir] = edge;
  }
  return out;
}

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * Edge's own stored values win. Where it has stored none, the voices are the local table's Edge voices and the speed
 * the local `ttsSpeed`. Whatever is not a voice name or a finite number is dropped.
 */
export function migrateEdgeSettings(_stored: Readonly<Record<string, unknown>>, inputs: MigrationInputs): EdgeSettings {
  const { legacy } = inputs;
  return {
    voices: ownVoices(legacy.voices) ?? localVoices(legacy[LOCAL_VOICES_KEY]),
    speed: finite(legacy.speed) ?? finite(legacy[LOCAL_SPEED_KEY]) ?? EDGE_DEFAULTS.speed,
  };
}
