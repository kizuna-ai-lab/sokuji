import { useRef, useState } from 'react';
import { AppState, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useTranslation } from 'react-i18next';
import type { Entry } from '@shared/lib/projection/types';
import type { SonioxRegion } from '@shared/lib/soniox/regions';
import { startSession, type Status } from '../session/session';
import { createTranscript, type Transcript } from '../session/transcript';
import { createEntriesFeed } from '../session/entriesFeed';
import { useSettings } from '../store/useSettings';
import Subtitles from './Subtitles';

const REGIONS: SonioxRegion[] = ['us', 'eu', 'jp'];
const KEEP_AWAKE_TAG = 'sokuji-session';

export default function Main({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const setSettings = useSettings((s) => s.set);
  const [status, setStatus] = useState<Status | 'idle'>('idle');
  const [detail, setDetail] = useState('');
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const session = useRef<{ stop(): Promise<void> } | null>(null);
  const feed = useRef<{ stop(): void } | null>(null);
  const transcript = useRef<Transcript | null>(null);

  const active = status !== 'idle' && status !== 'stopped' && status !== 'error';

  // The session has released everything it held (microphone, notification,
  // lease); the screen releases its part and draws the transcript's last state.
  function ended() {
    session.current = null;
    feed.current?.stop();
    feed.current = null;
    transcript.current?.end();
    setEntries([...(transcript.current?.entries() ?? [])].reverse());
    deactivateKeepAwake(KEEP_AWAKE_TAG);
  }

  async function start() {
    // A second tap while the first is still starting would open a second
    // recorder and lease loop that nothing could stop: the handle is set
    // before the first await, and Start is Stop from the same render on.
    if (session.current) return;
    const { source, target, region } = settings;
    const tr = createTranscript({ source, target, sessionId: `s-${Date.now()}` });
    transcript.current = tr;
    const f = createEntriesFeed({
      transcript: tr,
      isActive: () => AppState.currentState === 'active',
      onActiveChange: (cb) => {
        const sub = AppState.addEventListener('change', (state) => cb(state === 'active'));
        return () => sub.remove();
      },
      now: Date.now,
      schedule: (fn, ms) => {
        const handle = setTimeout(fn, ms);
        return () => clearTimeout(handle);
      },
    });
    f.subscribe(setEntries);
    feed.current = f;
    setEntries([]);
    setStatus('leasing');
    setDetail('');
    session.current = startSession({
      token,
      region,
      source,
      target,
      transcript: tr,
      onEvent: (e) => {
        if (e.type !== 'status') return;
        setStatus(e.status);
        setDetail(e.detail ?? '');
        if (e.status === 'error' || e.status === 'stopped') ended();
      },
    });
    if (settings.keepAwake) {
      await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
      // Ended before the keep-awake was granted: give it back.
      if (!session.current) deactivateKeepAwake(KEEP_AWAKE_TAG);
    }
  }

  async function stop() {
    await session.current?.stop();
  }

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <TextInput style={styles.lang} value={settings.source} onChangeText={(v) => setSettings({ source: v.trim() })} autoCapitalize="none" editable={!active} />
        <Text>→</Text>
        <TextInput style={styles.lang} value={settings.target} onChangeText={(v) => setSettings({ target: v.trim() })} autoCapitalize="none" editable={!active} />
        {REGIONS.map((r) => (
          <Text key={r} style={[styles.region, r === settings.region && styles.regionOn]} onPress={() => !active && setSettings({ region: r })}>
            {r}
          </Text>
        ))}
      </View>
      <View style={styles.row}>
        <Button title={active ? t('mobile.main.stop') : t('mobile.main.start')} onPress={active ? stop : start} />
        <Text style={styles.status}>{statusLine(t, status, detail)}</Text>
      </View>
      <Subtitles entries={entries} bilingual={settings.bilingual} textSize={settings.textSize} />
      <View style={styles.row}>
        <Text style={styles.toggle} onPress={() => setSettings({ bilingual: !settings.bilingual })}>
          {t('mobile.main.bilingual')}: {settings.bilingual ? '✓' : '–'}
        </Text>
        <Button title={t('mobile.account.signOut')} disabled={active} onPress={onSignOut} />
      </View>
    </View>
  );
}

// What the status line says: a key per state, the terminal details by name,
// any other detail (a developer message) as it is.
function statusLine(t: (key: string) => string, status: Status | 'idle', detail: string): string {
  if (status === 'idle') return '';
  if (status === 'error') {
    if (detail === 'sign_in_required') return t('mobile.main.status.signInRequired');
    if (detail === 'balance_exhausted') return t('mobile.main.status.balanceExhausted');
    if (detail === 'microphone_denied') return t('mobile.main.status.micDenied');
    return detail;
  }
  if (status === 'listening') return t('mobile.main.status.listening');
  if (status === 'reconnecting') return t('mobile.main.status.reconnecting');
  if (status === 'stopped') return t('mobile.main.status.stopped');
  return t('mobile.main.status.starting');
}

const styles = StyleSheet.create({
  box: { flex: 1, width: '100%', padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  lang: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, minWidth: 56 },
  region: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, color: '#555' },
  regionOn: { backgroundColor: '#1e88e5', color: '#fff' },
  status: { fontWeight: '600', flexShrink: 1 },
  toggle: { color: '#1e63c4', paddingVertical: 6 },
});
