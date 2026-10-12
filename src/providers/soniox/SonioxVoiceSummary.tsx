import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import type { VoiceSummaryProps } from '../../lib/provider/types';
import { SONIOX_VOICES } from '../../lib/soniox/ttsCatalog';
import { participantVoiceFor, sonioxSpeakerVoice, type SonioxSettings as S } from './settings';

/**
 * The voice each leg reads in, for the Speech rows: mine, and the other
 * party's as a run speaks it (`participantVoiceFor`). A cloned voice is a
 * UUID whose name only the voice list knows, so it reads as the managed
 * account's own voice — the label its picker shows — or as a custom voice.
 */
export function createSonioxVoiceSummary({ managed }: { managed: boolean }): ComponentType<VoiceSummaryProps<S>> {
  return function SonioxVoiceSummary({ settings, leg }: VoiceSummaryProps<S>) {
    const { t } = useTranslation();
    const mine = sonioxSpeakerVoice(settings);
    const id = leg === 'participant' ? participantVoiceFor(settings, mine) : mine;
    const preset = SONIOX_VOICES.find((v) => v.value === id);
    if (preset) return <>{preset.name}</>;
    return <>{managed ? t('settings.sonioxManagedVoiceName', 'My voice') : t('settings.voiceCustom', 'Custom voice')}</>;
  };
}

/** An own key's. */
export const SonioxVoiceSummary = createSonioxVoiceSummary({ managed: false });
