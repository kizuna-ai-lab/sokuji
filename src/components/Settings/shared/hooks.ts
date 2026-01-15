import { useCallback, useMemo } from 'react';

/**
 * Shared types for audio devices
 */
export interface AudioDevice {
  deviceId: string;
  label: string;
  isDefault?: boolean;
}

/**
 * Check if a device is a virtual device that should be filtered or warned about
 */
export const isVirtualDevice = (device: AudioDevice): boolean => {
  const label = device.label.toLowerCase();
  return label.includes('sokuji_virtual_mic') ||
         label.includes('sokuji_virtual_speaker') ||
         label.includes('sokuji_system_audio') ||
         label.includes('sokujivirtualaudio') || // Mac virtual device
         label.includes('cable');
};

/**
 * Check if a device is a virtual microphone
 */
export const isVirtualMic = (device: AudioDevice): boolean => {
  const label = device.label.toLowerCase();
  return label.includes('sokuji_virtual_mic') ||
         label.includes('sokuji_system_audio') ||
         label.includes('sokujivirtualaudio') ||
         label.includes('cable');
};

/**
 * Check if a device is a virtual speaker
 */
export const isVirtualSpeaker = (device: AudioDevice): boolean => {
  const label = device.label.toLowerCase();
  return label.includes('sokuji_virtual_speaker') ||
         label.includes('sokuji_system_audio') ||
         label.includes('sokujivirtualaudio') ||
         label.includes('cable');
};

/**
 * Hook to filter virtual devices from a device list
 */
export const useFilteredDevices = (devices: AudioDevice[]): AudioDevice[] => {
  return useMemo(() => {
    return (devices || []).filter(device => !isVirtualDevice(device));
  }, [devices]);
};

/**
 * Hook to handle virtual device warnings
 */
export const useVirtualDeviceCheck = () => {
  const checkVirtualMic = useCallback((device: AudioDevice): boolean => {
    return isVirtualMic(device);
  }, []);

  const checkVirtualSpeaker = useCallback((device: AudioDevice): boolean => {
    return isVirtualSpeaker(device);
  }, []);

  return {
    checkVirtualMic,
    checkVirtualSpeaker,
    isVirtualDevice
  };
};

/**
 * Warning types for the modal
 */
export type WarningType =
  | 'virtual-mic'
  | 'virtual-speaker'
  | 'mutual-exclusivity-speaker'
  | 'mutual-exclusivity-participant'
  | 'screen-recording-denied';

/**
 * Hook to manage warning modal state
 */
export const useWarningModal = () => {
  // This is a utility type definition - the actual state management
  // is handled by the component using this hook
  return {
    types: {
      VIRTUAL_MIC: 'virtual-mic' as WarningType,
      VIRTUAL_SPEAKER: 'virtual-speaker' as WarningType,
      MUTUAL_EXCLUSIVITY_SPEAKER: 'mutual-exclusivity-speaker' as WarningType,
      MUTUAL_EXCLUSIVITY_PARTICIPANT: 'mutual-exclusivity-participant' as WarningType,
      SCREEN_RECORDING_DENIED: 'screen-recording-denied' as WarningType
    }
  };
};
