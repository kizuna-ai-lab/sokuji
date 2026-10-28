import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { exportJson, exportText } from '../history/export';
import { shareExport } from '../history/share';
import type { HistoryStore, SessionSummary } from '../history/store';

function duration(startedAt: number, endedAt: number | null): string {
  if (endedAt === null) return '';
  const minutes = Math.max(0, Math.round((endedAt - startedAt) / 60000));
  return `${minutes} min`;
}

// The sessions on the device, newest first: rename, export, delete.
export default function History({ store, onBack }: { store: HistoryStore; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.replace('_', '-');
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => setSessions(await store.list()), [store]);
  useEffect(() => {
    void load();
  }, [load]);

  const name = (s: SessionSummary) => s.title || when.format(new Date(s.startedAt));

  async function share(s: SessionSummary, kind: 'txt' | 'json') {
    setError('');
    try {
      const full = await store.load(s.id);
      if (!full) return;
      const meta = {
        exportedAt: Date.now(),
        appVersion: Constants.expoConfig?.version ?? null,
        provider: 'soniox',
        models: { asr: 'stt-rt-v5' },
      };
      const body = kind === 'txt'
        ? exportText(
            full,
            {
              me: t('mainPanel.export.speakerYou'),
              other: t('mainPanel.export.speakerOther'),
              noTranslation: t('mainPanel.export.noTranslation'),
              noSource: t('mainPanel.export.noSource'),
              person: (n) => t('mainPanel.displayMode.person', { n }),
            },
            {
              title: t('mainPanel.export.headerTitle'),
              generated: t('mainPanel.export.headerGenerated'),
              provider: t('mainPanel.export.headerProvider'),
              models: t('mainPanel.export.headerModels'),
              source: t('mobile.main.hear'),
              target: t('mobile.main.read'),
              narrowed: t('mainPanel.export.headerNarrowed'),
            },
            meta,
          )
        : exportJson(full, meta);
      await shareExport(full, kind, body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSelected(null);
    }
  }

  function confirmDelete(s: SessionSummary) {
    setSelected(null);
    Alert.alert(t('mobile.history.delete'), name(s), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('mobile.history.delete'), style: 'destructive', onPress: async () => { await store.delete(s.id); await load(); } },
    ]);
  }

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Text accessibilityRole="button" style={styles.link} onPress={onBack}>‹ {t('mobile.common.back')}</Text>
        <Text style={styles.title}>{t('mobile.history.title')}</Text>
        <Text style={styles.link}> </Text>
      </View>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => setSelected(item)}>
            <Text style={styles.name}>{name(item)}</Text>
            <Text style={styles.meta}>{when.format(new Date(item.startedAt))} · {item.source} → {item.target} · {duration(item.startedAt, item.endedAt)}</Text>
          </Pressable>
        )}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Modal visible={selected !== null} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)} accessible={false}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{selected ? name(selected) : ''}</Text>
            <Text accessibilityRole="button" style={styles.sheetRow} onPress={() => { if (selected) { setTitle(selected.title ?? ''); setRenaming(selected); setSelected(null); } }}>{t('mobile.history.rename')}</Text>
            <Text accessibilityRole="button" style={styles.sheetRow} onPress={() => selected && share(selected, 'txt')}>{t('mobile.history.export')} (.txt)</Text>
            <Text accessibilityRole="button" style={styles.sheetRow} onPress={() => selected && share(selected, 'json')}>{t('mobile.history.export')} (.json)</Text>
            <Text accessibilityRole="button" style={[styles.sheetRow, styles.danger]} onPress={() => selected && confirmDelete(selected)}>{t('mobile.history.delete')}</Text>
          </View>
        </Pressable>
      </Modal>
      <Modal visible={renaming !== null} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <View style={styles.center}>
          <View style={styles.dialog}>
            <Text style={styles.sheetTitle}>{t('mobile.history.rename')}</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} autoFocus />
            <View style={styles.actions}>
              <Button title={t('common.cancel')} onPress={() => setRenaming(null)} />
              <Button
                title={t('mobile.history.rename')}
                onPress={async () => {
                  if (renaming) await store.rename(renaming.id, title.trim());
                  setRenaming(null);
                  await load();
                }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, width: '100%', padding: 12, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontWeight: '600', fontSize: 17 },
  link: { color: '#1e63c4', minWidth: 60 },
  row: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e5e5', gap: 2 },
  name: { fontSize: 16 },
  meta: { fontSize: 12, color: '#777' },
  error: { color: '#c0392b' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 4 },
  sheetTitle: { fontSize: 13, color: '#666', paddingVertical: 8 },
  sheetRow: { fontSize: 17, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd' },
  danger: { color: '#c0392b' },
  center: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10, fontSize: 16 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
