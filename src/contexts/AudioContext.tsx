import React, { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from 'react';
import { ServiceFactory } from '../services/ServiceFactory';
import { IAudioService } from '../services/interfaces/IAudioService';

export interface AudioDevice {
  deviceId: string;
  label: string;
  isVirtual?: boolean;
}

interface AudioContextProps {
  audioInputDevices: AudioDevice[];
  audioOutputDevices: AudioDevice[];
  selectedInputDevice: AudioDevice | null;
  selectedOutputDevice: AudioDevice | null;
  isInputDeviceOn: boolean;
  isOutputDeviceOn: boolean;
  isLoading: boolean;
  selectInputDevice: (device: AudioDevice) => void;
  selectOutputDevice: (device: AudioDevice) => void;
  toggleInputDeviceState: () => void;
  toggleOutputDeviceState: () => void;
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
  const [audioOutputDevices, setAudioOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedInputDevice, setSelectedInputDevice] = useState<AudioDevice | null>(null);
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<AudioDevice | null>(null);
  const [isInputDeviceOn, setIsInputDeviceOn] = useState<boolean>(true);
  const [isOutputDeviceOn, setIsOutputDeviceOn] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Function to refresh the list of audio devices
  const refreshDevices = useCallback(async () => {
    setIsLoading(true);
    try {
      const devices = await audioService.current.getDevices();
      
      setAudioInputDevices(devices.inputs);
      setAudioOutputDevices(devices.outputs);
      
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
      
      // Select first non-virtual output device if not already selected
      if (devices.outputs.length > 0 && (selectedOutputDevice === null || !devices.outputs.some(d => d.deviceId === selectedOutputDevice?.deviceId))) {
        // Filter out virtual devices and select the first one
        const nonVirtualOutputs = devices.outputs.filter(device => !device.isVirtual);
        if (nonVirtualOutputs.length > 0) {
          setSelectedOutputDevice(nonVirtualOutputs[0]);
        } else if (devices.outputs.length > 0) {
          // If all devices are virtual, select the first one anyway
          setSelectedOutputDevice(devices.outputs[0]);
        }
      }
      
      // Check if our virtual audio device was created
      if (devices.outputs.some(device => device.isVirtual)) {
        console.log('Virtual audio device detected');
      } else if (audioService.current.supportsVirtualDevices()) {
        console.log('Creating virtual audio devices...');
        const result = await audioService.current.createVirtualDevices?.();
        if (result && result.success) {
          console.log('Successfully created virtual audio devices:', result.message);
          // Refresh the device list again after creating virtual devices
          await refreshDevices();
        } else {
          console.error('Failed to create virtual audio devices:', result?.error);
        }
      }
    } catch (error) {
      console.error('Error refreshing audio devices:', error);
    } finally {
      setIsLoading(false);
    }
  }, [selectedInputDevice, selectedOutputDevice]);

  // Initialize audio service and load devices
  useEffect(() => {
    const initAudioService = async () => {
      try {
        await audioService.current.initialize();
        await refreshDevices();

        // When output device is ON during initialization, actively connect output device
        // Only do this on initial mount, not when selectedOutputDevice changes
        if (isOutputDeviceOn && selectedOutputDevice) {
          console.log('Initialization complete, actively connecting output device:', selectedOutputDevice.deviceId);
          audioService.current.connectOutput(selectedOutputDevice.deviceId, selectedOutputDevice.label)
            .then((result) => {
              if (result.success) {
                console.log('Successfully connected virtual speaker to output device during initialization:', result.message);
              } else {
                console.error('Failed to connect virtual speaker to output device during initialization:', result.error);
              }
            })
            .catch((error) => {
              console.error('Error connecting output device during initialization:', error);
            });
        }
      } catch (error) {
        console.error('Failed to initialize audio service:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    initAudioService();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // selectedOutputDevice is intentionally excluded from the dependencies to avoid an infinite loop
    // since this effect would trigger selectOutputDevice which updates selectedOutputDevice state
  }, [refreshDevices, isOutputDeviceOn]);

  const selectInputDevice = (device: AudioDevice) => setSelectedInputDevice(device);
  
  // Updated selectOutputDevice to use the audio service
  const selectOutputDevice = useCallback((device: AudioDevice) => {
    console.log(`Selected output device: ${device.label} (${device.deviceId})`);
    setSelectedOutputDevice((prevDevice) => {
      if (prevDevice?.deviceId !== device.deviceId) {
        console.log(`Output device changed: ${prevDevice?.label} (${prevDevice?.deviceId}) -> ${device.label} (${device.deviceId})`);

        // Only connect the virtual speaker if the output device is turned ON
        if (isOutputDeviceOn && device && device.deviceId) {
          console.log(`Connecting virtual speaker to output device: ${device.label}`);

          // Use the audio service instead of direct Electron calls
          audioService.current.connectOutput(device.deviceId, device.label)
            .then((result) => {
              if (result.success) {
                console.log('Successfully connected virtual speaker to output device:', result.message);
              } else {
                console.error('Failed to connect virtual speaker to output device:', result.error);
              }
            })
            .catch((error) => {
              console.error('Error connecting virtual speaker to output device:', error);
            });
        }
      }
      return device;
    });
  }, [isOutputDeviceOn]);
  
  // Updated toggleInputDeviceState to use the audio service if needed
  const toggleInputDeviceState = useCallback(() => {
    setIsInputDeviceOn(!isInputDeviceOn);
  }, [isInputDeviceOn]);
  
  // Updated toggleOutputDeviceState to use the audio service
  const toggleOutputDeviceState = useCallback(() => {
    console.log('Toggling output device state');
    const newState = !isOutputDeviceOn;
    setIsOutputDeviceOn(newState);
    
    // Connect or disconnect the virtual speaker based on the new state
    if (newState) {
      // Turn ON - Connect virtual speaker to the selected output device
      if (selectedOutputDevice) {
        console.log(`Connecting virtual speaker to output device: ${selectedOutputDevice.label}`);
        audioService.current.connectOutput(selectedOutputDevice.deviceId, selectedOutputDevice.label)
          .then((result) => {
            if (result.success) {
              console.log('Successfully connected virtual speaker to output device:', result.message);
            } else {
              console.error('Failed to connect virtual speaker to output device:', result.error);
            }
          })
          .catch((error) => {
            console.error('Error connecting virtual speaker to output device:', error);
          });
      } else {
        console.warn('Cannot connect output device: No output device selected');
      }
    } else {
      // Turn OFF - Disconnect virtual speaker from all outputs
      console.log('Disconnecting virtual speaker from all outputs');
      audioService.current.disconnectOutputs()
        .then((result) => {
          if (result.success) {
            console.log('Successfully disconnected virtual speaker from all outputs:', result.message);
          } else {
            console.error('Failed to disconnect virtual speaker from outputs:', result.error);
          }
        })
        .catch((error) => {
          console.error('Error disconnecting virtual speaker from outputs:', error);
        });
    }
  }, [isOutputDeviceOn, selectedOutputDevice]);

  return (
    <AudioContext.Provider value={{
      audioInputDevices,
      audioOutputDevices,
      selectedInputDevice,
      selectedOutputDevice,
      isInputDeviceOn,
      isOutputDeviceOn,
      isLoading,
      selectInputDevice,
      selectOutputDevice,
      toggleInputDeviceState,
      toggleOutputDeviceState,
      refreshDevices
    }}>
      {children}
    </AudioContext.Provider>
  );
};

export default AudioContext;
