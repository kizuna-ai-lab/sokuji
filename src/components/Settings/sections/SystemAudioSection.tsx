import React, { useState, useCallback, useEffect } from 'react';
import { AudioLines, AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import DeviceList from '../shared/DeviceList';
import WarningModal from '../shared/WarningModal';
import { WarningType, AudioDevice } from '../shared/hooks';
import { useAudioContext, useSetSystemAudioSourceReady } from '../../../stores/audioStore';
import { useProvider } from '../../../stores/settingsStore';
import { ServiceFactory } from '../../../services/ServiceFactory';
import { isExtension, isElectron, isLoopbackPlatform, isMacOS } from '../../../utils/environment';
import { Provider } from '../../../types/Provider';
import { useAnalytics } from '../../../lib/analytics';

interface SystemAudioSectionProps {
  isSessionActive: boolean;
  /** Additional class name */
  className?: string;
}

const SystemAudioSection: React.FC<SystemAudioSectionProps> = ({
  isSessionActive,
  className = ''
}) => {
  const { t } = useTranslation();
  const { trackEvent } = useAnalytics();
  const provider = useProvider();

  const {
    audioMonitorDevices,
    systemAudioSources,
    selectedParticipantSource,
    isParticipantMuted,
    selectedParticipantOutput,
    isLoading,
    selectSystemAudioSource,
    setParticipantMuted,
    setSystemAudioCaptureActive,
    selectParticipantOutput,
    refreshSystemAudioSources,
    refreshDevices,
  } = useAudioContext();

  const setSystemAudioSourceReady = useSetSystemAudioSourceReady();
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

        setSystemAudioSourceReady(true);
        selectSystemAudioSource(source);
        if (isParticipantMuted) {
          setParticipantMuted(false);
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

        setSystemAudioSourceReady(false);
        selectSystemAudioSource(null);
        if (!isParticipantMuted) {
          setParticipantMuted(true);
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
  }, [isSystemAudioLoading, isParticipantMuted, selectSystemAudioSource, setParticipantMuted, setSystemAudioCaptureActive, setSystemAudioSourceReady, trackEvent, isSessionActive]);

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

    if (isSource) {
      // Electron: source selection
      handleSystemAudioSourceSelect(device);
    } else {
      // Extension: output device selection
      if (device) {
        if (isParticipantMuted) {
          setParticipantMuted(false);
        }
        selectParticipantOutput(device);
        trackEvent('audio_device_changed', {
          device_type: 'participant_output',
          device_name: device.label,
          change_type: 'selected',
          during_session: isSessionActive
        });
      } else {
        if (!isParticipantMuted) {
          setParticipantMuted(true);
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

      <div
        className={`config-section ${className}`}
        id="participant-section"
        data-section-aliases="system-audio-section"
      >
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
          {provider === Provider.GEMINI && !isParticipantMuted && (
            <Tooltip
              content={t('settings.geminiParticipantTokenWarning', 'Gemini participant mode generates audio responses that are discarded, resulting in additional token usage.')}
              position="top"
              maxWidth={280}
            >
              <AlertTriangle size={16} style={{ color: '#f59e0b', marginLeft: '4px' }} />
            </Tooltip>
          )}
          {/* Show refresh button for Extension (output devices) */}
          {/* Electron has single "System Audio" source via electron-audio-loopback, no refresh needed */}
          {isExtension() && (
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
            selectedDevice={selectedParticipantOutput}
            isDeviceOn={!isParticipantMuted}
            onSelect={(device) => handleDeviceClick(device, false)}
            onToggleOff={() => {
              if (isSessionActive) return;
              if (!isParticipantMuted) {
                setParticipantMuted(true);
              }
            }}
            disabled={isSessionActive}
            deviceType="output"
          />
        ) : (
          // Electron: Show source selection
          <DeviceList
            devices={systemAudioSources as AudioDevice[]}
            selectedDevice={selectedParticipantSource as AudioDevice | null}
            isDeviceOn={!isParticipantMuted}
            onSelect={(device) => handleDeviceClick(device, true)}
            onToggleOff={() => {
              if (isSessionActive) return;
              handleSystemAudioSourceSelect(null);
            }}
            disabled={isSessionActive || isSystemAudioLoading}
            deviceType="input"
          />
        )}
      </div>
    </>
  );
};

export default SystemAudioSection;
