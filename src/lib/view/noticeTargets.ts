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
};

export function settingsTargetForCode(code: string | undefined): string | null {
  return code === undefined ? null : NOTICE_TARGETS[code] ?? null;
}
