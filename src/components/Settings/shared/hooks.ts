import { useCallback, useMemo } from 'react';
import { isVirtualDevice, isVirtualMic, isVirtualSpeaker } from '../../../utils/audioDevices';

/**
 * Shared types for audio devices
 */
export interface AudioDevice {
  deviceId: string;
  label: string;
  isDefault?: boolean;
}

// Re-exported for backward compatibility — the actual (React-free) predicates
// now live in utils/audioDevices.ts so non-UI modules (e.g.
// ModernBrowserAudioService) can use them without pulling in React.
export { isVirtualDevice, isVirtualMic, isVirtualSpeaker };

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
