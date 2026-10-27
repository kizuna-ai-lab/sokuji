import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AudioManager } from 'react-native-audio-api';
import { microphoneChoices, routeOf, type MicrophoneKind, type Route } from '../session/route';
import { useSettings } from '../store/useSettings';

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
  const chosen = settings.inputDeviceId;

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Text style={styles.link} onPress={onBack}>‹ {t('mobile.menu.settings')}</Text>
        <Text style={styles.title}>{t('mobile.settings.devices')}</Text>
        <Text style={styles.link}> </Text>
      </View>
      <Text style={styles.section}>{t('mobile.devices.microphone')}</Text>
      {mics.map((m, i) => {
        const selected = chosen === null ? m.kind === 'builtin' && i === mics.findIndex((x) => x.kind === 'builtin') : chosen === m.id;
        return (
          <Text key={m.id} style={styles.row} onPress={() => set({ inputDeviceId: m.kind === 'builtin' ? null : m.id })}>
            {kindLabel[m.kind]}{m.kind !== 'builtin' ? ` · ${m.name}` : ''}{selected ? '  ✓' : ''}
          </Text>
        );
      })}
      <Text style={styles.note}>{t('mobile.devices.noBluetoothMic')}</Text>
      <Text style={styles.section}>{t('mobile.devices.output')}</Text>
      <Text style={styles.row}>{outputName || route}</Text>
      <Text style={styles.note}>{t('mobile.listen.headphones')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, width: '100%', padding: 12, gap: 6 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontWeight: '600', fontSize: 17 },
  link: { color: '#1e63c4', minWidth: 60 },
  section: { fontSize: 12, color: '#666', marginTop: 12 },
  row: { fontSize: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  note: { fontSize: 12, color: '#666' },
});
