import React, { useState, useEffect, useRef } from 'react';
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
  const [audioHistory, setAudioHistory] = useState<number[]>(Array(WAVEFORM_BARS).fill(0));

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateTimeRef = useRef<number>(0);

  useEffect(() => {
    const getAudioDevices = async () => {
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
        
        setIsLoading(false);
      } catch (error) {
        setAudioInputDevices([{ deviceId: 'default', label: 'Default' }]);
        setAudioOutputDevices([{ deviceId: 'default', label: 'Default' }]);
        setIsLoading(false);
      }
    };
    getAudioDevices();
    navigator.mediaDevices.addEventListener('devicechange', getAudioDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getAudioDevices);
      stopAudioVisualization();
    };
  }, []);

  useEffect(() => {
    if (isInputDeviceOn && selectedInputDevice) {
      startAudioVisualization();
    } else {
      stopAudioVisualization();
      setAudioHistory(Array(WAVEFORM_BARS).fill(0));
    }
    return () => {
      stopAudioVisualization();
    };
  }, [isInputDeviceOn, selectedInputDevice]);

  // Effect to handle output device changes
  useEffect(() => {
    if (isOutputDeviceOn && selectedOutputDevice) {
      // Apply output device selection using setSinkId
      // This is only supported in some browsers (Chrome, Edge)
      try {
        // Find all audio elements and set their sink ID
        const audioElements = document.querySelectorAll('audio');
        audioElements.forEach(async (audioEl) => {
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
        });
      } catch (error) {
        console.error('Error applying output device selection:', error);
      }
    }
  }, [isOutputDeviceOn, selectedOutputDevice]);

  const startAudioVisualization = async () => {
    try {
      stopAudioVisualization();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // When deviceId is 'default', we pass undefined to use the System Default Microphone
          deviceId: selectedInputDevice.deviceId === 'default' ? undefined : { exact: selectedInputDevice.deviceId }
        }
      });
      mediaStreamRef.current = stream;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const updateVisualization = (timestamp: number) => {
        if (!analyserRef.current) return;
        if (timestamp - lastUpdateTimeRef.current > 33) { // ~30fps
          lastUpdateTimeRef.current = timestamp;
          analyserRef.current.getByteFrequencyData(dataArray);
          // Average all bands for a single value
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
          const avg = sum / bufferLength / 255;
          setAudioHistory(prev => {
            const next = prev.slice(1).concat(avg); // shift left, add new to right
            return next;
          });
        }
        animationFrameRef.current = requestAnimationFrame(updateVisualization);
      };
      animationFrameRef.current = requestAnimationFrame(updateVisualization);
    } catch (error) {
      // ignore
    }
  };

  const stopAudioVisualization = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  };

  const toggleLogs = () => {
    setShowLogs(!showLogs);
    if (!showLogs) {
      setShowSettings(false);
      setShowAudio(false);
    }
  };

  const toggleSettings = () => {
    setShowSettings(!showSettings);
    if (!showSettings) {
      setShowLogs(false);
      setShowAudio(false);
    }
  };

  const toggleAudio = () => {
    setShowAudio(!showAudio);
    if (!showAudio) {
      setShowLogs(false);
      setShowSettings(false);
    }
  };

  const selectInputDevice = (device: AudioDevice) => {
    setSelectedInputDevice(device);
  };

  const selectOutputDevice = (device: AudioDevice) => {
    setSelectedOutputDevice(device);
  };

  const toggleInputDeviceState = () => {
    setIsInputDeviceOn(!isInputDeviceOn);
  };

  const toggleOutputDeviceState = () => {
    setIsOutputDeviceOn(!isOutputDeviceOn);
  };

  const refreshDevices = async () => {
    setIsLoading(true);
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
    } catch (error) {
      console.error('Error refreshing audio devices:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="main-layout">
      <div className={`main-panel-container ${(showLogs || showSettings || showAudio) ? 'with-panel' : 'full-width'}`}>
        <MainPanel 
          toggleLogs={toggleLogs} 
          toggleSettings={toggleSettings} 
          toggleAudio={toggleAudio}
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
              audioHistory={audioHistory}
              refreshDevices={refreshDevices}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default MainLayout;
