import React, { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from 'react';

export interface AudioDevice {
  deviceId: string;
  label: string;
  isDefault?: boolean;
}

interface AudioContextProps {
  audioInputDevices: AudioDevice[];
  audioOutputDevices: AudioDevice[];
  selectedInputDevice: AudioDevice;
  selectedOutputDevice: AudioDevice;
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
  const ctx = useContext(AudioContext);
  if (!ctx) throw new Error('useAudioContext must be used within an AudioProvider');
  return ctx;
};

export const AudioProvider = ({ children }: { children: ReactNode }) => {
  const [audioInputDevices, setAudioInputDevices] = useState<AudioDevice[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedInputDevice, setSelectedInputDevice] = useState<AudioDevice>({ deviceId: '', label: '' });
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<AudioDevice>({ deviceId: '', label: '' });
  const [isInputDeviceOn, setIsInputDeviceOn] = useState(true);
  const [isOutputDeviceOn, setIsOutputDeviceOn] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  // Reference to currently selected devices, used to maintain selection when device list updates
  const currentInputDeviceRef = useRef<AudioDevice>({ deviceId: '', label: '' });
  const currentOutputDeviceRef = useRef<AudioDevice>({ deviceId: '', label: '' });

  // Update reference when selected device changes
  useEffect(() => {
    currentInputDeviceRef.current = selectedInputDevice;
  }, [selectedInputDevice]);

  useEffect(() => {
    currentOutputDeviceRef.current = selectedOutputDevice;
  }, [selectedOutputDevice]);

  // Complete device fetching logic, consistent with original MainLayout
  const fetchAudioDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();

      console.log('All audio devices:', devices);

      // Get audio input devices, excluding the generic 'default' device
      const audioInputs = devices
        .filter(device => device.kind === 'audioinput' && device.deviceId !== 'default' && device.deviceId !== '')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 5)}...`
        }));

      // if selected device still in new audioInputs, use it
      const currentInputDevice = currentInputDeviceRef.current;
      const currentInputDeviceStillAvailable = audioInputs.some(
        device => device.deviceId === currentInputDevice.deviceId
      );

      let selectedInput = null;
      if (!currentInputDeviceStillAvailable || !currentInputDevice.deviceId) {
        // Find the first non-virtual device to select

        // First try to find a non-virtual device
        for (const device of audioInputs) {
          if (!device.label.toLowerCase().includes('sokuji_virtual')) {
            selectedInput = device;
            console.log(`Selected first non-virtual input device: ${device.label}`);
            break;
          }
        }

        // If all devices are virtual, just use the first one
        if (!selectedInput && audioInputs.length > 0) {
          selectedInput = audioInputs[0];
          console.log(`All input devices are virtual, selecting first: ${audioInputs[0].label}`);
        }
      } else {
        selectedInput = currentInputDevice;
        console.log(`Keeping previously selected input device: ${currentInputDevice.label}`);
      }

      // Set the input devices
      setAudioInputDevices(audioInputs);

      // Update the selected input device if we found one
      if (selectedInput) {
        setSelectedInputDevice(selectedInput);
      }

      // Get audio output devices, excluding the generic 'default' device
      const audioOutputs = devices
        .filter(device => device.kind === 'audiooutput' && device.deviceId !== 'default' && device.deviceId !== '')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Speaker ${device.deviceId.slice(0, 5)}...`
        }));

      // Check if the previously selected output device is still available
      const currentOutputDevice = currentOutputDeviceRef.current;
      const currentOutputDeviceStillAvailable = audioOutputs.some(
        device => device.deviceId === currentOutputDevice.deviceId
      );

      // Find the appropriate output device to select
      let selectedOutput = null;
      if (!currentOutputDeviceStillAvailable || !currentOutputDevice.deviceId) {
        // First try to find a non-virtual device
        for (const device of audioOutputs) {
          if (!device.label.toLowerCase().includes('sokuji_virtual')) {
            selectedOutput = device;
            console.log(`Selected first non-virtual output device: ${device.label}`);
            break;
          }
        }

        // If all devices are virtual, just use the first one
        if (!selectedOutput && audioOutputs.length > 0) {
          selectedOutput = audioOutputs[0];
          console.log(`All output devices are virtual, selecting first: ${audioOutputs[0].label}`);
        }
      } else {
        selectedOutput = currentOutputDevice;
        console.log(`Keeping previously selected output device: ${currentOutputDevice.label}`);
      }

      // Set the output devices
      setAudioOutputDevices(audioOutputs);

      // Update the selected output device if we found one
      if (selectedOutput) {
        selectOutputDevice(selectedOutput);
      }

      return true; // Success
    } catch (error) {
      return error; // Return the error for handling by the caller
    }
  }, []);

  // Call fetchAudioDevices and handle errors
  const getAudioDevices = useCallback(async () => {
    try {
      const result = await fetchAudioDevices();
      if (result === true) {
        setIsLoading(false);
      } else {
        throw result; // Re-throw the error to be caught below
      }
    } catch (error) {
      setAudioInputDevices([{ deviceId: '', label: '' }]);
      setAudioOutputDevices([{ deviceId: '', label: '' }]);
      setIsLoading(false);
    }
  }, [fetchAudioDevices]);

  // Initialize and listen for device changes
  useEffect(() => {
    getAudioDevices();
    navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
    };
  }, [getAudioDevices]);

  const selectInputDevice = (device: AudioDevice) => setSelectedInputDevice(device);
  
  // Restore original selectOutputDevice logic, including Electron IPC calls
  const selectOutputDevice = useCallback((device: AudioDevice) => {
    console.log(`Selected output device: ${device.label} (${device.deviceId})`);
    setSelectedOutputDevice((prevDevice) => {
      if (prevDevice.deviceId !== device.deviceId) {
        console.log(`Output device changed: ${prevDevice.label} (${prevDevice.deviceId}) -> ${device.label} (${device.deviceId})`);

        // Only connect the virtual speaker if the output device is turned ON
        if (isOutputDeviceOn && device && device.deviceId) {
          // Connect the virtual speaker's monitor port to the selected output device
          // This will route the audio from Sokuji_Virtual_Speaker to the selected output device
          console.log(`Connecting Sokuji_Virtual_Speaker to output device: ${device.label}`);

          // Call the Electron IPC to connect the virtual speaker to this output device
          // We're using window.electron which is exposed by the preload script
          (window as any).electron.invoke('connect-virtual-speaker-to-output', {
            deviceId: device.deviceId,
            label: device.label
          })
            .then((result: any) => {
              if (result.success) {
                console.log('Successfully connected virtual speaker to output device:', result.message);
              } else {
                console.error('Failed to connect virtual speaker to output device:', result.error);
              }
            })
            .catch((error: any) => {
              console.error('Error connecting virtual speaker to output device:', error);
            });
        }
      }
      return device;
    });
  }, [isOutputDeviceOn]);
  
  // Restore original toggleInputDeviceState logic
  const toggleInputDeviceState = useCallback(() => {
    setIsInputDeviceOn(!isInputDeviceOn);
  }, [isInputDeviceOn]);
  
  // Restore original toggleOutputDeviceState logic
  const toggleOutputDeviceState = useCallback(() => {
    const newState = !isOutputDeviceOn;
    setIsOutputDeviceOn(newState);

    // Connect or disconnect the virtual speaker based on the new state
    if (newState) {
      // Turn ON - Connect virtual speaker to the selected output device
      console.log(`Connecting Sokuji_Virtual_Speaker to output device: ${selectedOutputDevice.label}`);
      (window as any).electron.invoke('connect-virtual-speaker-to-output', {
        deviceId: selectedOutputDevice.deviceId,
        label: selectedOutputDevice.label
      })
        .then((result: any) => {
          if (result.success) {
            console.log('Successfully connected virtual speaker to output device:', result.message);
          } else {
            console.error('Failed to connect virtual speaker to output device:', result.error);
          }
        })
        .catch((error: any) => {
          console.error('Error connecting virtual speaker to output device:', error);
        });
    } else {
      // Turn OFF - Disconnect virtual speaker from all outputs
      console.log('Disconnecting Sokuji_Virtual_Speaker from all outputs');
      (window as any).electron.invoke('disconnect-virtual-speaker-outputs')
        .then((result: any) => {
          if (result.success) {
            console.log('Successfully disconnected virtual speaker from outputs:', result.message);
          } else {
            console.error('Failed to disconnect virtual speaker from outputs:', result.error);
          }
        })
        .catch((error: any) => {
          console.error('Error disconnecting virtual speaker from outputs:', error);
        });
    }
  }, [isOutputDeviceOn, selectedOutputDevice]);
  
  // Manually refresh device list
  const refreshDevices = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchAudioDevices();
      if (result !== true) {
        console.error('Error refreshing audio devices:', result);
      }
    } catch (error) {
      console.error('Error refreshing audio devices:', error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchAudioDevices]);

  return (
    <AudioContext.Provider
      value={{
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
        refreshDevices,
      }}
    >
      {children}
    </AudioContext.Provider>
  );
};
