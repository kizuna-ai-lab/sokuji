import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SONIOX_PARTICIPANT_DEFAULT_VOICE, SONIOX_VOICES } from '@shared/lib/soniox/ttsCatalog';
import { useSettings } from '../store/useSettings';

const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2, 1.3];

// R13: the other side's translation read aloud to me, through headphones.
// The words are the desktop's "Speech" panel's.
export default function Listen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  const [voices, setVoices] = useState<Array<{ name: string; value: string }>>([]);
  useEffect(() => {
    setVoices(SONIOX_VOICES);
  }, []);
  const current = settings.voice ?? SONIOX_PARTICIPANT_DEFAULT_VOICE;

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Text accessibilityRole="button" style={styles.link} onPress={onBack}>‹ {t('mobile.menu.settings')}</Text>
        <Text style={styles.title}>{t('mobile.settings.listen')}</Text>
        <Text style={styles.link}> </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{t('mobile.listen.toggle')}</Text>
        <Switch value={settings.listen} onValueChange={(v) => set({ listen: v })} />
      </View>
      <Text style={styles.note}>{t('mobile.listen.headphones')}</Text>
      <Text style={styles.section}>{t('mobile.listen.speed')}</Text>
      <View style={styles.choices}>
        {SPEEDS.map((v) => (
          <Text accessibilityRole="button" key={v} style={[styles.choice, v === settings.speed && styles.choiceOn]} onPress={() => set({ speed: v })}>
            {v.toFixed(1)}×
          </Text>
        ))}
      </View>
      <Text style={styles.section}>{t('mobile.listen.voice')}</Text>
      <ScrollView style={styles.voices}>
        {voices.map((v) => (
          <Text accessibilityRole="button" key={v.value} style={[styles.voice, v.value === current && styles.voiceOn]} onPress={() => set({ voice: v.value })}>
            {v.name}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, width: '100%', padding: 12, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontWeight: '600', fontSize: 17 },
  link: { color: '#1e63c4', minWidth: 60 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, gap: 8 },
  label: { fontSize: 16, flexShrink: 1 },
  note: { fontSize: 12, color: '#666' },
  section: { fontSize: 12, color: '#666', marginTop: 12 },
  choices: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  choice: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, color: '#555' },
  choiceOn: { backgroundColor: '#e3eefb', color: '#1e63c4', fontWeight: '600' },
  voices: { flex: 1 },
  voice: { fontSize: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  voiceOn: { color: '#1e63c4', fontWeight: '600' },
});
