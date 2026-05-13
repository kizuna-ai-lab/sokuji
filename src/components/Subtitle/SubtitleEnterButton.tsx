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
import { useToast } from '../Toast';
import { CONTENT_SCRIPT_UNAVAILABLE } from './surfaces/ExtensionContentScriptSubtitleSurface';

const SubtitleEnterButton: React.FC = () => {
  const { t } = useTranslation();
  const enterSubtitleMode = useEnterSubtitleMode();
  const exitSubtitleMode = useExitSubtitleMode();
  const isSessionActive = useIsSessionActive();
  const subtitleActive = useSubtitleModeActive();
  const { showToast } = useToast();

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
  const handleEnter = async () => {
    try {
      await enterSubtitleMode();
    } catch (err) {
      // Most common case (extension): the meeting tab was open before the
      // extension was reloaded, so the new content script was never
      // injected and chrome.tabs.sendMessage has no receiver. Prompt the
      // user to refresh.
      const code = (err as { code?: string } | null)?.code;
      if (code === CONTENT_SCRIPT_UNAVAILABLE) {
        showToast(
          t(
            'subtitle.enterButton.refreshPageHint',
            'Refresh the meeting tab and try again',
          ),
          { variant: 'error', durationMs: 5000 },
        );
      }
    }
  };
  const onClick = subtitleActive
    ? () => void exitSubtitleMode()
    : () => void handleEnter();
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
