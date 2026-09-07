/**
 * Which models a `translation_session_start` reports.
 *
 * A split session runs TWO independently resolved model sets. The participant
 * direction (`target→source`) is a peer of the speaker direction, not a
 * reversal of it: it resolves its own ASR and translation models from its own
 * pool (see localParticipantConfig.ts). Reporting only the speaker's leaves
 * half of every split session invisible — and makes an error raised by the
 * participant leg look like it came from a model the session was never using,
 * which is exactly how issue #504 came to be filed with the wrong root cause.
 *
 * Extracted as a pure function because there is no React rendering harness in
 * this repo (see participantTelemetryWiring.test.ts for the same constraint),
 * so this is the only way the shipped decision is the tested one.
 */

/** The two models a local leg resolves for its own direction. */
export interface LegModels {
  asr: string;
  translation: string;
}

interface MaybeLocalConfig {
  provider: string;
  asrModelId?: string;
  translationModelId?: string;
  ttsModelId?: string;
}

/**
 * Both local providers name these fields identically. Every other provider
 * picks no models of its own, so there is nothing to report for it.
 */
function isLocalProvider(provider: string): boolean {
  return provider === 'local_inference' || provider === 'local_native';
}

/**
 * The participant leg's models, read off the config that leg actually
 * connected with. Null for a non-local provider, and for a leg that built no
 * config at all.
 */
export function legModelsOf(config: MaybeLocalConfig | null | undefined): LegModels | null {
  if (!config || !isLocalProvider(config.provider) || !config.asrModelId) return null;
  return { asr: config.asrModelId, translation: config.translationModelId || 'none' };
}

/**
 * The model-identifying properties of `translation_session_start`.
 *
 * `participantModels` must already be gated on the participant channel having
 * started — a leg that never came up reports nothing, so a stale capture can
 * never be attributed to a later session.
 */
export function sessionModelTelemetry(
  speakerConfig: MaybeLocalConfig,
  participantModels: LegModels | null,
): Record<string, string> {
  const props: Record<string, string> = {};

  if (isLocalProvider(speakerConfig.provider) && speakerConfig.asrModelId) {
    props.asr_model = speakerConfig.asrModelId;
    // 'unknown' and 'none' are the values this event has always used for the
    // speaker leg; kept so existing queries do not have to learn a new spelling.
    props.translation_model = speakerConfig.translationModelId || 'unknown';
    props.tts_model = speakerConfig.ttsModelId || 'none';
  }

  if (participantModels) {
    props.participant_asr_model = participantModels.asr;
    props.participant_translation_model = participantModels.translation;
  }

  return props;
}
