/**
 * The Settings section a notice's code asks the user to visit —
 * `reasonToSettingsTarget`'s successor (spec: "Notices reach the user
 * localized"). A target is `navigateToSettings`'s: the section's element id
 * without `-section`.
 */
export const NOTICE_TARGETS: Readonly<Record<string, string>> = {
  no_microphone: 'microphone',
  no_provider: 'provider',
  credentials_missing: 'provider',
  // A managed provider signed out: the provider section's account row carries the sign-in link (Stage 2 Kizuna Soniox).
  sign_in_required: 'provider',
  // Ruling 5's fix: the missing-models gap is shown as amber "None" chips
  // under the picker, each a link to its slot — the same target the
  // engine-chip flash flow uses, not `model-management` (a pushed page's
  // section, never rendered where Settings would highlight it — review
  // Minor 2).
  local_models_missing: 'provider',
  no_asr: 'provider',
  memory_exceeded: 'provider',
  gpu_out_of_memory: 'provider',
  turn_mode_unsupported: 'turn-detection',
  participant_unsupported: 'languages',
  // Gemini's model codes (Stage 2 Gemini): the key and the model are the provider section's.
  no_realtime_model: 'provider',
  models_required: 'provider',
  // OpenAI Translate's check codes (Stage 2 OpenAI Translate): the key, and the choice of another provider, are the provider section's.
  no_translate_model: 'provider',
  region_unsupported: 'provider',
  // The run continues on another voice (spec 2026-10-05 §2): the voice picker is the provider
  // section's. Not `voice-settings`: that id is only the prebuilt-voice field, and Soniox's
  // custom voice and the local voices are not drawn there.
  voice_clip_missing: 'provider',
  voice_pool_busy: 'provider',
  voice_build_failed: 'provider',
  voice_unavailable: 'provider',
  voice_fallback: 'provider',
};

export function settingsTargetForCode(code: string | undefined): string | null {
  return code === undefined ? null : NOTICE_TARGETS[code] ?? null;
}
