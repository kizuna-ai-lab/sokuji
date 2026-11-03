import { useTranslation } from 'react-i18next';
import type { VoiceSummaryProps } from '../../lib/provider/types';
import { PALABRA_VOICES, palabraParticipantVoice, type PalabraSettings as S } from './settings';

/**
 * The voice each leg reads in, for the Speech rows: mine, and the other
 * party's as a run speaks it (`palabraParticipantVoice`). A default is named
 * by its own name; any other voice by the name stored with its id when it
 * was picked, since only the voice list knows names (voice library spec §1);
 * failing that, it reads as a custom voice.
 */
export function PalabraVoiceSummary({ settings, leg }: VoiceSummaryProps<S>) {
  const { t } = useTranslation();
  const id = leg === 'participant' ? palabraParticipantVoice(settings) : settings.voiceId;
  const preset = PALABRA_VOICES.find((v) => v.value === id);
  if (preset) return <>{preset.name}</>;
  // The name stored beside whichever of the two ids this is.
  const stored = id === settings.voiceId ? settings.voiceName : id === settings.participantVoiceId ? settings.participantVoiceName : '';
  return <>{stored || t('settings.voiceCustom', 'Custom voice')}</>;
}
