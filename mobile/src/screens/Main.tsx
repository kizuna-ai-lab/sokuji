import { useEffect, useRef, useState } from 'react';
import { AppState, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useTranslation } from 'react-i18next';
import type { Entry } from '@shared/lib/projection/types';
import type { SonioxRegion } from '@shared/lib/soniox/regions';
import { startSession, type Status } from '../session/session';
import { createTranscript, type Transcript } from '../session/transcript';

const REGIONS: SonioxRegion[] = ['us', 'eu', 'jp'];
const KEEP_AWAKE_TAG = 'sokuji-session';
// Only the tail is rendered: re-rendering an hour of text on every token starved the JS thread.
const SHOWN_LINES = 20;
const FLUSH_MS = 1000;

interface Lane {
  text: string;
  pending: string;
}

const emptyLane = (): Lane => ({ text: '', pending: '' });

// The last entries of one side as two runs of text: the final rows, then the
// rows still being spoken (drawn muted). Task 5 replaces this with the list.
function tail(entries: readonly Entry[], side: 'source' | 'translation'): Lane {
  const lines: string[] = [];
  let pending = '';
  for (const e of entries.slice(-SHOWN_LINES)) {
    if (e.kind !== 'exchange') continue;
    const rows = e[side];
    const final = rows.filter((r) => r.final).map((r) => r.text).join('');
    const open = rows.filter((r) => !r.final).map((r) => r.text).join('');
    if (final) lines.push(final);
    if (open) pending = open;
  }
  return { text: lines.join('\n'), pending };
}

export default function Main({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const { t } = useTranslation();
  const [source, setSource] = useState('en');
  const [target, setTarget] = useState('zh');
  const [region, setRegion] = useState<SonioxRegion>('us');
  const [status, setStatus] = useState<Status | 'idle'>('idle');
  const [detail, setDetail] = useState('');
  const [heard, setHeard] = useState<Lane>(emptyLane);
  const [translation, setTranslation] = useState<Lane>(emptyLane);
  const session = useRef<{ stop(): Promise<void> } | null>(null);
  const transcript = useRef<Transcript | null>(null);
  const dirty = useRef(false);

  // Token updates are merged and drawn at most once a second, and never while the app
  // is in the background: rendering layers piled up while the phone was locked.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') dirty.current = true;
    });
    const timer = setInterval(() => {
      if (!dirty.current || AppState.currentState !== 'active') return;
      dirty.current = false;
      const entries = transcript.current?.entries() ?? [];
      setHeard(tail(entries, 'source'));
      setTranslation(tail(entries, 'translation'));
    }, FLUSH_MS);
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  const active = status !== 'idle' && status !== 'stopped' && status !== 'error';

  async function start() {
    // A second tap while the first is still starting would open a second
    // recorder and lease loop that nothing could stop: the handle is set
    // before the first await, and Start is Stop from the same render on.
    if (session.current) return;
    const t = createTranscript({ source: source.trim(), target: target.trim(), sessionId: `s-${Date.now()}` });
    t.subscribe(() => { dirty.current = true; });
    transcript.current = t;
    setHeard(emptyLane());
    setTranslation(emptyLane());
    setStatus('leasing');
    setDetail('');
    session.current = startSession({
      token,
      region,
      source: source.trim(),
      target: target.trim(),
      transcript: t,
      onEvent: (e) => {
        if (e.type === 'status') {
          setStatus(e.status);
          setDetail(e.detail ?? '');
          // The session has released everything it held (microphone, notification,
          // lease); the screen releases its part. 'error' is final: Start is offered again.
          if (e.status === 'error' || e.status === 'stopped') {
            session.current = null;
            transcript.current?.end();
            dirty.current = true;
            deactivateKeepAwake(KEEP_AWAKE_TAG);
          }
        }
      },
    });
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    // Ended before the keep-awake was granted: give it back.
    if (!session.current) deactivateKeepAwake(KEEP_AWAKE_TAG);
  }

  async function stop() {
    await session.current?.stop();
  }

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <TextInput style={styles.lang} value={source} onChangeText={setSource} autoCapitalize="none" editable={!active} />
        <Text>→</Text>
        <TextInput style={styles.lang} value={target} onChangeText={setTarget} autoCapitalize="none" editable={!active} />
        {REGIONS.map((r) => (
          <Text key={r} style={[styles.region, r === region && styles.regionOn]} onPress={() => !active && setRegion(r)}>
            {r}
          </Text>
        ))}
      </View>
      <Button title={active ? t('mobile.main.stop') : t('mobile.main.start')} onPress={active ? stop : start} />
      <Text style={styles.status}>{statusLine(t, status, detail)}</Text>

      <Text style={styles.heading}>{t('mobile.main.hear')}</Text>
      <ScrollView style={styles.lane}>
        <Text>
          {heard.text}
          <Text style={styles.pending}>{heard.pending}</Text>
        </Text>
      </ScrollView>
      <Text style={styles.heading}>{t('mobile.main.read')}</Text>
      <ScrollView style={styles.lane}>
        <Text>
          {translation.text}
          <Text style={styles.pending}>{translation.pending}</Text>
        </Text>
      </ScrollView>

      <View style={styles.row}>
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
  box: { padding: 16, gap: 8, width: '100%' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  lang: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, minWidth: 48 },
  region: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, color: '#555' },
  regionOn: { backgroundColor: '#1e88e5', color: '#fff' },
  status: { fontWeight: '600' },
  heading: { fontWeight: '600', marginTop: 4 },
  lane: { maxHeight: 140, borderWidth: 1, borderColor: '#eee', borderRadius: 6, padding: 8 },
  pending: { color: '#999' },
});
