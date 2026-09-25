import { useTranslation } from 'react-i18next';
import ToggleSwitch from '../shared/ToggleSwitch';
import { participantSpeechHeard } from '../../../lib/modern-audio/participantSource';
import useAudioStore from '../../../stores/audioStore';
import { useRoutingStore } from '../../../stores/routingStore';
import { isElectron } from '../../../utils/environment';

/**
 * The participant-TTS opt-in approved 2026-09-06 (1e-3 ruling 8): Other's
 * translation read aloud on the real device. Locked during a run: the run's
 * shape froze it (roadmap 1d-1 → 1e).
 *
 * The whole-system rule (1e-3b-2 ruling 7, completed): on Electron, while the
 * chosen participant source is not one application (`app:…`), it captures the
 * whole system — Sokuji's own output included — so Other's translation played
 * on the real device would be captured and translated again as Other, the
 * loop the replay gate exists to prevent. `participantSpeechHeard` is the one
 * predicate this switch, the run's shape (`appShape.ts`), the playback route
 * (`appAudio.ts`'s `readRouting`) and the replay slot (`MainPanel.tsx`) all
 * share, so what the switch shows is what the run does. So the switch shows
 * off and disabled then, with a tooltip naming why; the stored choice is kept
 * (Text only's forced display keeps its setting the same way).
 */
export function ParticipantSpeechSwitch({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const participantSpeech = useRoutingStore((s) => s.participantSpeech);
  const selectedParticipantSource = useAudioStore((s) => s.selectedParticipantSource);
  const heard = participantSpeechHeard(isElectron() ? 'electron' : 'other', selectedParticipantSource?.deviceId);
  return (
    <ToggleSwitch
      checked={participantSpeech && heard}
      onChange={() => useRoutingStore.getState().setParticipantSpeech(!participantSpeech)}
      label={t('audioPanel.participantSpeech')}
      disabled={locked || !heard}
      tooltip={heard ? t('audioPanel.participantSpeechDesc') : t('audioPanel.participantSpeechBlockedWholeSystem')}
    />
  );
}
