import { Appearance, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SonioxRegion } from '@shared/lib/soniox/regions';
import { useSettings } from '../store/useSettings';
import type { Settings as SettingsValues } from '../store/settings';

const REGIONS: SonioxRegion[] = ['us', 'eu', 'jp'];
const SIZES: SettingsValues['textSize'][] = ['small', 'medium', 'large'];
const APPEARANCES: SettingsValues['appearance'][] = ['system', 'light', 'dark'];

// An override of the system's scheme; the app's own palette for dark is a
// follow-up, so for now this only changes what useColorScheme() reports.
export function applyAppearance(appearance: SettingsValues['appearance']): void {
  const api = Appearance as unknown as { setColorScheme?: (scheme: 'light' | 'dark' | null) => void };
  api.setColorScheme?.(appearance === 'system' ? null : appearance);
}

// Its own screen (owner, 2026-10-27: the settings will grow). Each takes
// effect at once, except the region and the pair, which the next Start reads.
export default function Settings({ onBack, locked, onOpen }: { onBack: () => void; locked: boolean; onOpen: (screen: 'listen' | 'devices') => void }) {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  const sizeLabel = { small: t('mobile.settings.textSizeSmall'), medium: t('mobile.settings.textSizeMedium'), large: t('mobile.settings.textSizeLarge') };
  const appearanceLabel = { system: t('mobile.settings.appearanceSystem'), light: t('mobile.settings.appearanceLight'), dark: t('mobile.settings.appearanceDark') };

  const choices = <T extends string>(values: readonly T[], current: T, label: (v: T) => string, onPick: (v: T) => void, disabled = false) => (
    <View style={styles.choices}>
      {values.map((v) => (
        <Text accessibilityRole="button" key={v} style={[styles.choice, v === current && styles.choiceOn, disabled && styles.disabled]} onPress={() => !disabled && onPick(v)}>
          {label(v)}
        </Text>
      ))}
    </View>
  );

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Text accessibilityRole="button" style={styles.link} onPress={onBack}>‹ {t('mobile.common.back')}</Text>
        <Text style={styles.title}>{t('mobile.menu.settings')}</Text>
        <Text style={styles.link}> </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{t('mobile.main.hear')}</Text>
        <TextInput style={styles.input} value={settings.source} onChangeText={(v) => set({ source: v.trim() })} autoCapitalize="none" editable={!locked} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{t('mobile.main.read')}</Text>
        <TextInput style={styles.input} value={settings.target} onChangeText={(v) => set({ target: v.trim() })} autoCapitalize="none" editable={!locked} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{t('mobile.main.bilingual')}</Text>
        <Switch value={settings.bilingual} onValueChange={(v) => set({ bilingual: v })} />
      </View>
      <Text accessibilityRole="button" style={[styles.row, styles.rowLink]} onPress={() => onOpen('listen')}>
        {t('mobile.settings.listen')}  ›  {settings.listen ? t('common.on') : t('common.off')}
      </Text>
      <View style={styles.row}>
        <Text style={styles.label}>{t('mobile.settings.textSize')}</Text>
        {choices(SIZES, settings.textSize, (v) => sizeLabel[v], (v) => set({ textSize: v }))}
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{t('mobile.settings.appearance')}</Text>
        {choices(APPEARANCES, settings.appearance, (v) => appearanceLabel[v], (v) => { set({ appearance: v }); applyAppearance(v); })}
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{t('mobile.settings.keepAwake')}</Text>
        <Switch value={settings.keepAwake} onValueChange={(v) => set({ keepAwake: v })} />
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{t('mobile.settings.region')}</Text>
        {choices(REGIONS, settings.region, (v) => v.toUpperCase(), (v) => set({ region: v }), locked)}
      </View>
      <Text accessibilityRole="button" style={[styles.row, styles.rowLink]} onPress={() => onOpen('devices')}>{t('mobile.settings.devices')}  ›</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, width: '100%', padding: 12, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontWeight: '600', fontSize: 17 },
  link: { color: '#1e63c4', minWidth: 60 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd', gap: 8 },
  label: { fontSize: 16, flexShrink: 1 },
  rowLink: { fontSize: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, minWidth: 72, textAlign: 'right' },
  choices: { flexDirection: 'row', gap: 4 },
  choice: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, color: '#555' },
  choiceOn: { backgroundColor: '#e3eefb', color: '#1e63c4', fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
