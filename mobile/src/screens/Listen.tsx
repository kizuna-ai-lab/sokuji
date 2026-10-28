import { useEffect, useRef, useState } from 'react';
import { View, type HostInstance } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Play, Square } from 'lucide-react-native';
import { SONIOX_PARTICIPANT_DEFAULT_VOICE } from '@shared/lib/soniox/ttsCatalog';
import { SONIOX_VOICE_ROSTER } from '@shared/lib/soniox/sonioxVoiceRoster';
import { resolvePreviewSample } from '@shared/lib/tts/previewSample';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ChoiceList } from '@/components/ChoiceList';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Notice } from '@/components/Notice';
import { OptionSheet, SHEET_PORTAL } from '@/components/OptionSheet';
import { Row, RowGroup } from '@/components/Row';
import { Screen } from '@/components/ScreenHeader';
import { Spinner } from '@/components/Spinner';
import { SwitchRow } from '@/components/SwitchRow';
import { refocus } from '@/components/focus';
import { useIconSize } from '@/lib/useIconSize';
import { formatUsd } from '../account/money';
import type { PreviewState } from '../session/preview';
import { createNativeVoicePreview } from '../session/previewNative';
import { useSettings } from '../store/useSettings';
import { PREVIEW_ESTIMATE_USD, previewFailureKey } from './previewText';

const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2, 1.3];

// R13: the other side's translation read aloud to me, through headphones.
// The words are the desktop's "Speech" panel's; a voice is described by the
// desktop voice library's accent and gender labels. A voice can be heard
// before it is chosen: a short sample in the language I read, charged to the
// balance like the desktop's preview (owner, 2026-10-28).
export default function Listen({ token, onBack }: { token: string; onBack: () => void }) {
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

  // The preview lives as long as this screen: leaving it stops what plays.
  // A session cannot start from here, and the screen is locked while one runs.
  const [previewState, setPreviewState] = useState<PreviewState>({ status: 'idle' });
  const latest = useRef({ token, region: settings.region });
  latest.current = { token, region: settings.region };
  const [preview] = useState(() =>
    createNativeVoicePreview({ token: () => latest.current.token, region: () => latest.current.region, onChange: setPreviewState }),
  );
  useEffect(() => () => { void preview.close(); }, [preview]);
  // The voice waiting for the one-time "this is charged" confirmation.
  const [confirming, setConfirming] = useState<string | null>(null);
  const sample = resolvePreviewSample(settings.target, null);
  const playIcon = useIconSize(20);

  const close = () => {
    preview.stop();
    setPicking(false);
    refocus(voiceRow);
  };

  // A preview button: a separate target from choosing the voice; tapping it again stops it.
  const previewOf = (voice: string) => (previewState.status !== 'idle' && previewState.voice === voice ? previewState.status : 'idle');
  const onPreview = (voice: string) => {
    const now = previewOf(voice);
    if (now === 'requesting' || now === 'playing') {
      preview.stop();
      return;
    }
    if (!sample) return;
    if (!settings.previewCostSeen) {
      setConfirming(voice);
      return;
    }
    void preview.play(voice, sample, settings.speed);
  };
  const previewButton = (voice: string) => {
    const now = previewOf(voice);
    const active = now === 'requesting' || now === 'playing';
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled={!sample}
        accessibilityLabel={active ? t('mobile.listen.stopPreview') : t('mobile.listen.previewVoice', { voice })}
        accessibilityState={{ busy: now === 'requesting' }}
        onPress={() => onPreview(voice)}
      >
        {now === 'requesting' ? <Spinner /> : <Icon as={now === 'playing' ? Square : Play} size={playIcon} />}
      </Button>
    );
  };
  const failure = previewState.status === 'failed' ? <Notice tone="error">{t(previewFailureKey(previewState.reason))}</Notice> : null;
  const cost = `${t('voiceLibrary.previewChargedToBalance')} ${t('mobile.listen.previewEstimate', { amount: formatUsd(PREVIEW_ESTIMATE_USD) })}`;

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
      <RowGroup title={t('mobile.listen.voice')} footer={cost}>
        <View className="flex-row items-center pe-1">
          <View className="flex-1">
            <Row ref={voiceRow} label={chosen?.label ?? current} value={chosen?.description} onPress={() => setPicking(true)} />
          </View>
          {previewButton(current)}
        </View>
      </RowGroup>
      {!picking && failure ? <View className="px-4">{failure}</View> : null}
      <OptionSheet
        visible={picking}
        title={t('mobile.listen.voice')}
        options={voices}
        value={current}
        searchLabel={t('mobile.listen.searchVoices')}
        emptyLabel={t('voiceLibrary.filter.empty')}
        note={
          <View className="gap-2">
            <Notice>{cost}</Notice>
            {failure}
          </View>
        }
        renderAction={(o) => previewButton(o.value)}
        onPick={(voice) => {
          set({ voice });
          close();
        }}
        onClose={close}
      />
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => { if (!open) setConfirming(null); }}
        title={t('mobile.listen.previewConfirmTitle')}
        description={cost}
        confirmLabel={t('mobile.listen.preview')}
        portalHost={picking ? SHEET_PORTAL : undefined}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          const voice = confirming;
          set({ previewCostSeen: true });
          if (voice && sample) void preview.play(voice, sample, settings.speed);
        }}
      />
    </Screen>
  );
}
