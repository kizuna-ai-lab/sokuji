import { LocalInferenceSessionConfig, LocalNativeSessionConfig } from '../interfaces/IClient';
import { estimateModelMemoryByDevice } from '../../lib/local-inference/modelManifest';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { useModelStore } from '../../stores/modelStore';
import { guardAstCrossStage } from './astGuard';
import type { Selections } from '../../lib/local-inference/selection/types';

/**
 * Participant-channel model resolution for the two local providers.
 *
 * Lived in settingsStore.ts by historical accident: these functions read the
 * MODEL stores (modelStore / nativeModelStore) — readiness state — not
 * settings state. They sit beside the descriptors because the descriptors'
 * buildParticipantSessionConfig is their caller, and a descriptor must never
 * import settingsStore (settingsStore imports every descriptor; the reverse
 * edge is a cycle — AND, concretely, settingsStore's own static import graph
 * reaches audioStore -> ServiceFactory -> ModernAudioRecorder -> an audio
 * worklet `?url` import that the sandboxed Vite test transform denies
 * outright, so the edge would drag that failure into every test file that
 * merely imports ProviderConfigFactory, which both local descriptors are
 * reachable from). `selections` is threaded in as a parameter instead — the
 * caller (a descriptor's buildParticipantSessionConfig) already has it
 * on `slice` without needing settingsStore, since `slice` IS the live
 * settings slice the caller was handed. Mirrors modelStore.resolve /
 * nativeModelStore.resolve, which take `selections` as a parameter for the
 * same reason.
 *
 * The participant direction (`target→source`) is a PEER of the speaker
 * direction (`source→target`), not a reversal of it: it has its own entry in
 * `selections` and resolves from its own pool via the model store's
 * `resolve()`, exactly like the speaker direction does. Nothing here reverses
 * a field or borrows the speaker's chosen models.
 */

/** Fraction of navigator.deviceMemory used as the system RAM model budget. */
const RAM_BUDGET_RATIO = 0.75;
/** Conservative fallback when navigator.deviceMemory is unavailable (GB). */
const DEFAULT_DEVICE_MEMORY_GB = 4;

/**
 * Read a numeric localStorage debug override, returning null if absent.
 * Override keys:
 *   debug:vram-budget  — VRAM budget in MB (e.g. "8192" for 8 GB)
 *   debug:device-memory — system RAM in GB (e.g. "4")
 */
function readDebugNumber(key: string): number | null {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) {
      const n = Number(v);
      if (!Number.isNaN(n) && n >= 0) return n;
    }
  } catch { /* localStorage unavailable */ }
  return null;
}

export type ParticipantConfigSkipReason = 'no_asr' | 'memory_exceeded';

export type ParticipantLocalInferenceResult =
  | { success: true; translationAvailable: boolean; config: LocalInferenceSessionConfig }
  | { success: false; reason: ParticipantConfigSkipReason; detail: string };

/**
 * Build the participant (other-speaker) config for the WASM local-inference
 * provider. The participant direction is `target→source` — a peer of the
 * speaker direction, not a reversal of it. It has its own entry in
 * `selections` and resolves from its own pool, so nothing here reverses
 * fields or borrows the speaker's memory.
 *
 * Returns `{ success: false }` when participant should be skipped — either
 * because no suitable ASR model exists, or because loading both main and
 * participant models would exceed the estimated memory budget.
 *
 * Memory is checked separately for VRAM (WebGPU models) and system RAM (WASM
 * models). Debug overrides via localStorage:
 *   localStorage.setItem('debug:vram-budget', '4096')   // 4 GB VRAM budget
 *   localStorage.setItem('debug:device-memory', '4')     // simulate 4 GB RAM
 */
export function createParticipantLocalInferenceConfig(
  baseConfig: LocalInferenceSessionConfig,
  selections: Selections
): ParticipantLocalInferenceResult {
  const revSrc = baseConfig.targetLanguage;
  const revTgt = baseConfig.sourceLanguage;
  const rawR = useModelStore.getState().resolve(revSrc, revTgt, selections);
  // AST cross-stage guard — see astGuard.ts. Applies here too: the
  // participant direction resolves asr/translation independently just like
  // the speaker direction does.
  const r = guardAstCrossStage(revSrc, revTgt, selections, rawR,
    (masked) => useModelStore.getState().resolve(revSrc, revTgt, masked));

  if (!r.asr) {
    return { success: false, reason: 'no_asr', detail: `No ASR model available for ${revSrc}` };
  }

  // Memory budget check: estimate total model footprint for main + participant,
  // split by device type (VRAM for WebGPU, RAM for WASM).
  const deviceFeatures = useModelStore.getState().deviceFeatures;
  const allModelIds = [
    baseConfig.asrModelId, baseConfig.translationModelId, baseConfig.ttsModelId,
    r.asr.modelId, r.translation?.modelId,
  ];
  const { vramMb, ramMb } = estimateModelMemoryByDevice(allModelIds, deviceFeatures);

  // VRAM budget — only enforced when explicitly set via localStorage,
  // since there is no reliable API to detect GPU VRAM size.
  const vramBudgetMb = readDebugNumber('debug:vram-budget');
  if (vramBudgetMb !== null && vramMb > vramBudgetMb) {
    const detail = `Total VRAM ~${vramMb}MB exceeds budget ~${vramBudgetMb}MB`;
    console.warn('[LocalInference] Participant skipped — VRAM budget exceeded:', detail);
    return { success: false, reason: 'memory_exceeded', detail };
  }

  // System RAM budget
  const deviceMemoryGb = readDebugNumber('debug:device-memory')
    ?? (navigator as any).deviceMemory
    ?? DEFAULT_DEVICE_MEMORY_GB;
  const ramBudgetMb = Math.round(deviceMemoryGb * RAM_BUDGET_RATIO * 1024);
  if (ramMb > ramBudgetMb) {
    const detail = `Total RAM ~${ramMb}MB exceeds budget ~${ramBudgetMb}MB (device memory: ${deviceMemoryGb}GB)`;
    console.warn('[LocalInference] Participant skipped — RAM budget exceeded:', detail);
    return { success: false, reason: 'memory_exceeded', detail };
  }

  return {
    success: true,
    translationAvailable: Boolean(r.translation),
    config: {
      ...baseConfig,
      sourceLanguage: revSrc,
      targetLanguage: revTgt,
      asrModelId: r.asr.modelId,
      translationModelId: r.translation?.modelId,
      ttsModelId: undefined,
    },
  };
}

export type ParticipantLocalNativeResult =
  | { success: true; config: LocalNativeSessionConfig; translationAvailable: boolean }
  | { success: false; reason: 'no_asr'; detail: string };

/**
 * Build the participant (other-speaker) config. The participant direction is
 * `target→source` — a peer of the speaker direction, not a reversal of it. It
 * has its own entry in `selections` and resolves from its own pool, so
 * nothing here reverses fields or borrows the speaker's memory.
 *
 * TTS is dropped: the participant channel is text-only.
 */
export function createParticipantLocalNativeConfig(
  baseConfig: LocalNativeSessionConfig,
  selections: Selections
): ParticipantLocalNativeResult {
  const revSrc = baseConfig.targetLanguage;
  const revTgt = baseConfig.sourceLanguage;
  const r = useNativeModelStore.getState().resolve(revSrc, revTgt, selections);

  if (!r.asr) {
    return { success: false, reason: 'no_asr', detail: `No ASR model available for ${revSrc}` };
  }

  return {
    success: true,
    translationAvailable: Boolean(r.translation),
    config: {
      ...baseConfig,
      sourceLanguage: revSrc,
      targetLanguage: revTgt,
      asrModelId: r.asr.modelId,
      asrVariant: r.asr.variant,
      translationModelId: r.translation?.modelId,
      translationVariant: r.translation?.variant,
      ttsModelId: undefined,
      ttsVariant: undefined,
    },
  };
}
