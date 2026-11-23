/**
 * Turn detection as the app stores it (`settings.turnDetection.*`): one set of values every local recognizer reads.
 * Pure: the types, defaults, ranges, the one-time migration from the local provider's old keys, and the VAD config
 * those values make.
 */
import type { VadWebConfig } from '../local-inference/types';
import {
  effectiveCheckAfter,
  SMART_TURN_CHECK_AFTER_RANGE,
  SMART_TURN_THRESHOLD_RANGE,
  type VadEndOfTurn,
} from './smartTurn';

export interface TurnDetectionSettings {
  threshold: number;
  negativeThreshold: number;
  minSilence: number;
  minSpeech: number;
  prePad: number;
  maxSpeech: number;
  endOfTurn: VadEndOfTurn;
  smartTurnCheckAfter: number;
  smartTurnThreshold: number;
}

type NumericField = Exclude<keyof TurnDetectionSettings, 'endOfTurn'>;

export const TURN_DETECTION_DEFAULTS: TurnDetectionSettings = {
  threshold: 0.3,
  negativeThreshold: 0,
  minSilence: 1.4,
  minSpeech: 0.4,
  prePad: 0.8,
  maxSpeech: 30,
  endOfTurn: 'normal',
  smartTurnCheckAfter: 0.3,
  smartTurnThreshold: 0.5,
};

/** The slider range of each numeric field. A negative threshold may not pass the threshold (see `clampTurnDetection`). */
export const TURN_DETECTION_RANGES: Record<NumericField, { min: number; max: number; step: number }> = {
  threshold: { min: 0.1, max: 0.95, step: 0.05 },
  negativeThreshold: { min: 0, max: 0.95, step: 0.05 },
  minSilence: { min: 0.05, max: 2, step: 0.05 },
  minSpeech: { min: 0.05, max: 1, step: 0.05 },
  prePad: { min: 0, max: 2, step: 0.05 },
  maxSpeech: { min: 10, max: 40, step: 5 },
  smartTurnCheckAfter: SMART_TURN_CHECK_AFTER_RANGE,
  smartTurnThreshold: SMART_TURN_THRESHOLD_RANGE,
};

export const TURN_DETECTION_PREFIX = 'settings.turnDetection';

/** The old key of each field, under `settings.localInference.`: read once by the migration. */
export const LEGACY_TURN_DETECTION_FIELDS: Record<keyof TurnDetectionSettings, string> = {
  threshold: 'vadThreshold',
  negativeThreshold: 'vadNegativeThreshold',
  minSilence: 'vadMinSilenceDuration',
  minSpeech: 'vadMinSpeechDuration',
  prePad: 'vadPreSpeechPadDuration',
  maxSpeech: 'vadMaxSpeechDuration',
  endOfTurn: 'vadEndOfTurn',
  smartTurnCheckAfter: 'smartTurnCheckAfter',
  smartTurnThreshold: 'smartTurnThreshold',
};

const NUMERIC_FIELDS = Object.keys(TURN_DETECTION_RANGES) as NumericField[];
const END_OF_TURN: readonly VadEndOfTurn[] = ['normal', 'smart'];

/**
 * The valid part of raw values, clamped to range: a value that is not a finite number, or not a member of its enum,
 * is dropped. A negative threshold above the threshold (this one's, else the default) reads as 0.
 */
export function clampTurnDetection(raw: Partial<Record<keyof TurnDetectionSettings, unknown>>): Partial<TurnDetectionSettings> {
  const out: Partial<TurnDetectionSettings> = {};
  for (const field of NUMERIC_FIELDS) {
    const v = raw[field];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const { min, max } = TURN_DETECTION_RANGES[field];
    out[field] = Math.min(max, Math.max(min, v));
  }
  if (typeof raw.endOfTurn === 'string' && (END_OF_TURN as readonly string[]).includes(raw.endOfTurn)) {
    out.endOfTurn = raw.endOfTurn as VadEndOfTurn;
  }
  if (out.negativeThreshold !== undefined && out.negativeThreshold > (out.threshold ?? TURN_DETECTION_DEFAULTS.threshold)) {
    out.negativeThreshold = 0;
  }
  return out;
}

/**
 * The settings a launch reads, and what to write so the old values are taken once. Both arguments are keyed by the
 * new names. A valid stored value wins and is never written again; each other field takes its clamped legacy value
 * (written) or the default.
 */
export function migrateTurnDetection(
  stored: Partial<Record<keyof TurnDetectionSettings, unknown>>,
  legacy: Partial<Record<keyof TurnDetectionSettings, unknown>>,
): { settings: TurnDetectionSettings; writes: Partial<TurnDetectionSettings> } {
  const have = clampTurnDetection(stored);
  const old = clampTurnDetection(legacy);
  const writes: Partial<TurnDetectionSettings> = {};
  for (const field of Object.keys(old) as Array<keyof TurnDetectionSettings>) {
    if (have[field] === undefined) (writes as Record<string, unknown>)[field] = old[field];
  }
  const settings = { ...TURN_DETECTION_DEFAULTS, ...writes, ...have };
  if (settings.negativeThreshold > settings.threshold) settings.negativeThreshold = 0;
  return { settings, writes };
}

/**
 * The VAD the local recognizers are configured with. `smart`: this model's worker takes Smart Turn. The negative
 * threshold is there only when set; Smart Turn only when asked for and stored, its check capped under Max Wait.
 */
export function vadConfigOf(td: TurnDetectionSettings, smart: boolean): VadWebConfig {
  const vad: VadWebConfig = {
    threshold: td.threshold,
    minSilenceDuration: td.minSilence,
    minSpeechDuration: td.minSpeech,
    maxSpeechDuration: td.maxSpeech,
    preSpeechPadDuration: td.prePad,
  };
  if (td.negativeThreshold) vad.negativeThreshold = td.negativeThreshold;
  if (smart && td.endOfTurn === 'smart') {
    const checkAfter = effectiveCheckAfter(td.smartTurnCheckAfter, td.minSilence);
    if (checkAfter !== null) vad.smartTurn = { checkAfter, threshold: td.smartTurnThreshold };
  }
  return vad;
}
