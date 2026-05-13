import React from 'react';
import { useTranslation } from 'react-i18next';
import { Captions, CaptionsOff } from 'lucide-react';
import { useIsSessionActive } from '../../stores/sessionStore';
import {
  useEnterSubtitleMode,
  useExitSubtitleMode,
  useSubtitleModeActive,
} from '../../stores/settingsStore';
import { isElectron, isExtension } from '../../utils/environment';

const SubtitleEnterButton: React.FC = () => {
  const { t } = useTranslation();
  const enterSubtitleMode = useEnterSubtitleMode();
  const exitSubtitleMode = useExitSubtitleMode();
  const isSessionActive = useIsSessionActive();
  const subtitleActive = useSubtitleModeActive();

  if (!isElectron() && !isExtension()) return null;

  // While subtitle mode is active the button toggles to "Exit". Otherwise
  // it's the "Enter" affordance (disabled until a session starts).
  const enterLabel = t('subtitle.enterButton.label', 'Subtitle');
  const exitLabel = t('subtitle.exitButton.label', 'Exit subtitle');
  const enterTooltip = isSessionActive
    ? t('subtitle.enterButton.title', 'Enter subtitle mode')
    : t('subtitle.enterButton.disabled', 'Start a session first');
  const exitTooltip = t('subtitle.exitButton.title', 'Exit subtitle mode');

  const label = subtitleActive ? exitLabel : enterLabel;
  const tooltip = subtitleActive ? exitTooltip : enterTooltip;
  const Icon = subtitleActive ? CaptionsOff : Captions;
  const onClick = subtitleActive
    ? () => void exitSubtitleMode()
    : () => void enterSubtitleMode();
  // Exit is always available while active; Enter is gated on isSessionActive.
  const disabled = subtitleActive ? false : !isSessionActive;

  return (
    <button
      type="button"
      className={`title-bar__action ${subtitleActive ? 'is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      aria-label={tooltip}
    >
      <Icon size={14} />
      <span className="title-bar__action-label">{label}</span>
    </button>
  );
};

export default SubtitleEnterButton;
