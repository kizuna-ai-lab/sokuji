import type { EchoCause } from '../modern-audio/EchoMonitor';

/** The echo causes' words: the problem and what fixes it (moved from EchoNotice.tsx; spec 2026-10-05 §3). */
export const ECHO_WORDS: Readonly<Record<EchoCause, { message: string; fallback: string; action: string; actionFallback: string }>> = {
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
