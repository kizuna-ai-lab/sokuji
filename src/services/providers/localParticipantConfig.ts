import { LocalInferenceSessionConfig, LocalNativeSessionConfig } from '../interfaces/IClient';
import { estimateModelMemoryByDevice } from '../../lib/local-inference/modelManifest';
import { autoSelectNative, hardwareGated, type NativeSelection } from '../../lib/local-inference/native/nativeCatalog';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import { useModelStore, type ParticipantModelStatus } from '../../stores/modelStore';

/**
 * Participant-channel model re-resolution for the two local providers.
 *
 * Lived in settingsStore.ts by historical accident: these functions read the
 * MODEL stores (modelStore / nativeModelStore) — readiness state — not
 * settings state. They sit beside the descriptors because the descriptors'
 * buildParticipantSessionConfig is their caller, and a descriptor must never
 * import settingsStore (settingsStore imports every descriptor; the reverse
 * edge is a cycle). Descriptor→model-store is established practice
 * (LocalNativeProviderConfig already imports useNativeModelStore).
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
  | { success: true; config: LocalInferenceSessionConfig; status: ParticipantModelStatus }
  | { success: false; reason: ParticipantConfigSkipReason; detail: string };

/**
 * Create a participant session config for local inference by swapping languages
 * and resolving reverse-direction models.
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
  baseConfig: LocalInferenceSessionConfig
): ParticipantLocalInferenceResult {
  const status = useModelStore.getState().getParticipantModelStatus(
    baseConfig.sourceLanguage,
    baseConfig.targetLanguage,
    baseConfig.asrModelId,
    baseConfig.translationModelId,
  );

  if (!status.asrAvailable) {
    return { success: false, reason: 'no_asr', detail: `No ASR model available for ${baseConfig.targetLanguage}` };
  }

  // Memory budget check: estimate total model footprint for main + participant,
  // split by device type (VRAM for WebGPU, RAM for WASM).
  const deviceFeatures = useModelStore.getState().deviceFeatures;
  const allModelIds = [
    baseConfig.asrModelId, baseConfig.translationModelId, baseConfig.ttsModelId,
    status.asrModelId, status.translationModelId,
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
    config: {
      ...baseConfig,
      sourceLanguage: baseConfig.targetLanguage,
      targetLanguage: baseConfig.sourceLanguage,
      asrModelId: status.asrModelId!,
      translationModelId: status.translationModelId ?? undefined,
      ttsModelId: undefined,
    },
    status,
  };
}

export type ParticipantLocalNativeResult =
  | { success: true; config: LocalNativeSessionConfig; translationAvailable: boolean }
  | { success: false; reason: 'no_asr'; detail: string };

/**
 * Build a participant (other-speaker) session config for the native provider.
 *
 * The participant channel translates the OTHER speaker — who speaks the user's
 * TARGET language — so the direction is reversed. Reversing must re-resolve the
 * ASR and translation models, not just swap the language fields, because:
 *   - the native ASR model is language-conditioned; a source-specific ASR can't
 *     transcribe the reversed source language, and
 *   - directional Opus-MT translation models bake the direction into the model
 *     and ignore src/tgt (translate_backends.py), so the speaker-direction model
 *     would translate the wrong way.
 * Multilingual models (qwen*) handle both directions, so for them the
 * re-resolution is a no-op and the same model is reused (no extra memory).
 *
 * Model re-resolution reuses `autoSelectNative` — the same download-/hardware-
 * aware logic the settings UI uses — so an un-downloaded reverse model is never
 * selected; it falls back to a downloaded multilingual model, else to
 * transcription-only. TTS is dropped (participant channel is text-only).
 *
 * Returns `{ success: false, reason: 'no_asr' }` when no ASR model can serve the
 * reversed source language, so the caller can skip the participant channel.
 */
export function createParticipantLocalNativeConfig(
  baseConfig: LocalNativeSessionConfig
): ParticipantLocalNativeResult {
  const store = useNativeModelStore.getState();
  const catalog = store.catalog;
  const statuses = store.statuses;
  const isDownloaded = (id: string | null) => id === null || statuses[id] === 'ready';
  const isHardwareGated = (id: string | null) => id !== null && hardwareGated(catalog[id]);

  // Reversed direction: the participant speaks the user's target language.
  const revSrc = baseConfig.targetLanguage;
  const revTgt = baseConfig.sourceLanguage;

  const current: NativeSelection = {
    asrModel: baseConfig.asrModelId,
    translationModel: baseConfig.translationModelId ?? '',
    ttsModel: '',
  };
  const updates = autoSelectNative(
    revSrc, revTgt, current, isDownloaded, store.recallModels(revSrc, revTgt), isHardwareGated, catalog,
  );
  const asrModel = updates?.asrModel ?? current.asrModel;
  const translationModel = updates?.translationModel ?? current.translationModel;

  if (!asrModel) {
    return { success: false, reason: 'no_asr', detail: `No ASR model available for ${revSrc}` };
  }

  return {
    success: true,
    translationAvailable: !!translationModel,
    config: {
      ...baseConfig,
      sourceLanguage: revSrc,
      targetLanguage: revTgt,
      asrModelId: asrModel,
      translationModelId: translationModel || undefined,
      // Variant pins are keyed by model id: keep the pin only when the reversed
      // direction reuses the same model, else let the sidecar auto-select.
      asrVariant: asrModel === baseConfig.asrModelId ? baseConfig.asrVariant : undefined,
      translationVariant: translationModel === (baseConfig.translationModelId ?? '')
        ? baseConfig.translationVariant : undefined,
      ttsModelId: undefined,
      // TTS is dropped entirely for the participant channel (text-only) — drop
      // its variant pin too, else a stale pin from the base config would leak
      // into a config whose ttsModelId is unconditionally undefined.
      ttsVariant: undefined,
    },
  };
}
