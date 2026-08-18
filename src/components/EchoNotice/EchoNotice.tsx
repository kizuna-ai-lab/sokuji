import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { EchoCause, EchoNoticeState } from '../../lib/modern-audio/EchoMonitor';
import './EchoNotice.scss';

/**
 * Floating, non-blocking notice for a measured echo condition.
 *
 * Unlike its device-name-heuristic predecessor this only ever appears when the
 * EchoMonitor has actually correlated captured audio against something this
 * machine played, so the copy can be specific about which loop exists and what
 * fixes it.
 */

const MESSAGE_KEY: Record<EchoCause, { message: string; fallback: string; action: string; actionFallback: string }> = {
  'tts-echo': {
    message: 'echoNotice.ttsEcho',
    fallback: "Your speakers are feeding Sokuji's translated speech back into the microphone.",
    action: 'echoNotice.actionHeadphones',
    actionFallback: 'Using headphones will break the loop.',
  },
  'meeting-echo': {
    message: 'echoNotice.meetingEcho',
    fallback: 'Meeting audio from your speakers is reaching the microphone.',
    action: 'echoNotice.actionHeadphones',
    actionFallback: 'Using headphones will break the loop.',
  },
  'far-end-echo': {
    message: 'echoNotice.farEndEcho',
    fallback: "A participant's device is echoing your translation back into the meeting.",
    action: 'echoNotice.actionAskRemote',
    actionFallback: 'Ask that participant to use headphones.',
  },
  'self-capture': {
    message: 'echoNotice.selfCapture',
    fallback: "The participant source is capturing Sokuji's own audio.",
    action: 'echoNotice.actionPickApp',
    actionFallback: 'Pick the meeting application as the participant source instead of system audio.',
  },
  'routing-loop': {
    message: 'echoNotice.routingLoop',
    fallback: "The selected input device is capturing this computer's playback directly.",
    action: 'echoNotice.actionChangeInput',
    actionFallback: 'Pick a physical microphone as the input device.',
  },
};

interface EchoNoticeProps {
  state: EchoNoticeState | null;
  onDismiss: () => void;
}

const EchoNotice: React.FC<EchoNoticeProps> = ({ state, onDismiss }) => {
  const { t } = useTranslation();

  if (!state) {
    return null;
  }

  const keys = MESSAGE_KEY[state.cause];

  return (
    <div className="echo-notice" role="alert" data-cause={state.cause}>
      <AlertTriangle size={14} className="echo-notice-icon" />
      <div className="echo-notice-text">
        <span className="echo-notice-message">{t(keys.message, keys.fallback)}</span>
        <span className="echo-notice-action">{t(keys.action, keys.actionFallback)}</span>
      </div>
      <button
        className="echo-notice-dismiss"
        onClick={onDismiss}
        aria-label={t('echoNotice.dismiss', 'Dismiss')}
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default EchoNotice;
