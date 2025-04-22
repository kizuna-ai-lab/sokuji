import React, { useState, useEffect, useRef, useCallback } from 'react';
import MainPanel from '../MainPanel/MainPanel';
import SettingsPanel from '../SettingsPanel/SettingsPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import AudioPanel from '../AudioPanel/AudioPanel';
import { Terminal, Settings, Volume2 } from 'react-feather';
import './MainLayout.scss';

interface AudioDevice {
  deviceId: string;
  label: string;
}

const WAVEFORM_BARS = 5;

const MainLayout: React.FC = () => {
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [audioInputDevices, setAudioInputDevices] = useState<AudioDevice[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedInputDevice, setSelectedInputDevice] = useState<AudioDevice>({ deviceId: '', label: '' });
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<AudioDevice>({ deviceId: '', label: '' });
  const [isInputDeviceOn, setIsInputDeviceOn] = useState(true);
  const [isOutputDeviceOn, setIsOutputDeviceOn] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [inputAudioHistory, setInputAudioHistory] = useState<number[]>(Array(WAVEFORM_BARS).fill(0));

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);

  // Initialize by creating an empty Audio element
  const testAudioRef = useRef<HTMLAudioElement>(new Audio());
  testAudioRef.current.loop = true;

  const stopAudioVisualization = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (mediaStreamRef.current) {
      const tracks = mediaStreamRef.current.getTracks();
      tracks.forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
      analyserRef.current = null;
    }
  }, []);

  const startAudioVisualization = useCallback(async () => {
    try {
      stopAudioVisualization();

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // When deviceId is 'default', we pass undefined to use the System Default Microphone
          deviceId: selectedInputDevice.deviceId === '' ? undefined : { exact: selectedInputDevice.deviceId }
        }
      });
      mediaStreamRef.current = stream;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateAudioVisualization = () => {
        if (!analyserRef.current) return;

        analyserRef.current.getByteFrequencyData(dataArray);

        // Calculate average volume level (0-255)
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;

        // Normalize to 0-100 scale
        const normalizedValue = Math.min(100, Math.round((average / 255) * 100));

        // Update at most every 100ms for performance
        const now = Date.now();
        if (now - lastUpdateTimeRef.current > 100) {
          // Update the audio history array
          setInputAudioHistory(prev => {
            const newHistory = [...prev];
            newHistory.shift();
            newHistory.push(normalizedValue);
            return newHistory;
          });
          lastUpdateTimeRef.current = now;
        }

        animationFrameRef.current = requestAnimationFrame(updateAudioVisualization);
      };

      animationFrameRef.current = requestAnimationFrame(updateAudioVisualization);
    } catch (error) {
      console.error('Error starting audio visualization:', error);
      stopAudioVisualization();
    }
  }, [selectedInputDevice, stopAudioVisualization]);

  const currentInputDeviceRef = useRef<AudioDevice>({ deviceId: '', label: '' });
  const currentOutputDeviceRef = useRef<AudioDevice>({ deviceId: '', label: '' });

  useEffect(() => {
    currentInputDeviceRef.current = selectedInputDevice;
  }, [selectedInputDevice]);

  useEffect(() => {
    currentOutputDeviceRef.current = selectedOutputDevice;
  }, [selectedOutputDevice]);

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

  useEffect(() => {
    const initializeAudioDevices = async () => {
      await getAudioDevices();
    };

    initializeAudioDevices();

    return () => {
      stopAudioVisualization();
    };
  }, [getAudioDevices, stopAudioVisualization]);

  useEffect(() => {
    navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
      stopAudioVisualization();
    };
  }, [getAudioDevices, stopAudioVisualization]);

  useEffect(() => {
    if (isInputDeviceOn && selectedInputDevice) {
      startAudioVisualization();
    } else {
      stopAudioVisualization();
    }

    return () => {
      stopAudioVisualization();
    };
  }, [isInputDeviceOn, selectedInputDevice, startAudioVisualization, stopAudioVisualization]);

  const toggleAudio = useCallback(() => {
    setShowAudio(!showAudio);
    if (!showAudio) {
      setShowLogs(false);
      setShowSettings(false);
    }
  }, [showAudio]);

  const toggleLogs = useCallback(() => {
    setShowLogs(!showLogs);
    if (!showLogs) {
      setShowSettings(false);
      setShowAudio(false);
    }
  }, [showLogs]);

  const toggleSettings = useCallback(() => {
    setShowSettings(!showSettings);
    if (!showSettings) {
      setShowLogs(false);
      setShowAudio(false);
    }
  }, [showSettings]);

  const selectInputDevice = useCallback((device: AudioDevice) => {
    console.log(`Selected input device callback: ${device.label} (${device.deviceId})`);
    setSelectedInputDevice(device);
  }, []);

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
          // Send both deviceId and label to help with PipeWire node identification
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

  const toggleInputDeviceState = useCallback(() => {
    setIsInputDeviceOn(!isInputDeviceOn);
  }, [isInputDeviceOn]);

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

  useEffect(() => {
    // Try to set Sokuji_Virtual_Speaker as the default output device
    if ('setSinkId' in HTMLAudioElement.prototype) {
      const setVirtualSpeaker = async () => {
        try {
          // Wait for device list to load
          if (audioOutputDevices.length > 0) {
            // Find the Sokuji_Virtual_Speaker device
            const virtualSpeaker = audioOutputDevices.find(device =>
              device.label.includes('Sokuji_Virtual_Speaker'));

            if (virtualSpeaker && testAudioRef.current) {
              await (testAudioRef.current as any).setSinkId(virtualSpeaker.deviceId);
              console.log('Set initial test audio output to Sokuji_Virtual_Speaker');

              const currentOutputDevice = currentOutputDeviceRef.current;
              const currentOutputDeviceStillAvailable = audioOutputDevices.some(
                device => device.deviceId === currentOutputDevice.deviceId
              );

              // Find the first non-virtual output device as default selection
              let selectedOutput = null;

              if(!currentOutputDeviceStillAvailable || !currentOutputDevice.deviceId){
                // First try to find a non-virtual device
                for (const device of audioOutputDevices) {
                  if (!device.label.toLowerCase().includes('sokuji_virtual')) {
                    selectedOutput = device;
                    console.log(`Selected first non-virtual output device on init: ${device.label}`);
                    break;
                  }
                }

                // If all devices are virtual, use the first one
                if (!selectedOutput && audioOutputDevices.length > 0) {
                  selectedOutput = audioOutputDevices[0];
                  console.log(`All output devices are virtual, selecting first on init: ${audioOutputDevices[0].label}`);
                }

              }else{
                selectedOutput = currentOutputDevice;
                console.log(`Keeping previously selected output device: ${currentOutputDevice.label}`);
              }

              // Set the selected output device
              if (selectedOutput) {
                selectOutputDevice(selectedOutput);
              }
            }
          }
        } catch (err) {
          console.error('Error setting initial audio output device:', err);
        }
      };

      setVirtualSpeaker();
    }
  }, [audioOutputDevices, selectOutputDevice]);

  return (
    <div className="main-layout">
      <div className={`main-content ${(showLogs || showSettings || showAudio) ? 'with-panel' : 'full-width'}`}>
        <header className="main-panel-header">
          <h1>Realtime</h1>
          <div className="header-controls">
            <button className="settings-button" onClick={toggleSettings}>
              <Settings size={16} />
              <span>Settings</span>
            </button>
            <button className="audio-button" onClick={toggleAudio}>
              <Volume2 size={16} />
              <span>Audio</span>
            </button>
            <button className="logs-button" onClick={toggleLogs}>
              <Terminal size={16} />
              <span>Logs</span>
            </button>
          </div>
        </header>
        <div className="main-panel-container">
          <MainPanel />
        </div>
      </div>
      {(showLogs || showSettings || showAudio) && (
        <div className="settings-panel-container">
          {showLogs && <LogsPanel toggleLogs={toggleLogs} />}
          {showSettings && <SettingsPanel toggleSettings={toggleSettings} />}
          {showAudio && (
            <AudioPanel
              toggleAudio={toggleAudio}
              audioInputDevices={audioInputDevices}
              audioOutputDevices={audioOutputDevices}
              selectedInputDevice={selectedInputDevice}
              selectedOutputDevice={selectedOutputDevice}
              isInputDeviceOn={isInputDeviceOn}
              isOutputDeviceOn={isOutputDeviceOn}
              isLoading={isLoading}
              selectInputDevice={selectInputDevice}
              selectOutputDevice={selectOutputDevice}
              toggleInputDeviceState={toggleInputDeviceState}
              toggleOutputDeviceState={toggleOutputDeviceState}
              inputAudioHistory={inputAudioHistory}
              refreshDevices={refreshDevices}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default MainLayout;