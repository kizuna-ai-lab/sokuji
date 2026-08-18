/**
 * Pure label-based virtual/loopback audio device detection.
 *
 * Deliberately has no dependency on React or any UI layer — it's used both by
 * Settings device pickers (a React component tree) and by
 * ModernBrowserAudioService (a low-level service that should stay usable and
 * testable outside the React bundle).
 */

interface LabeledDevice {
  label: string;
}

interface HoverableDevice {
  label: string;
  windowTitles?: string[];
}

/**
 * Hover text for a device row.
 *
 * A per-application capture source is a process tree, and one tree owns as many
 * windows as the user opened - two Chrome windows are a single source that no
 * desktop platform can split. The row is therefore named after the application,
 * and the windows it covers are listed here, so "Google Chrome" is not silently
 * standing in for three of them. Ordinary devices keep their label as the title.
 */
export const describeDeviceOnHover = (device: HoverableDevice): string | undefined => {
  const titles = device.windowTitles?.filter((t) => t) ?? [];
  if (titles.length === 0) return device.label || undefined;
  return [device.label, ...titles.map((t) => `• ${t}`)].filter(Boolean).join('\n');
};

/**
 * Check if a device is a virtual device that should be filtered or warned about
 */
export const isVirtualDevice = (device: LabeledDevice): boolean => {
  const label = device.label.toLowerCase();
  return label.includes('sokuji_virtual_mic') ||
         label.includes('sokuji_virtual_speaker') ||
         label.includes('sokuji virtual output') || // Windows display name
         label.includes('sokujivirtualaudio') || // Mac virtual device
         label.includes('cable');
};

/**
 * Check if a device is a virtual microphone
 */
export const isVirtualMic = (device: LabeledDevice): boolean => {
  const label = device.label.toLowerCase();
  return label.includes('sokuji_virtual_mic') ||
         // The monitor of Sokuji's own virtual speaker ("Monitor of
         // Sokuji_Virtual_Speaker" on PulseAudio) carries Sokuji's TTS output
         // verbatim; used as the mic it is a guaranteed feedback loop.
         label.includes('sokuji_virtual_speaker') ||
         label.includes('sokujivirtualaudio') ||
         label.includes('cable');
};

/**
 * OS loopback-style inputs that re-capture whatever the machine is playing —
 * which during a session includes Sokuji's own TTS. Unlike Sokuji's virtual
 * devices these are legitimate OS devices a user may have deliberately wired
 * up (VoiceMeeter routing setups in particular), so callers warn on manual
 * selection and skip them for automatic selection, but never hide or block
 * them.
 *
 * Matching is deliberately narrow: 'monitor of ' is prefix-only (the
 * PulseAudio/PipeWire sink-monitor naming) so a product name containing the
 * words is not caught, and plain 'mix' / generic 'output' are not matched at
 * all — they appear in hardware people record with ("MixPre-3", mixers).
 */
export const isLoopbackInput = (device: LabeledDevice): boolean => {
  const label = device.label.toLowerCase();
  return label.startsWith('monitor of ') ||
         label.includes('stereo mix') ||
         label.includes('what u hear') ||
         label.includes('what you hear') ||
         label.includes('wave out mix') ||
         label.includes('voicemeeter');
};

/**
 * Check if a device is a virtual speaker
 */
export const isVirtualSpeaker = (device: LabeledDevice): boolean => {
  const label = device.label.toLowerCase();
  return label.includes('sokuji_virtual_speaker') ||
         label.includes('sokuji virtual output') || // Windows display name
         label.includes('sokujivirtualaudio') ||
         label.includes('cable');
};
