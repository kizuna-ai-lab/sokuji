import { LocalNativeSessionConfig } from '../interfaces/IClient';
import { useNativeModelStore } from '../../stores/nativeModelStore';
import type { Selections } from '../../lib/local-inference/selection/types';

/**
 * Participant-channel model resolution for Local Native, the local provider
 * the old registry keeps (Stage 2 deletion, ruling 1).
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
