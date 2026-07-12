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
         label.includes('sokujivirtualaudio') ||
         label.includes('cable');
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
