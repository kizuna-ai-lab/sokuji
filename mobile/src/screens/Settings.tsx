import { useMemo, useRef, useState } from 'react';
import { Appearance, type HostInstance } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SONIOX_REGION_LABELS, SONIOX_REGIONS } from '@shared/lib/soniox/regions';
import { ChoiceList } from '@/components/ChoiceList';
import { LanguagePicker } from '@/components/LanguagePicker';
import { Row, RowGroup } from '@/components/Row';
import { Screen } from '@/components/ScreenHeader';
import { SwitchRow } from '@/components/SwitchRow';
import { refocus } from '@/components/focus';
import { languageName, sourceOptions, targetOptions } from '../i18n/languages';
import { useSettings } from '../store/useSettings';
import { colorSchemeOverride, type Settings as SettingsValues } from '../store/settings';

const SIZES: SettingsValues['textSize'][] = ['small', 'medium', 'large'];
const APPEARANCES: SettingsValues['appearance'][] = ['system', 'light', 'dark'];

// An override of the system's scheme, which NativeWind's dark variables (and so
// every screen) follow.
export function applyAppearance(appearance: SettingsValues['appearance']): void {
  Appearance.setColorScheme(colorSchemeOverride(appearance));
}

// Its own screen (owner, 2026-10-27: the settings will grow). Each takes
// effect at once, except the region and the pair, which the next Start reads.
export default function Settings({ onBack, locked, onOpen }: { onBack: () => void; locked: boolean; onOpen: (screen: 'listen' | 'devices') => void }) {
  const { t, i18n } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  // Which side the sheet is for outlives its closing, so the sheet keeps its
  // title and list while it slides away.
  const [picking, setPicking] = useState(false);
  const [side, setSide] = useState<'source' | 'target'>('source');
  const sourceRow = useRef<HostInstance>(null);
  const targetRow = useRef<HostInstance>(null);
  const ui = i18n.language;
  const autoLabel = t('common.autoDetect');
  const lockedReason = t('mobile.settings.locked');
  const sources = useMemo(() => sourceOptions(ui, autoLabel), [ui, autoLabel]);
  const targets = useMemo(() => targetOptions(ui), [ui]);

  const openPicker = (which: 'source' | 'target') => {
    setSide(which);
    setPicking(true);
  };
  const closePicker = () => {
    refocus(side === 'source' ? sourceRow : targetRow);
    setPicking(false);
  };

  return (
    <Screen title={t('mobile.menu.settings')} onBack={onBack}>
      <RowGroup title={t('mobile.settings.groupLanguages')}>
        <Row
          ref={sourceRow}
          label={t('mobile.main.hear')}
          value={languageName(settings.source, ui, autoLabel)}
          disabled={locked}
          disabledReason={lockedReason}
          onPress={() => openPicker('source')}
        />
        <Row
          ref={targetRow}
          label={t('mobile.main.read')}
          value={languageName(settings.target, ui)}
          disabled={locked}
          disabledReason={lockedReason}
          onPress={() => openPicker('target')}
        />
      </RowGroup>

      <ChoiceList
        title={t('mobile.settings.textSize')}
        choices={SIZES.map((v) => ({
          value: v,
          label: { small: t('mobile.settings.textSizeSmall'), medium: t('mobile.settings.textSizeMedium'), large: t('mobile.settings.textSizeLarge') }[v],
        }))}
        value={settings.textSize}
        onChange={(v) => set({ textSize: v })}
      />

      <RowGroup title={t('mobile.settings.groupDisplay')}>
        <SwitchRow label={t('mobile.main.bilingual')} checked={settings.bilingual} onCheckedChange={(v) => set({ bilingual: v })} />
        <SwitchRow label={t('mobile.settings.keepAwake')} checked={settings.keepAwake} onCheckedChange={(v) => set({ keepAwake: v })} />
      </RowGroup>

      <ChoiceList
        title={t('mobile.settings.appearance')}
        choices={APPEARANCES.map((v) => ({
          value: v,
          label: { system: t('mobile.settings.appearanceSystem'), light: t('mobile.settings.appearanceLight'), dark: t('mobile.settings.appearanceDark') }[v],
        }))}
        value={settings.appearance}
        onChange={(v) => set({ appearance: v })}
      />

      <RowGroup title={t('mobile.settings.groupAudio')}>
        <Row
          label={t('mobile.settings.listen')}
          value={settings.listen ? t('common.on') : t('common.off')}
          disabled={locked}
          disabledReason={lockedReason}
          onPress={() => onOpen('listen')}
        />
        {/* Open during a session too: the output can be switched then; Devices locks the microphone itself. */}
        <Row label={t('mobile.settings.devices')} onPress={() => onOpen('devices')} />
      </RowGroup>

      <ChoiceList
        title={t('mobile.settings.region')}
        // What the region does, as the desktop says it: where the audio is processed, from the next session.
        footer={t('settings.sonioxRegionTooltip')}
        choices={SONIOX_REGIONS.map((r) => ({ value: r, label: SONIOX_REGION_LABELS[r] }))}
        value={settings.region}
        onChange={(v) => set({ region: v })}
        disabled={locked}
        disabledReason={lockedReason}
      />

      <LanguagePicker
        visible={picking}
        title={side === 'target' ? t('mobile.main.read') : t('mobile.main.hear')}
        options={side === 'target' ? targets : sources}
        value={side === 'target' ? settings.target : settings.source}
        onPick={(code) => {
          set(side === 'target' ? { target: code } : { source: code });
          closePicker();
        }}
        onClose={closePicker}
      />
    </Screen>
  );
}
