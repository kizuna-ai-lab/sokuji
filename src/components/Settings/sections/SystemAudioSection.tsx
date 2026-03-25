import React, { useState, useCallback, useEffect } from 'react';
import { AudioLines, AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import DeviceList from '../shared/DeviceList';
import WarningModal from '../shared/WarningModal';
import { WarningType, AudioDevice } from '../shared/hooks';
import { useAudioContext, useSetSystemAudioLoopbackSourceId } from '../../../stores/audioStore';
import { useProvider } from '../../../stores/settingsStore';
import { ServiceFactory } from '../../../services/ServiceFactory';
import { isExtension, isElectron, isLoopbackPlatform, isMacOS, isLinux } from '../../../utils/environment';
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
    refreshDevices,
  } = useAudioContext();

  const setSystemAudioLoopbackSourceId = useSetSystemAudioLoopbackSourceId();
  const [isSystemAudioLoading, setIsSystemAudioLoading] = useState(false);
  const [warningType, setWarningType] = useState<WarningType | null>(null);

  // Refresh system audio sources once on mount.
  // refreshSystemAudioSources is a stable Zustand action — no need to list it
  // as a dependency. Including it caused an infinite loop because the action
  // sets systemAudioSources (new array each call), which invalidates the
  // useAudioContext() useMemo, which re-triggers this effect.
  useEffect(() => {
    refreshSystemAudioSources?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle system audio source selection for Electron
  const handleSystemAudioSourceSelect = useCallback(async (source: { deviceId: string; label: string } | null) => {
    if (isSystemAudioLoading) return;

    try {
      setIsSystemAudioLoading(true);
      const audioService = ServiceFactory.getAudioService();

      if (source) {
        console.info(`[Sokuji] [SystemAudioSection] Connecting system audio source: ${source.label}`);

        // For Windows/macOS Electron, request loopback audio stream early
        // This tests the capture and holds the stream for when session starts
        if (isElectron() && !isExtension()) {
          if (isLoopbackPlatform()) {
            console.info('[Sokuji] [SystemAudioSection] Checking screen recording permission...');
            const permissionGranted = await audioService.requestLoopbackAudioStream();

            if (!permissionGranted) {
              console.error('[Sokuji] [SystemAudioSection] Screen recording permission not granted');
              setIsSystemAudioLoading(false);
              // Show permission denied warning on macOS
              if (isMacOS()) {
                setWarningType('screen-recording-denied');
              }
              return; // Don't proceed if permission not granted
            }

            console.info('[Sokuji] [SystemAudioSection] Screen recording permission granted');
          }
        }

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
          {/* Show refresh button for Extension (output devices) and Linux Electron (multiple sinks) */}
          {/* Windows/macOS Electron only has single "System Audio" source, no refresh needed */}
          {(isExtension() || isLinux()) && (
            <button
              className="section-refresh-button"
              onClick={() => {
                if (isExtension()) {
                  refreshDevices();
                } else {
                  refreshSystemAudioSources && refreshSystemAudioSources();
                }
              }}
              disabled={isLoading || isSystemAudioLoading || isSessionActive}
              title={t('audioPanel.refreshDevices')}
            >
              <RefreshCw size={14} className={isLoading || isSystemAudioLoading ? 'spinning' : ''} />
            </button>
          )}
        </h3>

        {isExtension() ? (
          // Extension: Toggle with output device selection
          <DeviceList
            devices={filteredMonitorDevices}
            selectedDevice={participantAudioOutputDevice}
            isDeviceOn={isSystemAudioCaptureEnabled}
            onSelect={(device) => handleDeviceClick(device, false)}
            onToggleOff={() => {
              if (isSessionActive) return;
              if (isSystemAudioCaptureEnabled) {
                toggleSystemAudioCapture();
              }
            }}
            disabled={isSessionActive || isMonitorDeviceOn}
            deviceType="output"
          />
        ) : (
          // Electron: Show source selection
          <DeviceList
            devices={systemAudioSources as AudioDevice[]}
            selectedDevice={selectedSystemAudioSource as AudioDevice | null}
            isDeviceOn={isSystemAudioCaptureEnabled}
            onSelect={(device) => handleDeviceClick(device, true)}
            onToggleOff={() => {
              if (isSessionActive) return;
              handleSystemAudioSourceSelect(null);
            }}
            disabled={isMonitorDeviceOn || isSessionActive || isSystemAudioLoading}
            deviceType="input"
          />
        )}
      </div>
    </>
  );
};

export default SystemAudioSection;
