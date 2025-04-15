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
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<AudioDevice>({ deviceId: 'default', label: 'Default' });
  const [isDeviceOn, setIsDeviceOn] = useState(true);
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
        const audioInputs = devices
          .filter(device => device.kind === 'audioinput')
          .map(device => ({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${device.deviceId.slice(0, 5)}...`
          }));
        if (!audioInputs.some(device => device.deviceId === 'default')) {
          audioInputs.unshift({ deviceId: 'default', label: 'Default' });
        }
        setAudioDevices(audioInputs);
        setIsLoading(false);
      } catch (error) {
        setAudioDevices([{ deviceId: 'default', label: 'Default' }]);
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
    if (isDeviceOn && selectedDevice) {
      startAudioVisualization();
    } else {
      stopAudioVisualization();
      setAudioHistory(Array(WAVEFORM_BARS).fill(0));
    }
    return () => {
      stopAudioVisualization();
    };
  }, [isDeviceOn, selectedDevice]);

  const startAudioVisualization = async () => {
    try {
      stopAudioVisualization();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: selectedDevice.deviceId === 'default' ? undefined : selectedDevice.deviceId }
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

  const selectDevice = (device: AudioDevice) => {
    setSelectedDevice(device);
  };

  const toggleDeviceState = () => {
    setIsDeviceOn(!isDeviceOn);
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
              audioDevices={audioDevices}
              selectedDevice={selectedDevice}
              isDeviceOn={isDeviceOn}
              isLoading={isLoading}
              selectDevice={selectDevice}
              toggleDeviceState={toggleDeviceState}
              audioHistory={audioHistory}
            />
          )}
        </div>
      )}
    </div>
  );
};

export default MainLayout;
