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
   * Lock the picker. Callers pass a mode-scope lock; the participant channel is
   * only selectable in participant/both mode.
   *
   * It deliberately does NOT default to isSessionActive: sources can be
   * switched during a live session, and defaulting to the session state
   * contradicted that for any caller that left this out.
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
  const locked = isLocked ?? false;

  // On Electron the source list replaces the on/off toggle entirely: its own
  // "Off" row is the control, so it must render even when the only source is
  // whole-system capture, or the channel could never be turned back on.
  // The extension has no source concept (tab capture is already scoped), so it
  // keeps the plain toggle.
  const showSourcePicker = isElectron() && participantSources.length > 0;

  const handleSourceSelect = (device: AudioDevice) => {
    // `locked` is about mode scope, not the session: picking a source during a
    // live session is supported and MainPanel rebuilds the capture around it.
    if (locked) return;
    selectParticipantSource(device);
    // Picking a source is also how the channel is switched back on, mirroring
    // the microphone and speaker lists.
    setParticipantMuted(false);
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
      data-tour="participant-section"
      data-section-aliases="system-audio-section"
    >
      <h3>
        <AudioLines size={18} />
        <span>{t('settings.participantSectionHeader', "Other's audio")}</span>
        <Tooltip
          content={description}
          position="top"
          icon="help"
          maxWidth={300}
        />
        {/* Gemini discards the audio it generates for Other's audio but still
            bills for its tokens. The gate is the channel, not the mode — the
            channel is unmuted in Other AND Both (see audioStore's mode->mute
            binding), so the warning must not name a single mode. */}
        {provider === Provider.GEMINI && !isParticipantMuted && (
          <Tooltip
            content={t('settings.geminiParticipantTokenWarning', "Gemini generates audio responses for Other's audio that are discarded, resulting in additional token usage.")}
            position="top"
            maxWidth={280}
          >
            <AlertTriangle size={16} style={{ color: '#f59e0b', marginLeft: '4px' }} />
          </Tooltip>
        )}
        {/* Applications come and go far more often than sound cards do, so this
            list goes stale faster than the mic/speaker ones. */}
        {showSourcePicker && (
          <button
            className="section-refresh-button"
            onClick={refreshDevices}
            disabled={isLoading}
            title={t('audioPanel.refreshDevices')}
          >
            <RefreshCw size={14} className={isLoading ? 'spinning' : ''} />
          </button>
        )}
      </h3>
      {showSourcePicker ? (
        <DeviceList
          devices={participantSources}
          selectedDevice={selectedParticipantSource}
          isDeviceOn={!isParticipantMuted}
          onSelect={handleSourceSelect}
          onToggleOff={() => { if (!locked) setParticipantMuted(true); }}
          disabled={locked}
          deviceType="input"
          filterVirtual={false}
          showVirtualIndicators={false}
          toggleAriaLabel={t('audioPanel.turnOffParticipant', "Turn off Other's audio")}
        />
      ) : (
        <ToggleSwitch
          checked={!isParticipantMuted}
          onChange={handleToggle}
          label={!isParticipantMuted ? t('common.on', 'On') : t('common.off', 'Off')}
          disabled={locked}
        />
      )}
    </div>
  );
};

export default SystemAudioSection;
