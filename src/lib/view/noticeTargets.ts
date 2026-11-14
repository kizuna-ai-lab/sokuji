/**
 * The Settings section a notice's code asks the user to visit —
 * `reasonToSettingsTarget`'s successor (spec: "Notices reach the user
 * localized"). A target is `navigateToSettings`'s: the section's element id
 * without `-section`.
 */
export const NOTICE_TARGETS: Readonly<Record<string, string>> = {
  no_microphone: 'microphone',
  // A Windows microphone that would not open: besides closing the application holding it, choose another (spec 2026-10-13 §3).
  mic_in_use: 'microphone',
  mic_unreadable: 'microphone',
  // The settings page splits what the old provider section held: choosing a provider is the line-up's
  // stage rows, a key or a sign-in is "Accounts and keys" ('provider'), and models, memory and voices are
  // the provider's own options under the line-up ('provider-options').
  no_provider: 'lineup',
  credentials_missing: 'provider',
  // A managed provider signed out: the provider section's account row carries the sign-in link (Stage 2 Kizuna Soniox).
  sign_in_required: 'provider',
  // The missing models are chosen and downloaded in the local engine, among the provider's options.
  local_models_missing: 'provider-options',
  no_asr: 'provider-options',
  memory_exceeded: 'provider-options',
  gpu_out_of_memory: 'provider-options',
  turn_mode_unsupported: 'turn-detection',
  participant_unsupported: 'languages',
  // Gemini's and OpenAI's model codes say the key lists no model: the fix is another key, in "Accounts and keys".
  no_realtime_model: 'provider',
  models_required: 'provider',
  // OpenAI Translate's check codes (Stage 2 OpenAI Translate): the key's own limits, in "Accounts and keys".
  no_translate_model: 'provider',
  region_unsupported: 'provider',
  // The run continues on another voice (spec 2026-10-05 §2): the voices are the provider's own
  // options. Not `voice-settings`: that id is the prebuilt-voice fields' and Soniox's voice
  // section, and the local voices are not drawn there.
  voice_clip_missing: 'provider-options',
  voice_pool_busy: 'provider-options',
  voice_build_failed: 'provider-options',
  voice_unavailable: 'provider-options',
  voice_fallback: 'provider-options',
};

export function settingsTargetForCode(code: string | undefined): string | null {
  return code === undefined ? null : NOTICE_TARGETS[code] ?? null;
}
