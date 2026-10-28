import { useCallback, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AudioManager } from 'react-native-audio-api';
import { ChoiceList } from '@/components/ChoiceList';
import { Notice } from '@/components/Notice';
import { Row, RowGroup } from '@/components/Row';
import { Screen } from '@/components/ScreenHeader';
import { microphoneChoices, routeOf, type MicrophoneKind, type Route } from '../session/route';
import { useSettings } from '../store/useSettings';
import { outputLines } from './deviceText';
import { RoutePickerView, showOutputSwitcher } from '../../modules/route-picker/src/RoutePickerModule';

// R14: the microphone is the user's choice among the phone's own, a wired
// headset's and a USB one (never Bluetooth); the output device is the one the
// system routes to, changed in the system's own picker, which the output row
// opens (modules/route-picker). The route change event refreshes the row.
export default function Devices({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  const [mics, setMics] = useState<Array<{ id: string; kind: MicrophoneKind; name: string }>>([]);
  const [route, setRoute] = useState<Route>('speaker');
  const [outputName, setOutputName] = useState('');

  const refresh = useCallback(async () => {
    try {
      const info = await AudioManager.getDevicesInfo();
      setMics(microphoneChoices(info));
      setRoute(routeOf(info));
      setOutputName(info.currentOutputs[0]?.name ?? '');
    } catch {
      setMics([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const sub = AudioManager.addSystemEventListener('routeChange', () => { void refresh(); });
    return () => sub?.remove();
  }, [refresh]);

  const kindLabel: Record<MicrophoneKind, string> = {
    builtin: t('mobile.devices.builtIn'),
    wired: t('mobile.devices.wired'),
    usb: t('mobile.devices.usb'),
  };
  // The phone's own microphone is one choice (null: the system picks among its
  // built-in ones), shown once; a wired or USB one by its name.
  const firstBuiltin = mics.findIndex((m) => m.kind === 'builtin');
  const shown = mics.filter((m, i) => m.kind !== 'builtin' || i === firstBuiltin);
  // A stored microphone that is not plugged in now is not what records: the phone's own is.
  const stored = shown.some((m) => m.id === settings.inputDeviceId) ? settings.inputDeviceId : null;
  const chosen = stored ?? mics[firstBuiltin]?.id ?? '';
  const output = outputLines(t, route, outputName);

  return (
    <Screen title={t('mobile.settings.devices')} onBack={onBack} backLabel={t('mobile.menu.settings')}>
      {/* Before the devices are listed, or if listing fails, the phone's own microphone (no stored choice) is what is used. */}
      <ChoiceList
        title={t('mobile.devices.microphone')}
        footer={t('mobile.devices.noBluetoothMic')}
        choices={shown.length > 0 ? shown.map((m) => ({ value: m.id, label: kindLabel[m.kind], description: m.kind !== 'builtin' ? m.name : undefined })) : [{ value: '', label: kindLabel.builtin }]}
        value={chosen}
        onChange={(id) => {
          const m = mics.find((x) => x.id === id);
          set({ inputDeviceId: !m || m.kind === 'builtin' ? null : id });
        }}
      />
      <RowGroup title={t('mobile.devices.output')}>
        <OutputRow label={output.label} value={output.value} hint={t('mobile.devices.chooseOutput')} />
      </RowGroup>
      <Notice className="px-4">{t('mobile.listen.headphones')}</Notice>
    </Screen>
  );
}

// The output row opens the system's picker. On iOS the picker is a native view
// laid over the row (no API opens it from code); it is the one element a screen
// reader meets, so the row under it is hidden from one. On Android a press opens
// the media output panel.
function OutputRow({ label, value, hint }: { label: string; value?: string; hint: string }) {
  if (Platform.OS === 'ios' && RoutePickerView) {
    const Picker = RoutePickerView;
    return (
      <View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
          <Row label={label} value={value} chevron />
        </View>
        <Picker label={[label, value, hint].filter(Boolean).join(', ')} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
      </View>
    );
  }
  return <Row label={label} value={value} accessibilityHint={hint} onPress={() => { showOutputSwitcher(); }} />;
}
