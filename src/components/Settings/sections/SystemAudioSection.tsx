import React from 'react';
import { AudioLines, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tooltip from '../../Tooltip/Tooltip';
import ToggleSwitch from '../shared/ToggleSwitch';
import { useIsParticipantMuted, useSetParticipantMuted } from '../../../stores/audioStore';
import { useProvider } from '../../../stores/settingsStore';
import { Provider } from '../../../types/Provider';
import { isExtension } from '../../../utils/environment';

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
  const locked = isLocked ?? isSessionActive;

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
    </div>
  );
};

export default SystemAudioSection;
