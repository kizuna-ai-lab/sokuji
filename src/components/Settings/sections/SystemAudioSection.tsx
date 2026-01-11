import React, { useState, useCallback, useEffect } from 'react';
import { AudioLines, AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import WarningModal from '../shared/WarningModal';
import { WarningType, AudioDevice } from '../shared/hooks';
import { useAudioContext, useSetSystemAudioLoopbackSourceId } from '../../../stores/audioStore';
import { useProvider } from '../../../stores/settingsStore';
import { ServiceFactory } from '../../../services/ServiceFactory';
import { isExtension, isElectron } from '../../../utils/environment';
import { Provider } from '../../../types/Provider';
import { useAnalytics } from '../../../lib/analytics';

interface SystemAudioSectionProps {
  isSessionActive: boolean;
  /** If monitor device is enabled (for mutual exclusivity check) */
  isMonitorDeviceOn?: boolean;
  /** Callback when participant audio is clicked while speaker is on */
  onMutualExclusivity?: () => void;
  /** Additional class name */
  className?: string;
}

const SystemAudioSection: React.FC<SystemAudioSectionProps> = ({
  isSessionActive,
  isMonitorDeviceOn = false,
  onMutualExclusivity,
  className = ''
}) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const provider = useProvider();

  const {
    audioMonitorDevices,
    systemAudioSources,
    selectedSystemAudioSource,
    isSystemAudioCaptureEnabled,
    participantAudioOutputDevice,
    isLoading,
    selectSystemAudioSource,
    toggleSystemAudioCapture,
    setSystemAudioCaptureActive,
    selectParticipantAudioOutputDevice,
    refreshSystemAudioSources,
    refreshDevices
  } = useAudioContext();

  const setSystemAudioLoopbackSourceId = useSetSystemAudioLoopbackSourceId();
  const [isSystemAudioLoading, setIsSystemAudioLoading] = useState(false);
  const [warningType, setWarningType] = useState<WarningType | null>(null);

  // Refresh system audio sources on mount
  useEffect(() => {
    if (refreshSystemAudioSources) {
      refreshSystemAudioSources();
    }
  }, [refreshSystemAudioSources]);

  // Handle system audio source selection for Electron
  const handleSystemAudioSourceSelect = useCallback(async (source: { deviceId: string; label: string } | null) => {
    if (isSystemAudioLoading) return;

    try {
      setIsSystemAudioLoading(true);
      const audioService = ServiceFactory.getAudioService();

      if (source) {
        console.info(`[Sokuji] [SystemAudioSection] Connecting system audio source: ${source.label}`);
        await audioService.connectSystemAudioSource(source.deviceId);

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
        console.info(`[Sokuji] [SystemAudioSection] System audio source connected: ${source.label}`);
      } else {
        console.info('[Sokuji] [SystemAudioSection] Disconnecting system audio source');
        await audioService.disconnectSystemAudioSource();

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
        console.info('[Sokuji] [SystemAudioSection] System audio source disconnected');
      }
    } catch (error) {
      console.error('[Sokuji] [SystemAudioSection] Error handling system audio source:', error);
    } finally {
      setIsSystemAudioLoading(false);
    }
  }, [isSystemAudioLoading, isSystemAudioCaptureEnabled, selectSystemAudioSource, toggleSystemAudioCapture, setSystemAudioCaptureActive, setSystemAudioLoopbackSourceId, trackEvent, isSessionActive]);

  // Check if we should show this section
  const shouldShow = isElectron()
    ? (systemAudioSources && systemAudioSources.length > 0)
    : isExtension();

  if (!shouldShow) {
    return null;
  }

  // Filter out sokuji devices from monitor devices for extension output selection
  const filteredMonitorDevices = audioMonitorDevices.filter(
    device => !device.label.toLowerCase().includes('sokuji')
  );

  const handleDeviceClick = (device: AudioDevice | null, isSource: boolean) => {
    if (isSessionActive) return;

    // Check mutual exclusivity with speaker
    if (device && isMonitorDeviceOn) {
      if (onMutualExclusivity) {
        onMutualExclusivity();
      } else {
        setWarningType('mutual-exclusivity-participant');
      }
      return;
    }

    if (isSource) {
      // Electron: source selection
      handleSystemAudioSourceSelect(device);
    } else {
      // Extension: output device selection
      if (device) {
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
      } else {
        if (isSystemAudioCaptureEnabled) {
          toggleSystemAudioCapture();
        }
      }
    }
  };

  return (
    <>
      <WarningModal
        isOpen={warningType !== null}
        onClose={() => setWarningType(null)}
        type={warningType}
      />

      <div className={`config-section ${className}`} id="system-audio-section">
        <h3>
          <AudioLines size={18} />
          <span>{t('simpleConfig.systemAudio', 'Participant Audio')}</span>
          <Tooltip
            content={isExtension()
              ? t('simpleConfig.systemAudioDescExtension', 'Capture and translate audio from the current tab. This allows you to hear translations of other meeting participants.')
              : t('simpleConfig.systemAudioDesc', 'Capture and translate audio from other meeting participants. Select which audio output to capture.')
            }
            position="top"
            icon="help"
            maxWidth={300}
          />
          {provider === Provider.GEMINI && isSystemAudioCaptureEnabled && (
            <Tooltip
              content={t('settings.geminiParticipantTokenWarning', 'Gemini participant mode generates audio responses that are discarded, resulting in additional token usage.')}
              position="top"
              maxWidth={280}
            >
              <AlertTriangle size={16} style={{ color: '#f59e0b', marginLeft: '4px' }} />
            </Tooltip>
          )}
        </h3>

        <div className="device-list">
          {isExtension() ? (
            // Extension: Toggle with output device selection
            <>
              <div
                className={`device-option ${!isSystemAudioCaptureEnabled ? 'selected' : ''} ${isSessionActive ? 'disabled' : ''}`}
                onClick={() => {
                  if (isSessionActive) return;
                  if (isSystemAudioCaptureEnabled) {
                    toggleSystemAudioCapture();
                  }
                }}
              >
                <span>{t('common.off')}</span>
                {!isSystemAudioCaptureEnabled && <div className="selected-indicator" />}
              </div>
              {filteredMonitorDevices.map((device) => (
                <div
                  key={device.deviceId}
                  className={`device-option ${isSystemAudioCaptureEnabled && participantAudioOutputDevice?.deviceId === device.deviceId ? 'selected' : ''} ${isSessionActive || isMonitorDeviceOn ? 'disabled' : ''}`}
                  onClick={() => handleDeviceClick(device, false)}
                >
                  <span>{device.label || t('audioPanel.unknownDevice')}</span>
                  {isSystemAudioCaptureEnabled && participantAudioOutputDevice?.deviceId === device.deviceId && <div className="selected-indicator" />}
                </div>
              ))}
            </>
          ) : (
            // Electron: Show source selection
            <>
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
              <div
                className={`device-option ${!isSystemAudioCaptureEnabled ? 'selected' : ''} ${isSystemAudioLoading || isSessionActive ? 'loading' : ''}`}
                onClick={() => {
                  if (isSessionActive) return;
                  handleSystemAudioSourceSelect(null);
                }}
              >
                <span>{t('common.off')}</span>
                {!isSystemAudioCaptureEnabled && <div className="selected-indicator" />}
              </div>
              {systemAudioSources.map((source) => (
                <div
                  key={source.deviceId}
                  className={`device-option ${isSystemAudioCaptureEnabled && selectedSystemAudioSource?.deviceId === source.deviceId ? 'selected' : ''} ${isSystemAudioLoading ? 'loading' : ''} ${isMonitorDeviceOn || isSessionActive ? 'disabled' : ''}`}
                  onClick={() => handleDeviceClick(source, true)}
                >
                  <span>{source.label || t('audioPanel.unknownDevice')}</span>
                  {isSystemAudioCaptureEnabled && selectedSystemAudioSource?.deviceId === source.deviceId && <div className="selected-indicator" />}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default SystemAudioSection;
