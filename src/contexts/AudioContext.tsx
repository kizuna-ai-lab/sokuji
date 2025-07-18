import React, { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from 'react';
import { ServiceFactory } from '../services/ServiceFactory';
import { IAudioService, AudioOperationResult } from '../services/interfaces/IAudioService';

export interface AudioDevice {
  deviceId: string;
  label: string;
  isVirtual?: boolean;
}

interface AudioContextProps {
  audioInputDevices: AudioDevice[];
  audioMonitorDevices: AudioDevice[];
  selectedInputDevice: AudioDevice | null;
  selectedMonitorDevice: AudioDevice | null;
  isInputDeviceOn: boolean;
  isMonitorDeviceOn: boolean;
  isLoading: boolean;
  // Real person voice passthrough settings
  isRealVoicePassthroughEnabled: boolean;
  realVoicePassthroughVolume: number;
  selectInputDevice: (device: AudioDevice) => void;
  selectMonitorDevice: (device: AudioDevice) => void;
  toggleInputDeviceState: () => void;
  toggleMonitorDeviceState: () => void;
  toggleRealVoicePassthrough: () => void;
  setRealVoicePassthroughVolume: (volume: number) => void;
  refreshDevices: () => void;
}

const AudioContext = createContext<AudioContextProps | undefined>(undefined);

export const useAudioContext = () => {
  const context = useContext(AudioContext);
  if (context === undefined) {
    throw new Error('useAudioContext must be used within an AudioProvider');
  }
  return context;
};

export const AudioProvider = ({ children }: { children: ReactNode }) => {
  // Create a reference to our audio service
  const audioService = useRef<IAudioService>(ServiceFactory.getAudioService());
  
  const [audioInputDevices, setAudioInputDevices] = useState<AudioDevice[]>([]);
  const [audioMonitorDevices, setAudioMonitorDevices] = useState<AudioDevice[]>([]);
  const [selectedInputDevice, setSelectedInputDevice] = useState<AudioDevice | null>(null);
  const [selectedMonitorDevice, setSelectedMonitorDevice] = useState<AudioDevice | null>(null);
  const [isInputDeviceOn, setIsInputDeviceOn] = useState<boolean>(true);
  const [isMonitorDeviceOn, setIsMonitorDeviceOn] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // Real person voice passthrough settings
  const [isRealVoicePassthroughEnabled, setIsRealVoicePassthroughEnabled] = useState<boolean>(false);
  const [realVoicePassthroughVolume, setRealVoicePassthroughVolumeState] = useState<number>(0.2); // Default 20%

  // Function to refresh the list of audio devices
  const refreshDevices = useCallback(async () => {
    setIsLoading(true);
    try {
      const devices = await audioService.current.getDevices();
      
      setAudioInputDevices(devices.inputs);
      setAudioMonitorDevices(devices.outputs);
      
      // Select first non-virtual input device if not already selected
      if (devices.inputs.length > 0 && (selectedInputDevice === null || !devices.inputs.some(d => d.deviceId === selectedInputDevice?.deviceId))) {
        // Filter out virtual devices and select the first one
        const nonVirtualInputs = devices.inputs.filter(device => !device.isVirtual);
        if (nonVirtualInputs.length > 0) {
          setSelectedInputDevice(nonVirtualInputs[0]);
        } else if (devices.inputs.length > 0) {
          // If all devices are virtual, select the first one anyway
          setSelectedInputDevice(devices.inputs[0]);
        }
      }
      
      // Select first non-virtual monitor device if not already selected
      if (devices.outputs.length > 0 && (selectedMonitorDevice === null || !devices.outputs.some(d => d.deviceId === selectedMonitorDevice?.deviceId))) {
        // Filter out virtual devices and select the first one
        const nonVirtualOutputs = devices.outputs.filter(device => !device.isVirtual);
        if (nonVirtualOutputs.length > 0) {
          setSelectedMonitorDevice(nonVirtualOutputs[0]);
        } else if (devices.outputs.length > 0) {
          // If all devices are virtual, select the first one anyway
          setSelectedMonitorDevice(devices.outputs[0]);
        }
      }
      
      // Check if our virtual audio device was created
      if (devices.outputs.some(device => device.isVirtual)) {
        console.info('[Sokuji] [AudioContext] Virtual audio device detected');
      } else if (audioService.current.supportsVirtualDevices()) {
        console.info('[Sokuji] [AudioContext] Creating virtual audio devices...');
        const result = await audioService.current.createVirtualDevices?.();
        if (result && result.success) {
          console.info('[Sokuji] [AudioContext] Successfully created virtual audio devices:', result.message);
          // Refresh the device list again after creating virtual devices
          await refreshDevices();
        } else {
          console.error('[Sokuji] [AudioContext] Failed to create virtual audio devices:', result?.error);
        }
      }
    } catch (error) {
      console.error('[Sokuji] [AudioContext] Error refreshing audio devices:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedInputDevice, selectedMonitorDevice]);

  // Initialize audio service and load devices
  useEffect(() => {
    const initAudioService = async () => {
      try {
        await audioService.current.initialize();
        await refreshDevices();

        // When monitor device is ON during initialization, actively connect monitor device
        // Only do this on initial mount, not when selectedMonitorDevice changes
        if (isMonitorDeviceOn && selectedMonitorDevice) {
          console.info('[Sokuji] [AudioContext] Initialization complete, actively connecting monitor device:', selectedMonitorDevice.deviceId);
          audioService.current.connectMonitoringDevice(selectedMonitorDevice.deviceId, selectedMonitorDevice.label)
            .then((result: AudioOperationResult) => {
              if (result.success) {
                console.info('[Sokuji] [AudioContext] Successfully connected virtual speaker to monitor device during initialization:', result.message);
              } else {
                console.error('[Sokuji] [AudioContext] Failed to connect virtual speaker to monitor device during initialization:', result.error);
              }
            })
            .catch((error: Error) => {
              console.error('[Sokuji] [AudioContext] Error connecting monitor device during initialization:', error);
            });
        }
      } catch (error) {
        console.error('[Sokuji] [AudioContext] Failed to initialize audio service:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    initAudioService();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshDevices, isMonitorDeviceOn]);

  const selectInputDevice = (device: AudioDevice) => setSelectedInputDevice(device);
  
  // Updated selectMonitorDevice to use the audio service
  const selectMonitorDevice = useCallback((device: AudioDevice) => {
    console.info(`[Sokuji] [AudioContext] Selected monitor device: ${device.label} (${device.deviceId})`);
    setSelectedMonitorDevice((prevDevice) => {
      
      console.info(`[Sokuji] [AudioContext] Monitor device changed: ${prevDevice?.label} (${prevDevice?.deviceId}) -> ${device.label} (${device.deviceId})`);

      // Only connect the virtual speaker if the monitor device is turned ON
      if (isMonitorDeviceOn && device && device.deviceId) {
        console.info(`[Sokuji] [AudioContext] Connecting virtual speaker to monitor device: ${device.label}`);

        // Use the audio service instead of direct Electron calls
        audioService.current.connectMonitoringDevice(device.deviceId, device.label)
          .then((result: AudioOperationResult) => {
            if (result.success) {
              console.info('[Sokuji] [AudioContext] Successfully connected virtual speaker to monitor device:', result.message);
            } else {
              console.error('[Sokuji] [AudioContext] Failed to connect virtual speaker to monitor device:', result.error);
            }
          })
          .catch((error: Error) => {
            console.error('[Sokuji] [AudioContext] Error connecting virtual speaker to monitor device:', error);
          });
      }
      return device;
    });
  }, [isMonitorDeviceOn]);
  
  // Updated toggleInputDeviceState to use the audio service if needed
  const toggleInputDeviceState = useCallback(() => {
    setIsInputDeviceOn(!isInputDeviceOn);
  }, [isInputDeviceOn]);
  
  // Updated toggleMonitorDeviceState to use the audio service
  const toggleMonitorDeviceState = useCallback(() => {
    console.info('[Sokuji] [AudioContext] Toggling monitor device state');
    const newState = !isMonitorDeviceOn;
    setIsMonitorDeviceOn(newState);
    
    // Connect or disconnect the virtual speaker based on the new state
    if (newState) {
      // Turn ON - Connect virtual speaker to the selected monitor device
      if (selectedMonitorDevice) {
        console.info(`[Sokuji] [AudioContext] Connecting virtual speaker to monitor device: ${selectedMonitorDevice.label}`);
        audioService.current.connectMonitoringDevice(selectedMonitorDevice.deviceId, selectedMonitorDevice.label)
          .then((result: AudioOperationResult) => {
            if (result.success) {
              console.info('[Sokuji] [AudioContext] Successfully connected virtual speaker to monitor device:', result.message);
            } else {
              console.error('[Sokuji] [AudioContext] Failed to connect virtual speaker to monitor device:', result.error);
            }
          })
          .catch((error: Error) => {
            console.error('[Sokuji] [AudioContext] Error connecting virtual speaker to monitor device:', error);
          });
      } else {
        console.warn('[Sokuji] [AudioContext] Cannot connect monitor device: No monitor device selected');
      }
    } else {
      // Turn OFF - Disconnect virtual speaker from all outputs
      console.info('[Sokuji] [AudioContext] Disconnecting virtual speaker from all outputs');
      audioService.current.disconnectMonitoringDevices()
        .then((result: AudioOperationResult) => {
          if (result.success) {
            console.info('[Sokuji] [AudioContext] Successfully disconnected virtual speaker from all outputs:', result.message);
          } else {
            console.error('[Sokuji] [AudioContext] Failed to disconnect virtual speaker from outputs:', result.error);
          }
        })
        .catch((error: Error) => {
          console.error('[Sokuji] [AudioContext] Error disconnecting virtual speaker from outputs:', error);
        });
    }
  }, [isMonitorDeviceOn, selectedMonitorDevice]);

  // Real person voice passthrough functions
  const toggleRealVoicePassthrough = useCallback(() => {
    console.info('[Sokuji] [AudioContext] Toggling real voice passthrough');
    setIsRealVoicePassthroughEnabled(!isRealVoicePassthroughEnabled);
  }, [isRealVoicePassthroughEnabled]);

  const setRealVoicePassthroughVolume = useCallback((volume: number) => {
    // Clamp volume between 0 and 0.6 (60%)
    const clampedVolume = Math.max(0, Math.min(0.6, volume));
    console.info('[Sokuji] [AudioContext] Setting real voice passthrough volume:', clampedVolume);
    setRealVoicePassthroughVolumeState(clampedVolume);
  }, []);

  return (
    <AudioContext.Provider value={{
      audioInputDevices,
      audioMonitorDevices,
      selectedInputDevice,
      selectedMonitorDevice,
      isInputDeviceOn,
      isMonitorDeviceOn,
      isLoading,
      // Real person voice passthrough settings
      isRealVoicePassthroughEnabled,
      realVoicePassthroughVolume,
      selectInputDevice,
      selectMonitorDevice,
      toggleInputDeviceState,
      toggleMonitorDeviceState,
      toggleRealVoicePassthrough,
      setRealVoicePassthroughVolume,
      refreshDevices
    }}>
      {children}
    </AudioContext.Provider>
  );
};

export default AudioContext;
