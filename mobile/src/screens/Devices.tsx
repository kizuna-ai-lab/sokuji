import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioManager } from 'react-native-audio-api';
import { ChoiceList } from '@/components/ChoiceList';
import { Notice } from '@/components/Notice';
import { Row, RowGroup } from '@/components/Row';
import { Screen } from '@/components/ScreenHeader';
import { microphoneChoices, routeOf, type MicrophoneKind, type Route } from '../session/route';
import { useSettings } from '../store/useSettings';
import { outputLines } from './deviceText';

// R14: the microphone is the user's choice among the phone's own, a wired
// headset's and a USB one (never Bluetooth); the output device is shown as
// the system routes it. The system's own output picker is a native view
// still to be added on the macOS machine; until then the route is read-only here.
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
  const chosen = settings.inputDeviceId ?? mics[firstBuiltin]?.id ?? '';
  const output = outputLines(t, route, outputName);

  return (
    <Screen title={t('mobile.settings.devices')} onBack={onBack} backLabel={t('mobile.menu.settings')}>
      {shown.length > 0 ? (
        <ChoiceList
          title={t('mobile.devices.microphone')}
          footer={t('mobile.devices.noBluetoothMic')}
          choices={shown.map((m) => ({ value: m.id, label: kindLabel[m.kind], description: m.kind !== 'builtin' ? m.name : undefined }))}
          value={chosen}
          onChange={(id) => {
            const m = mics.find((x) => x.id === id);
            set({ inputDeviceId: m?.kind === 'builtin' ? null : id });
          }}
        />
      ) : null}
      <RowGroup title={t('mobile.devices.output')}>
        <Row label={output.label} value={output.value} />
      </RowGroup>
      <Notice className="px-4">{t('mobile.listen.headphones')}</Notice>
    </Screen>
  );
}
