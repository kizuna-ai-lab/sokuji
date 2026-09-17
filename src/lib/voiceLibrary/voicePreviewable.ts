/**
 * Whether a voice can be auditioned.
 *
 * `previewable` absent means "inherit the group default": a cloned voice can
 * (a clip or a cloned voice stands behind it), a preset cannot (most providers
 * publish no way to synthesize one). A provider whose presets ARE auditionable
 * sets the flag on those entries — Soniox, whose preset id is the TTS
 * request's `voice` field, and Local Native, which synthesizes a preset on its
 * dedicated preview connection. A disabled entry never auditions: a clone
 * still processing or a "(deleted voice)" placeholder has nothing playable
 * behind it.
 *
 * Takes the fields it reads rather than a whole `VoiceEntry` so it stays a
 * pure function with no dependency on the component module.
 */
export function canAuditionVoice(v: {
  group: 'builtin' | 'custom';
  previewable?: boolean;
  disabled?: boolean;
}): boolean {
  if (v.disabled) return false;
  return v.previewable ?? v.group === 'custom';
}
