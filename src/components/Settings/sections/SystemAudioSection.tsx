import React from 'react';
import { AudioLines, AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import ToggleSwitch from '../shared/ToggleSwitch';
import {
  useIsParticipantMuted, useSetParticipantMuted,
  useParticipantSources, useSelectedParticipantSource, useSelectParticipantSource,
  useRefreshDevices, useIsAudioLoading,
  type AudioDevice,
} from '../../../stores/audioStore';
import DeviceList from '../shared/DeviceList';
import { useAnalytics } from '../../../lib/analytics';
import { useProvider } from '../../../stores/settingsStore';
import { Provider } from '../../../types/Provider';
import { isExtension, isElectron } from '../../../utils/environment';

interface SystemAudioSectionProps {
  /** Real session-active state — reserved for analytics-style consumers. */
  isSessionActive: boolean;
  /**
   * Lock the toggle. Defaults to isSessionActive for backward compatibility.
   * Callers that need per-channel locking (lock participant but not others)
   * pass this explicitly.
   */
  isLocked?: boolean;
  /** Additional class name */
  className?: string;
}

const SystemAudioSection: React.FC<SystemAudioSectionProps> = ({
  isSessionActive,
  isLocked,
  className = ''
}) => {
  const { t } = useTranslation();
  const provider = useProvider();
  const isParticipantMuted = useIsParticipantMuted();
  const setParticipantMuted = useSetParticipantMuted();
  const participantSources = useParticipantSources();
  const selectedParticipantSource = useSelectedParticipantSource();
  const selectParticipantSource = useSelectParticipantSource();
  const { trackEvent } = useAnalytics();
  const refreshDevices = useRefreshDevices();
  const isLoading = useIsAudioLoading();
  const locked = isLocked ?? isSessionActive;

  // The picker only earns its space when a capture helper actually reported
  // applications; with just the whole-system entry there is nothing to choose.
  const showSourcePicker = isElectron() && participantSources.length > 1;

  const handleSourceSelect = (device: AudioDevice) => {
    // Re-linking mid-session would tear down the live capture. The list is
    // rendered disabled too; this is the belt-and-braces guard.
    if (locked) return;
    selectParticipantSource(device);
    trackEvent('participant_source_selected', { deviceId: device.deviceId });
  };

  // Header help tooltip — explains what the participant channel captures.
  // Platform-conditional because Extension captures the active tab while
  // Electron captures all system audio.
  const description = isExtension()
    ? t('settings.participantSectionDescriptionExtension', 'Translate audio from the active browser tab. The original audio plays through your system default output.')
    : t('settings.participantSectionDescriptionElectron', 'Translate audio from any application playing on this system.');

  const handleToggle = () => {
    if (locked) return;
    setParticipantMuted(!isParticipantMuted);
  };

  return (
    <div
      className={`config-section system-audio-section ${className}`}
      id="participant-section"
      data-section-aliases="system-audio-section"
    >
      <h3>
        <AudioLines size={18} />
        <span>{t('settings.participantSectionHeader', 'Participant audio')}</span>
        <Tooltip
          content={description}
          position="top"
          icon="help"
          maxWidth={300}
        />
        {/* Gemini participant mode discards generated audio but still bills for
            its tokens — warn the user when the channel is active. */}
        {provider === Provider.GEMINI && !isParticipantMuted && (
          <Tooltip
            content={t('settings.geminiParticipantTokenWarning', 'Gemini participant mode generates audio responses that are discarded, resulting in additional token usage.')}
            position="top"
            maxWidth={280}
          >
            <AlertTriangle size={16} style={{ color: '#f59e0b', marginLeft: '4px' }} />
          </Tooltip>
        )}
      </h3>
      <ToggleSwitch
        checked={!isParticipantMuted}
        onChange={handleToggle}
        label={!isParticipantMuted ? t('common.on', 'On') : t('common.off', 'Off')}
        disabled={locked}
      />

      {/* Which application to capture. Hidden while the channel is off, since
          there is nothing to scope, and on platforms with no per-app helper. */}
      {showSourcePicker && !isParticipantMuted && (
        <div className="participant-source-picker">
          <div className="participant-source-header">
            <label className="participant-source-label">
              {t('audioPanel.participantSource', 'Participant Audio Source')}
            </label>
            {/* Applications come and go far more often than sound cards do, so
                this list goes stale faster than the mic/speaker ones. */}
            <button
              className="section-refresh-button"
              onClick={refreshDevices}
              disabled={isLoading}
              title={t('audioPanel.refreshDevices')}
            >
              <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
            </button>
          </div>
          <DeviceList
            devices={participantSources}
            selectedDevice={selectedParticipantSource}
            isDeviceOn={true}
            onSelect={handleSourceSelect}
            disabled={locked}
            deviceType="input"
            filterVirtual={false}
            showVirtualIndicators={false}
          />
        </div>
      )}
    </div>
  );
};

export default SystemAudioSection;
