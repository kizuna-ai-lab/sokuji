import React from 'react';
import { AudioLines } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ToggleSwitch from '../shared/ToggleSwitch';
import { useIsParticipantMuted, useSetParticipantMuted } from '../../../stores/audioStore';
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
  const isParticipantMuted = useIsParticipantMuted();
  const setParticipantMuted = useSetParticipantMuted();
  const locked = isLocked ?? isSessionActive;

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
      </h3>
      <p className="config-section-description">{description}</p>
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
