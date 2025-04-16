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
  const [selectedInputDevice, setSelectedInputDevice] = useState<AudioDevice>({ deviceId: 'default', label: 'Default' });
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<AudioDevice>({ deviceId: 'default', label: 'Default' });
  const [isInputDeviceOn, setIsInputDeviceOn] = useState(true);
  const [isOutputDeviceOn, setIsOutputDeviceOn] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [inputAudioHistory, setInputAudioHistory] = useState<number[]>(Array(WAVEFORM_BARS).fill(0));
  const [outputAudioHistory, setOutputAudioHistory] = useState<number[]>(Array(WAVEFORM_BARS).fill(0));
  const [isSessionActive, setIsSessionActive] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);

  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnimationFrameRef = useRef<number | null>(null);
  const outputLastUpdateTimeRef = useRef<number>(0);
  
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

  const stopOutputAudioVisualization = useCallback(() => {
    if (outputAnimationFrameRef.current) {
      cancelAnimationFrame(outputAnimationFrameRef.current);
      outputAnimationFrameRef.current = null;
    }

    if (outputAudioContextRef.current) {
      if (outputAudioContextRef.current.state !== 'closed') {
        outputAudioContextRef.current.close();
      }
      outputAudioContextRef.current = null;
      outputAnalyserRef.current = null;
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
          deviceId: selectedInputDevice.deviceId === 'default' ? undefined : { exact: selectedInputDevice.deviceId }
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

  const startOutputAudioVisualization = useCallback(async () => {
    try {
      stopOutputAudioVisualization();
      
      const audioContext = new AudioContext();
      outputAudioContextRef.current = audioContext;
      
      // todo: implement output audio visualization
      // Create oscillator for simulating output audio levels
      const oscillator = audioContext.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
      
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      
      oscillator.connect(analyser);
      // Don't connect to destination to avoid actual sound
      
      outputAnalyserRef.current = analyser;
      
      // Start the oscillator
      oscillator.start();
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const updateOutputAudioVisualization = () => {
        if (!outputAnalyserRef.current) return;
        
        outputAnalyserRef.current.getByteFrequencyData(dataArray);
        
        // Calculate average volume level (0-255)
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        
        // Normalize to 0-100 scale and add some randomness for visual feedback
        const randomFactor = Math.random() * 20;
        const normalizedValue = Math.min(100, Math.round((average / 255) * 50) + randomFactor);
        
        // Update at most every 100ms for performance
        const now = Date.now();
        if (now - outputLastUpdateTimeRef.current > 100) {
          // Update the output audio history array
          setOutputAudioHistory(prev => {
            const newHistory = [...prev];
            newHistory.shift();
            newHistory.push(normalizedValue);
            return newHistory;
          });
          outputLastUpdateTimeRef.current = now;
        }
        
        outputAnimationFrameRef.current = requestAnimationFrame(updateOutputAudioVisualization);
      };
      
      outputAnimationFrameRef.current = requestAnimationFrame(updateOutputAudioVisualization);
    } catch (error) {
      console.error('Error starting output audio visualization:', error);
      stopOutputAudioVisualization();
    }
  }, [stopOutputAudioVisualization]);

  const fetchAudioDevices = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      // Get audio input devices
      const audioInputs = devices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 5)}...`
        }));
      if (!audioInputs.some(device => device.deviceId === 'default')) {
        audioInputs.unshift({ deviceId: 'default', label: 'Default' });
      }
      setAudioInputDevices(audioInputs);
      
      // Get audio output devices
      const audioOutputs = devices
        .filter(device => device.kind === 'audiooutput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Speaker ${device.deviceId.slice(0, 5)}...`
        }));
      if (!audioOutputs.some(device => device.deviceId === 'default')) {
        audioOutputs.unshift({ deviceId: 'default', label: 'Default' });
      }
      setAudioOutputDevices(audioOutputs);
      
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
      setAudioInputDevices([{ deviceId: 'default', label: 'Default' }]);
      setAudioOutputDevices([{ deviceId: 'default', label: 'Default' }]);
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
      stopOutputAudioVisualization();
    };
  }, [getAudioDevices, stopAudioVisualization, stopOutputAudioVisualization]);

  useEffect(() => {
    navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
      stopAudioVisualization();
      stopOutputAudioVisualization();
    };
  }, [getAudioDevices, stopAudioVisualization, stopOutputAudioVisualization]);

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

  useEffect(() => {
    const updateOutputDevices = async () => {
      if (isOutputDeviceOn && selectedOutputDevice) {
        // Apply output device selection using setSinkId
        // This is only supported in some browsers (Chrome, Edge)
        try {
          // Find all audio elements and set their sink ID
          const audioElements = document.querySelectorAll('audio');
          // Convert NodeList to Array before iterating
          const audioElementsArray = Array.from(audioElements);
          for (const audioEl of audioElementsArray) {
            // Check if setSinkId is supported
            if ('setSinkId' in audioEl) {
              try {
                // If 'default' is selected, let the browser use the System Default
                // Otherwise use the specific device ID
                if (selectedOutputDevice.deviceId !== 'default') {
                  await (audioEl as any).setSinkId(selectedOutputDevice.deviceId);
                  console.log(`Set audio output to: ${selectedOutputDevice.label}`);
                }
              } catch (err) {
                console.error('Error setting audio output device:', err);
              }
            }
          }
          
          // Also update the test audio element if it exists and is playing
          if (testAudioRef.current) {
            if ('setSinkId' in testAudioRef.current) {
              try {
                if (selectedOutputDevice.deviceId !== 'default') {
                  await (testAudioRef.current as any).setSinkId(selectedOutputDevice.deviceId);
                  console.log(`Updated test audio output to: ${selectedOutputDevice.label}`);
                }
              } catch (err) {
                console.error('Error updating test audio output device:', err);
              }
            }
          }
          
          // Start output audio visualization
          startOutputAudioVisualization();
        } catch (error) {
          console.error('Error applying output device selection:', error);
        }
      } else {
        stopOutputAudioVisualization();
      }
    };
    
    updateOutputDevices();
    
    return () => {
      stopOutputAudioVisualization();
    };
  }, [isOutputDeviceOn, selectedOutputDevice, startOutputAudioVisualization, stopOutputAudioVisualization]);

  useEffect(() => {
    // If we have test audio playing and output is turned off, mute it
    if (testAudioRef.current) {
      if (isOutputDeviceOn) {
        // If session is active and output is turned on, restore volume
        if (isSessionActive) {
          testAudioRef.current.muted = false;
          console.log('Output device turned on - unmuting test audio');
        }
      } else {
        // If output is turned off, mute the audio
        testAudioRef.current.muted = true;
        console.log('Output device turned off - muting test audio');
      }
    }
  }, [isOutputDeviceOn, isSessionActive]);

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
      
      // Play or pause the test audio based on session state
      if (newState) {
        // Start session - play the test audio
        if (!testAudioRef.current) {
          testAudioRef.current = new Audio('/assets/test-tone.mp3');
          
          console.log(`isOutputDeviceOn: ${isOutputDeviceOn}, selectedOutputDevice: ${JSON.stringify(selectedOutputDevice)}`)
          // Set the audio output device if supported and selected
          if (isOutputDeviceOn && selectedOutputDevice && 
              selectedOutputDevice.deviceId !== 'default' && 
              'setSinkId' in testAudioRef.current) {
            try {
              (testAudioRef.current as any).setSinkId(selectedOutputDevice.deviceId)
                .catch((err: any) => console.error('Error setting audio output device:', err));
            } catch (err) {
              console.error('Error setting audio output device:', err);
            }
          }
          
          // Loop the audio for continuous playback
          testAudioRef.current.loop = true;
          
          // If output is turned off, mute the audio
          if (!isOutputDeviceOn) {
            testAudioRef.current.muted = true;
            console.log('Output device is off - test audio will be muted');
          }
        }
        
        testAudioRef.current.play()
          .catch(err => console.error('Error playing test audio:', err));
        console.log('Session started - playing test audio');
      } else {
        // Stop session - pause the test audio
        if (testAudioRef.current) {
          testAudioRef.current.pause();
          console.log('Session stopped - paused test audio');
        }
      }
      
      return newState;
    });
  }, [isOutputDeviceOn, selectedOutputDevice]);

  // Clean up audio when component unmounts
  useEffect(() => {
    return () => {
      // Stop test audio if it's playing
      if (testAudioRef.current) {
        testAudioRef.current.pause();
        testAudioRef.current = null;
      }
      
      stopAudioVisualization();
      stopOutputAudioVisualization();
    };
  }, [stopAudioVisualization, stopOutputAudioVisualization]);

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
              outputAudioHistory={outputAudioHistory}
              refreshDevices={refreshDevices}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default MainLayout;
