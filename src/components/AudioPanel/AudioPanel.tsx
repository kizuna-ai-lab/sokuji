import React, { useState, useCallback, useEffect } from 'react';
import { ArrowRight, RefreshCw, AlertTriangle } from 'lucide-react';
import Tooltip from '../Tooltip/Tooltip';
import { ServiceFactory } from '../../services/ServiceFactory';
import { useSetSystemAudioLoopbackSourceId } from '../../stores/audioStore';
import './AudioPanel.scss';
import Modal from '../Modal/Modal';
import { useAudioContext } from '../../stores/audioStore';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '../../lib/analytics';
import { useIsSessionActive } from '../../stores/sessionStore';
import { isExtension } from '../../utils/environment';

const AudioPanel: React.FC<{ toggleAudio: () => void }> = ({ toggleAudio }) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const isSessionActive = useIsSessionActive();
  const [showVirtualMicWarning, setShowVirtualMicWarning] = useState(false);
  const [showVirtualSpeakerWarning, setShowVirtualSpeakerWarning] = useState(false);
  const [showMutualExclusivityWarning, setShowMutualExclusivityWarning] = useState(false);
  const [mutualExclusivityWarningType, setMutualExclusivityWarningType] = useState<'speaker' | 'participant'>('speaker');

  const {
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
    // System audio capture settings
    systemAudioSources,
    selectedSystemAudioSource,
    isSystemAudioCaptureEnabled,
    participantAudioOutputDevice,
    selectInputDevice,
    selectMonitorDevice,
    toggleInputDeviceState,
    toggleMonitorDeviceState,
    toggleRealVoicePassthrough,
    setRealVoicePassthroughVolume,
    selectSystemAudioSource,
    toggleSystemAudioCapture,
    setSystemAudioCaptureActive,
    selectParticipantAudioOutputDevice,
    refreshSystemAudioSources,
    refreshDevices
  } = useAudioContext();
  const setSystemAudioLoopbackSourceId = useSetSystemAudioLoopbackSourceId();
  const [isSystemAudioLoading, setIsSystemAudioLoading] = useState(false);

  // Check if a device is the virtual microphone
  const isVirtualMic = (device: {deviceId: string; label: string}) => {
    const labelLower = device.label.toLowerCase();
    return labelLower.includes('sokuji_virtual_mic') ||
           labelLower.includes('sokuji_system_audio') ||
           labelLower.includes('sokujivirtualaudio') || // Mac virtual device
           labelLower.includes('cable');
  };

  // Check if a device is the virtual speaker
  const isVirtualSpeaker = (device: {deviceId: string; label: string}) => {
    const labelLower = device.label.toLowerCase();
    return labelLower.includes('sokuji_virtual_speaker') ||
           labelLower.includes('sokuji_system_audio') ||
           labelLower.includes('sokujivirtualaudio') || // Mac virtual device
           labelLower.includes('cable');
  };

  // Handle input device selection with virtual mic check
  const handleInputDeviceSelection = (device: {deviceId: string; label: string; isDefault?: boolean}) => {
    if (isVirtualMic(device)) {
      setShowVirtualMicWarning(true);
      trackEvent('virtual_device_warning', {
        device_type: 'input',
        action_taken: 'ignored'
      });
    } else {
      selectInputDevice(device);
      trackEvent('audio_device_changed', {
        device_type: 'input',
        device_name: device.label,
        change_type: 'selected',
        during_session: isSessionActive
      });
    }
  };

  // Handle monitor device selection with virtual speaker check
  const handleMonitorDeviceSelection = (device: {deviceId: string; label: string; isDefault?: boolean}) => {
    if (isVirtualSpeaker(device)) {
      setShowVirtualSpeakerWarning(true);
      trackEvent('virtual_device_warning', {
        device_type: 'output',
        action_taken: 'ignored'
      });
    } else {
      selectMonitorDevice(device);
      trackEvent('audio_device_changed', {
        device_type: 'output',
        device_name: device.label,
        change_type: 'selected',
        during_session: isSessionActive
      });
    }
  };

  // Initialize system audio sources
  useEffect(() => {
    if (refreshSystemAudioSources) {
      refreshSystemAudioSources();
    }
  }, [refreshSystemAudioSources]);

  // Handle system audio source selection
  const handleSystemAudioSourceSelect = useCallback(async (source: { deviceId: string; label: string } | null) => {
    if (isSystemAudioLoading) return;

    try {
      setIsSystemAudioLoading(true);
      const audioService = ServiceFactory.getAudioService();

      if (source) {
        // User selected a device - connect via pw-link
        console.info(`[Sokuji] [AudioPanel] Connecting system audio source: ${source.label}`);
        await audioService.connectSystemAudioSource(source.deviceId);

        // Update state - always use 'sokuji_system_audio_mic' (stable deviceId)
        setSystemAudioLoopbackSourceId('sokuji_system_audio_mic');
        selectSystemAudioSource(source);
        if (!isSystemAudioCaptureEnabled) {
          toggleSystemAudioCapture();
        }
        setSystemAudioCaptureActive(true);
        trackEvent('audio_device_changed', {
          device_type: 'input',
          device_name: `[System Audio] ${source.label}`,
          change_type: 'connected',
          during_session: isSessionActive
        });
        console.info(`[Sokuji] [AudioPanel] System audio source connected: ${source.label}`);
      } else {
        // User selected "Off" - disconnect
        console.info('[Sokuji] [AudioPanel] Disconnecting system audio source');
        await audioService.disconnectSystemAudioSource();

        // Update state
        setSystemAudioLoopbackSourceId(null);
        selectSystemAudioSource(null);
        if (isSystemAudioCaptureEnabled) {
          toggleSystemAudioCapture();
        }
        setSystemAudioCaptureActive(false);
        trackEvent('audio_device_changed', {
          device_type: 'input',
          device_name: '[System Audio] Off',
          change_type: 'disconnected',
          during_session: isSessionActive
        });
        console.info('[Sokuji] [AudioPanel] System audio source disconnected');
      }
    } catch (error) {
      console.error('[Sokuji] [AudioPanel] Error handling system audio source:', error);
    } finally {
      setIsSystemAudioLoading(false);
    }
  }, [isSystemAudioLoading, isSystemAudioCaptureEnabled, selectSystemAudioSource, toggleSystemAudioCapture, setSystemAudioCaptureActive, setSystemAudioLoopbackSourceId, trackEvent]);

  return (
    <div className="audio-panel">
      <Modal 
        isOpen={showVirtualMicWarning} 
        onClose={() => setShowVirtualMicWarning(false)}
        title={t('audioPanel.virtualMicrophoneNotice')}
      >
        <div className="virtual-mic-warning">
          <div className="warning-icon">
            <AlertTriangle size={24} color="#f0ad4e" />
          </div>
          <p>
            <strong>{t('audioPanel.virtualMicWarningTitle')}</strong>
          </p>
          <p>
            {t('audioPanel.virtualMicWarningText1')}
          </p>
          <p>
            {t('audioPanel.virtualMicWarningText2')}
          </p>
          <button 
            className="understand-button" 
            onClick={() => setShowVirtualMicWarning(false)}
          >
            {t('audioPanel.iUnderstand')}
          </button>
        </div>
      </Modal>

      <Modal 
        isOpen={showVirtualSpeakerWarning} 
        onClose={() => setShowVirtualSpeakerWarning(false)}
        title={t('audioPanel.virtualSpeakerNotice')}
      >
        <div className="virtual-mic-warning">
          <div className="warning-icon">
            <AlertTriangle size={24} color="#f0ad4e" />
          </div>
          <p>
            <strong>{t('audioPanel.virtualSpeakerWarningTitle')}</strong>
          </p>
          <p>
            {t('audioPanel.virtualSpeakerWarningText1')}
          </p>
          <p>
            {t('audioPanel.virtualSpeakerWarningText2')}
          </p>
          <p>
            {t('audioPanel.virtualSpeakerWarningText3')}
          </p>
          <p>
            {t('audioPanel.virtualSpeakerWarningText4')}
          </p>
          <button
            className="understand-button"
            onClick={() => setShowVirtualSpeakerWarning(false)}
          >
            {t('audioPanel.iUnderstand')}
          </button>
        </div>
      </Modal>

      <Modal
        isOpen={showMutualExclusivityWarning}
        onClose={() => setShowMutualExclusivityWarning(false)}
        title={t('audioPanel.mutualExclusivityNotice', 'Audio Conflict')}
      >
        <div className="virtual-mic-warning">
          <div className="warning-icon">
            <AlertTriangle size={24} color="#f0ad4e" />
          </div>
          <p>
            <strong>
              {mutualExclusivityWarningType === 'speaker'
                ? t('audioPanel.mutualExclusivitySpeakerTitle', 'Cannot enable Speaker')
                : t('audioPanel.mutualExclusivityParticipantTitle', 'Cannot enable Participant Audio')
              }
            </strong>
          </p>
          <p>
            {mutualExclusivityWarningType === 'speaker'
              ? t('audioPanel.mutualExclusivitySpeakerText', 'Please turn off Participant Audio before enabling Speaker.')
              : t('audioPanel.mutualExclusivityParticipantText', 'Please turn off Speaker before enabling Participant Audio.')
            }
          </p>
          <button
            className="understand-button"
            onClick={() => setShowMutualExclusivityWarning(false)}
          >
            {t('audioPanel.iUnderstand')}
          </button>
        </div>
      </Modal>

      <div className="audio-panel-header">
        <h2>{t('audioPanel.title')}</h2>
        <button className="close-audio-button" onClick={toggleAudio}>
          <ArrowRight size={16} />
          <span>{t('common.close')}</span>
        </button>
      </div>
      <div className="audio-content">
        {/* Input Device Section */}
        <div className="audio-section microphone-section">
          <h3>
            {t('audioPanel.audioInputDevice')}
            <Tooltip
              content={t('simpleConfig.microphoneDesc')}
              position="top"
              icon="help"
              maxWidth={300}
            />
          </h3>
          <div className="device-list">
            <div className="device-list-header">
              <h4>{t('audioPanel.availableInputDevices')}</h4>
              <button
                className="refresh-button"
                onClick={() => refreshDevices()}
                disabled={isLoading}
                title={t('audioPanel.refreshInputDevices')}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {/* Off option */}
            <div
              className={`device-option ${!isInputDeviceOn ? 'selected' : ''}`}
              onClick={() => {
                if (isInputDeviceOn) {
                  toggleInputDeviceState();
                }
              }}
            >
              <span>{t('common.off', 'Off')}</span>
              {!isInputDeviceOn && <div className="selected-indicator" />}
            </div>
            {/* Device options */}
            {audioInputDevices.map((device, index) => (
              <div
                key={index}
                className={`device-option ${isInputDeviceOn && selectedInputDevice?.deviceId === device.deviceId ? 'selected' : ''}`}
                onClick={() => {
                  if (!isInputDeviceOn) {
                    toggleInputDeviceState();
                  }
                  handleInputDeviceSelection(device);
                }}
              >
                <span>{device.label}</span>
                {isVirtualMic(device) && (
                  <div className="virtual-indicator" title={t('audioPanel.virtualMicrophone')}>
                    <AlertTriangle size={14} color="#f0ad4e" />
                  </div>
                )}
                {isInputDeviceOn && selectedInputDevice?.deviceId === device.deviceId && <div className="selected-indicator" />}
              </div>
            ))}
          </div>
        </div>

        {/* Monitor Device Section */}
        <div className="audio-section speaker-section">
          <h3>
            {t('audioPanel.virtualSpeakerMonitorDevice')}
            <Tooltip
              content={t('simpleConfig.speakerDesc')}
              position="top"
              icon="help"
              maxWidth={300}
            />
          </h3>
          <div className="device-list">
            <div className="device-list-header">
              <h4>{t('audioPanel.availableMonitorDevices')}</h4>
              <button
                className="refresh-button"
                onClick={() => refreshDevices()}
                disabled={isLoading}
                title={t('audioPanel.refreshMonitorDevices')}
              >
                <RefreshCw size={14} />
              </button>
            </div>
            {/* Off option */}
            <div
              className={`device-option ${!isMonitorDeviceOn ? 'selected' : ''}`}
              onClick={() => {
                if (isMonitorDeviceOn) {
                  toggleMonitorDeviceState();
                }
              }}
            >
              <span>{t('common.off', 'Off')}</span>
              {!isMonitorDeviceOn && <div className="selected-indicator" />}
            </div>
            {/* Device options */}
            {audioMonitorDevices.map((device, index) => (
              <div
                key={index}
                className={`device-option ${isMonitorDeviceOn && selectedMonitorDevice?.deviceId === device.deviceId ? 'selected' : ''} ${isSystemAudioCaptureEnabled ? 'disabled' : ''}`}
                onClick={() => {
                  // Mutual exclusivity: if System Audio is ON, show warning
                  if (isSystemAudioCaptureEnabled) {
                    setShowMutualExclusivityWarning(true);
                    setMutualExclusivityWarningType('speaker');
                    return;
                  }
                  // Select device and enable if not already on
                  if (!isMonitorDeviceOn) {
                    toggleMonitorDeviceState();
                  }
                  handleMonitorDeviceSelection(device);
                }}
              >
                <span>{device.label}</span>
                {isVirtualSpeaker(device) && (
                  <div className="virtual-indicator" title={t('audioPanel.virtualSpeaker')}>
                    <AlertTriangle size={14} color="#f0ad4e" />
                  </div>
                )}
                {isMonitorDeviceOn && selectedMonitorDevice?.deviceId === device.deviceId && <div className="selected-indicator" />}
              </div>
            ))}
          </div>
        </div>

        {/* System Audio Capture Section - Show for Extension (tab capture) or Electron (system audio sources) */}
        {(isExtension() || (systemAudioSources && systemAudioSources.length > 0)) && (
          <div className="audio-section">
            <h3>
              {t('simpleConfig.systemAudio', 'Participant Audio')}
              <Tooltip
                content={isExtension()
                  ? t('simpleConfig.systemAudioDescExtension')
                  : t('simpleConfig.systemAudioDesc')
                }
                position="top"
                icon="help"
                maxWidth={300}
              />
            </h3>

            {/* Extension: Output device selection with Off option */}
            {isExtension() && (
              <div className="device-list">
                <div className="device-list-header">
                  <h4>{t('audioPanel.outputDevice', 'Output Device')}</h4>
                  <button
                    className="refresh-button"
                    onClick={() => refreshDevices()}
                    disabled={isLoading || isSessionActive}
                    title={t('audioPanel.refreshMonitorDevices')}
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
                {/* Off option */}
                <div
                  className={`device-option ${!isSystemAudioCaptureEnabled ? 'selected' : ''} ${isSessionActive ? 'disabled' : ''}`}
                  onClick={() => {
                    if (isSessionActive) return;
                    if (isSystemAudioCaptureEnabled) {
                      toggleSystemAudioCapture();
                    }
                  }}
                >
                  <span>{t('common.off', 'Off')}</span>
                  {!isSystemAudioCaptureEnabled && <div className="selected-indicator" />}
                </div>
                {/* Device options */}
                {audioMonitorDevices.filter(device => !device.label.toLowerCase().includes('sokuji')).map((device) => (
                  <div
                    key={device.deviceId}
                    className={`device-option ${isSystemAudioCaptureEnabled && participantAudioOutputDevice?.deviceId === device.deviceId ? 'selected' : ''} ${isSessionActive || isMonitorDeviceOn ? 'disabled' : ''}`}
                    onClick={() => {
                      if (isSessionActive) return;
                      // Mutual exclusivity: if Monitor Device is ON, show warning
                      if (isMonitorDeviceOn) {
                        setShowMutualExclusivityWarning(true);
                        setMutualExclusivityWarningType('participant');
                        return;
                      }
                      // Select device and enable if not already on
                      if (!isSystemAudioCaptureEnabled) {
                        toggleSystemAudioCapture();
                      }
                      selectParticipantAudioOutputDevice(device);
                      trackEvent('audio_device_changed', {
                        device_type: 'participant_output',
                        device_name: device.label,
                        change_type: 'selected',
                        during_session: isSessionActive
                      });
                    }}
                  >
                    <span>{device.label || t('audioPanel.unknownDevice')}</span>
                    {isSystemAudioCaptureEnabled && participantAudioOutputDevice?.deviceId === device.deviceId && <div className="selected-indicator" />}
                  </div>
                ))}
              </div>
            )}

            {/* Electron: Source selection list with Off option */}
            {!isExtension() && systemAudioSources && systemAudioSources.length > 0 && (
              <div className="device-list">
                <div className="device-list-header">
                  <h4>{t('audioPanel.availableSystemAudioSources', 'Available Sources')}</h4>
                  <button
                    className="refresh-button"
                    onClick={() => refreshSystemAudioSources && refreshSystemAudioSources()}
                    disabled={isLoading || isSystemAudioLoading}
                    title={t('audioPanel.refreshSystemAudioSources', 'Refresh sources')}
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
                {/* Off option */}
                <div
                  className={`device-option ${!isSystemAudioCaptureEnabled ? 'selected' : ''} ${isSystemAudioLoading || isSessionActive ? 'disabled' : ''}`}
                  onClick={() => {
                    if (isSessionActive) return;
                    handleSystemAudioSourceSelect(null);
                  }}
                >
                  <span>{t('common.off', 'Off')}</span>
                  {!isSystemAudioCaptureEnabled && <div className="selected-indicator" />}
                </div>
                {/* Source options */}
                {systemAudioSources.map((source) => (
                  <div
                    key={source.deviceId}
                    className={`device-option ${isSystemAudioCaptureEnabled && selectedSystemAudioSource?.deviceId === source.deviceId ? 'selected' : ''} ${isSystemAudioLoading ? 'loading' : ''} ${isMonitorDeviceOn || isSessionActive ? 'disabled' : ''}`}
                    onClick={() => {
                      // Cannot change during active session
                      if (isSessionActive) return;
                      // Mutual exclusivity: if Monitor Device is ON, show warning
                      if (isMonitorDeviceOn) {
                        setShowMutualExclusivityWarning(true);
                        setMutualExclusivityWarningType('participant');
                        return;
                      }
                      handleSystemAudioSourceSelect(source);
                    }}
                  >
                    <span>{source.label || t('audioPanel.unknownDevice')}</span>
                    {isSystemAudioCaptureEnabled && selectedSystemAudioSource?.deviceId === source.deviceId && <div className="selected-indicator" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Real Person Voice Passthrough Section */}
        <div className="audio-section voice-passthrough-section">
          <h3>
            {t('audioPanel.realVoicePassthrough')}
            <Tooltip
              content={t('audioPanel.realVoicePassthroughDescription')}
              position="top"
              icon="help"
              maxWidth={300}
            />
          </h3>
          <div className="device-list">
            {/* Off option */}
            <div
              className={`device-option ${!isRealVoicePassthroughEnabled ? 'selected' : ''}`}
              onClick={() => {
                if (isRealVoicePassthroughEnabled) {
                  toggleRealVoicePassthrough();
                  trackEvent('audio_passthrough_toggled', {
                    enabled: false,
                    volume_level: realVoicePassthroughVolume
                  });
                }
              }}
            >
              <span>{t('common.off', 'Off')}</span>
              {!isRealVoicePassthroughEnabled && <div className="selected-indicator" />}
            </div>
            {/* On option */}
            <div
              className={`device-option ${isRealVoicePassthroughEnabled ? 'selected' : ''}`}
              onClick={() => {
                if (!isRealVoicePassthroughEnabled) {
                  toggleRealVoicePassthrough();
                  trackEvent('audio_passthrough_toggled', {
                    enabled: true,
                    volume_level: realVoicePassthroughVolume
                  });
                }
              }}
            >
              <span>{t('common.on', 'On')}</span>
              {isRealVoicePassthroughEnabled && <div className="selected-indicator" />}
            </div>
            {/* Volume slider - shown when enabled */}
            {isRealVoicePassthroughEnabled && (
              <div className="volume-control">
                <div className="setting-label">
                  <span>{t('audioPanel.realVoiceVolume')}</span>
                  <span className="setting-value">{Math.round(realVoicePassthroughVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="0.6"
                  step="0.01"
                  value={realVoicePassthroughVolume}
                  onChange={(e) => {
                    const newVolume = parseFloat(e.target.value);
                    setRealVoicePassthroughVolume(newVolume);
                  }}
                  onMouseUp={(e) => {
                    // Track volume change on mouse up to avoid too many events
                    trackEvent('ui_interaction', {
                      component: 'AudioPanel',
                      action: 'passthrough_volume_changed',
                      element: 'volume_slider',
                      value: parseFloat((e.target as HTMLInputElement).value)
                    });
                  }}
                  className="volume-slider"
                />
                <div className="volume-limits">
                  <span>0%</span>
                  <span>60%</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AudioPanel;
