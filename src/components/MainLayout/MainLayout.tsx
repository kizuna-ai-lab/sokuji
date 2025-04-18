import React, { useState, useEffect, useRef, useCallback } from 'react';
import MainPanel from '../MainPanel/MainPanel';
import SettingsPanel from '../SettingsPanel/SettingsPanel';
import LogsPanel from '../LogsPanel/LogsPanel';
import AudioPanel from '../AudioPanel/AudioPanel';
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
  const [isSessionActive, setIsSessionActive] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);
  
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

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
      
      // Find the first non-virtual device to select
      let selectedInput = null;
      
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
      
      // Find the first non-virtual device to select
      let selectedOutput = null;
      
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
      
      // Set the output devices
      setAudioOutputDevices(audioOutputs);
      
      // Update the selected output device if we found one
      if (selectedOutput) {
        setSelectedOutputDevice(selectedOutput);
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
    setSelectedInputDevice(device);
  }, []);

  const selectOutputDevice = useCallback((device: AudioDevice) => {
    setSelectedOutputDevice(device);
    console.log(`Selected output device: ${device.label} (${device.deviceId})`);
    
    // Connect the virtual speaker's monitor port to the selected output device
    // This will route the audio from Sokuji_Virtual_Speaker to the selected output device
    if (device && device.deviceId) {
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
  }, []);

  const toggleInputDeviceState = useCallback(() => {
    setIsInputDeviceOn(!isInputDeviceOn);
  }, [isInputDeviceOn]);

  const toggleOutputDeviceState = useCallback(() => {
    setIsOutputDeviceOn(!isOutputDeviceOn);
  }, [isOutputDeviceOn]);

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

  const toggleSession = useCallback(() => {
    setIsSessionActive(prevState => {
      const newState = !prevState;
      
      if (testAudioRef.current) {
        if (newState) {
          // If activating the session, set the audio source and play
          if (!testAudioRef.current.src || testAudioRef.current.src.indexOf('test-tone.mp3') === -1) {
            testAudioRef.current.src = './assets/test-tone.mp3';
          }
          
          console.log(`isOutputDeviceOn: ${isOutputDeviceOn}, selectedOutputDevice: ${JSON.stringify(selectedOutputDevice)}`);
          // Always use Sokuji_Virtual_Speaker as the output device
          if ('setSinkId' in testAudioRef.current) {
            try {
              // Find the Sokuji_Virtual_Speaker device
              const virtualSpeaker = audioOutputDevices.find(device => 
                device.label.includes('Sokuji_Virtual_Speaker'));

              if (virtualSpeaker) {
                (testAudioRef.current as any).setSinkId(virtualSpeaker.deviceId)
                  .catch((err: any) => console.error('Error setting Sokuji_Virtual_Speaker as output device:', err));
                console.log('Set test audio output to Sokuji_Virtual_Speaker');
              } else {
                // If the virtual speaker can't be found, use the selected output device (keep original behavior as fallback)
                (testAudioRef.current as any).setSinkId(
                  selectedOutputDevice.deviceId === '' ? '' : selectedOutputDevice.deviceId
                ).catch((err: any) => console.error('Error setting audio output device:', err));
              }
            } catch (err) {
              console.error('Error setting audio output device:', err);
            }
          }

          // Set mute state based on output device status
          testAudioRef.current.muted = !isOutputDeviceOn;
          
          // Play audio
          testAudioRef.current.play()
            .catch(err => console.error('Error playing test audio:', err));
          console.log('Session started - playing test audio');
        } else {
          // If stopping the session, pause the audio
          testAudioRef.current.pause();
          console.log('Session stopped - paused test audio');
        }
      }
      
      return newState;
    });
  }, [isOutputDeviceOn, selectedOutputDevice, audioOutputDevices]);

  useEffect(() => {
    // Stop test audio if it's playing
    if (testAudioRef.current) {
      testAudioRef.current.pause();
      testAudioRef.current = null;
    }
    
    stopAudioVisualization();
  }, [stopAudioVisualization]);
  useEffect(() => {
    // Initialize by creating an empty Audio element
    testAudioRef.current = new Audio();
    testAudioRef.current.loop = true;

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
              
              // Find the first non-virtual output device as default selection
              let selectedOutput = null;
              
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
              
              // Set the selected output device
              if (selectedOutput) {
                setSelectedOutputDevice(selectedOutput);
                
                // Connect the virtual speaker's monitor port to the selected output device
                console.log(`Connecting Sokuji_Virtual_Speaker to output device on init: ${selectedOutput.label}`);
                
                try {
                  // Call Electron IPC to connect the virtual speaker to this output device
                  const result = await (window as any).electron.invoke('connect-virtual-speaker-to-output', {
                    deviceId: selectedOutput.deviceId,
                    label: selectedOutput.label
                  });
                  
                  if (result.success) {
                    console.log('Successfully connected virtual speaker to output device on init:', result.message);
                  } else {
                    console.error('Failed to connect virtual speaker to output device on init:', result.error);
                  }
                } catch (error) {
                  console.error('Error connecting virtual speaker to output device on init:', error);
                }
              }
            }
          }
        } catch (err) {
          console.error('Error setting initial audio output device:', err);
        }
      };

      setVirtualSpeaker();
    }

    // Clean up resources when component unmounts
    return () => {
      if (testAudioRef.current) {
        testAudioRef.current.pause();
        testAudioRef.current.src = '';
        testAudioRef.current = null;
      }
    };
  }, [audioOutputDevices]);

  return (
    <div className="main-layout">
      <div className={`main-panel-container ${(showLogs || showSettings || showAudio) ? 'with-panel' : 'full-width'}`}>
        <MainPanel 
          toggleLogs={toggleLogs} 
          toggleSettings={toggleSettings} 
          toggleAudio={toggleAudio}
          toggleSession={toggleSession}
          isSessionActive={isSessionActive}
        />
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