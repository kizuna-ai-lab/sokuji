import type { ModelManifestEntry } from '../local-inference/modelManifest';

export const SMART_TURN_MODEL_ID = 'smart-turn-v3.2';

export type VadEndOfTurn = 'normal' | 'smart';

/** The vad-web workers that wire the gate (workers/turnGate.consistency.test.ts). */
export const SMART_TURN_WORKER_TYPES = [
  'whisper-webgpu',
  'granite-speech-webgpu',
  'qwen3-asr-webgpu',
  'cohere-transcribe-webgpu',
  'voxtral-3b-webgpu',
] as const satisfies readonly NonNullable<ModelManifestEntry['asrWorkerType']>[];

export const SMART_TURN_CHECK_AFTER_RANGE = { min: 0.1, max: 0.5, step: 0.05 } as const;
export const SMART_TURN_THRESHOLD_RANGE = { min: 0.3, max: 0.9, step: 0.05 } as const;

export function supportsSmartTurn(entry: { asrWorkerType?: string } | undefined): boolean {
  return (SMART_TURN_WORKER_TYPES as readonly string[]).includes(entry?.asrWorkerType ?? '');
}

/** At most 0.2 s under Max Wait; null when that leaves under 0.10 s. */
export function effectiveCheckAfter(checkAfter: number, maxWait: number): number | null {
  const cap = Math.round((maxWait - 0.2) * 100) / 100;
  return cap < SMART_TURN_CHECK_AFTER_RANGE.min ? null : Math.min(checkAfter, cap);
}
