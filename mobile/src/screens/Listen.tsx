import { useRef, useState } from 'react';
import type { HostInstance } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SONIOX_PARTICIPANT_DEFAULT_VOICE } from '@shared/lib/soniox/ttsCatalog';
import { SONIOX_VOICE_ROSTER } from '@shared/lib/soniox/sonioxVoiceRoster';
import { ChoiceList } from '@/components/ChoiceList';
import { Notice } from '@/components/Notice';
import { OptionSheet } from '@/components/OptionSheet';
import { Row, RowGroup } from '@/components/Row';
import { Screen } from '@/components/ScreenHeader';
import { SwitchRow } from '@/components/SwitchRow';
import { refocus } from '@/components/focus';
import { useSettings } from '../store/useSettings';

const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2, 1.3];

// R13: the other side's translation read aloud to me, through headphones.
// The words are the desktop's "Speech" panel's; a voice is described by the
// desktop voice library's accent and gender labels.
export default function Listen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  const [picking, setPicking] = useState(false);
  const voiceRow = useRef<HostInstance>(null);
  const current = settings.voice ?? SONIOX_PARTICIPANT_DEFAULT_VOICE;
  const voices = SONIOX_VOICE_ROSTER.map((v) => ({
    value: v.id,
    label: v.id,
    description: `${t(`voiceLibrary.filter.accent.${v.accent}`)} · ${t(`voiceLibrary.filter.gender.${v.gender}`)}`,
  }));
  const chosen = voices.find((v) => v.value === current);
  const close = () => {
    setPicking(false);
    refocus(voiceRow);
  };

  return (
    <Screen title={t('mobile.settings.listen')} onBack={onBack} backLabel={t('mobile.menu.settings')}>
      <RowGroup>
        <SwitchRow label={t('mobile.listen.toggle')} checked={settings.listen} onCheckedChange={(v) => set({ listen: v })} />
      </RowGroup>
      <Notice className="px-4">{t('mobile.listen.headphones')}</Notice>
      <ChoiceList
        title={t('mobile.listen.speed')}
        choices={SPEEDS.map((v) => ({ value: String(v), label: `${v.toFixed(1)}×` }))}
        value={String(settings.speed)}
        onChange={(v) => set({ speed: Number(v) })}
      />
      <RowGroup title={t('mobile.listen.voice')}>
        <Row ref={voiceRow} label={chosen?.label ?? current} value={chosen?.description} onPress={() => setPicking(true)} />
      </RowGroup>
      <OptionSheet
        visible={picking}
        title={t('mobile.listen.voice')}
        options={voices}
        value={current}
        searchLabel={t('mobile.listen.searchVoices')}
        emptyLabel={t('voiceLibrary.filter.empty')}
        onPick={(voice) => {
          set({ voice });
          close();
        }}
        onClose={close}
      />
    </Screen>
  );
}
