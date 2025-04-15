import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Check, ChevronDown, Mic, MicOff, PlayCircle, Users, Settings } from 'react-feather';
import './MainPanel.scss';

interface MainPanelProps {
  toggleLogs: () => void;
  toggleSettings: () => void;
}

interface AudioDevice {
  deviceId: string;
  label: string;
}

const WAVEFORM_BARS = 5;
const DOT_SIZE = 3; // px

const MainPanel: React.FC<MainPanelProps> = ({ toggleLogs, toggleSettings }) => {
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<AudioDevice>({ deviceId: 'default', label: 'Default' });
  const [isDeviceOn, setIsDeviceOn] = useState(true);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Maintain a history of 5 bars (oldest at 0, newest at 4)
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

  const toggleDeviceDropdown = () => setShowDeviceDropdown(!showDeviceDropdown);
  const selectDevice = (device: AudioDevice) => { setSelectedDevice(device); setShowDeviceDropdown(false); };
  const toggleDeviceState = () => { setIsDeviceOn(!isDeviceOn); setShowDeviceDropdown(false); };

  // Audio waveform history: 5 bars, right is newest
  const AudioWaveform = () => (
    <div className="audio-waveform">
      {audioHistory.map((level, idx) => {
        // 更灵敏的阈值和放大倍数
        const threshold = 0.02; // 降低阈值
        const AMPLIFY = 32;     // 增加放大倍数
        // 可选：非线性提升灵敏度（如开方）
        const enhancedLevel = Math.sqrt(level); // 让低音量更明显
        const height = enhancedLevel < threshold ? DOT_SIZE : Math.max(DOT_SIZE, enhancedLevel * AMPLIFY);
        return (
          <div
            key={idx}
            className="waveform-bar"
            style={{
              height: `${height}px`,
              width: `${DOT_SIZE}px`,
              borderRadius: `${DOT_SIZE / 2}px`,
              opacity: isDeviceOn ? 1 : 0.5
            }}
          />
        );
      })}
    </div>
  );

  return (
    <div className="main-panel">
      <header className="main-panel-header">
        <h1>Realtime</h1>
        <div className="header-controls">
          <button className="settings-button" onClick={toggleSettings}>
            <Settings size={16} />
            <span>Settings</span>
          </button>
          <button className="logs-button" onClick={toggleLogs}>
            <Terminal size={16} />
            <span>Logs</span>
          </button>
        </div>
      </header>
      <div className="conversation-container">
        <div className="conversation-content">
          <div className="conversation-placeholder">
            <div className="placeholder-content">
              <div className="icon-container">
                <Users size={24} />
              </div>
              <span>Conversation will appear here</span>
            </div>
          </div>
        </div>
      </div>
      <div className="floating-controls">
        <button className="start-session-button">
          <PlayCircle size={16} />
          <span>Start session</span>
        </button>
        <div className="device-dropdown-container">
          <button className="device-selector-button" onClick={toggleDeviceDropdown}>
            {isDeviceOn ? (
              <span className="device-icon"><Mic size={16} /></span>
            ) : (
              <span className="device-icon device-off"><MicOff size={16} /></span>
            )}
            <span>{isLoading ? 'Loading devices...' : selectedDevice.label}</span>
            <AudioWaveform />
            <ChevronDown size={14} />
          </button>
          {showDeviceDropdown && (
            <div className="device-dropdown">
              <div className="device-list">
                {isLoading ? (
                  <div className="device-option">
                    <span>Loading devices...</span>
                  </div>
                ) : (
                  <>
                    {audioDevices.map((device) => (
                      <div
                        key={device.deviceId}
                        className={`device-option ${selectedDevice.deviceId === device.deviceId ? 'selected' : ''}`}
                        onClick={() => selectDevice(device)}
                      >
                        <div className="icon-container">
                          {selectedDevice.deviceId === device.deviceId && <Check size={14} />}
                        </div>
                        <span>{device.label}</span>
                      </div>
                    ))}
                    <div className="device-state-option" onClick={toggleDeviceState}>
                      <div className="icon-container">
                        {isDeviceOn ? <Mic size={14} /> : <MicOff size={14} />}
                      </div>
                      <span>{isDeviceOn ? 'On' : 'Off'}</span>
                      <AudioWaveform />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MainPanel;
