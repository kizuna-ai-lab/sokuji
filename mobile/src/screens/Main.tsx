import { useRef, useState } from 'react';
import { AppState, Button, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useTranslation } from 'react-i18next';
import type { Entry } from '@shared/lib/projection/types';
import { startSession, type Status } from '../session/session';
import { createTranscript, type Transcript } from '../session/transcript';
import { createEntriesFeed } from '../session/entriesFeed';
import { useSettings } from '../store/useSettings';
import Subtitles from './Subtitles';
import Account from './Account';
import Settings from './Settings';
import History from './History';
import { createHistoryStore, type StoredSession } from '../history/store';
import { documentFs } from '../history/fs';

const KEEP_AWAKE_TAG = 'sokuji-session';

type Screen = 'main' | 'account' | 'settings' | 'history';

// The history store writes the running session every minute (ticker time) and at its end.
const CHECKPOINT_MS = 60000;
const history = createHistoryStore(documentFs);

export default function Main({ token, email, onSignOut, onAccountDeleted }: { token: string; email: string; onSignOut: () => void; onAccountDeleted: () => void }) {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  const setSettings = useSettings((s) => s.set);
  const [status, setStatus] = useState<Status | 'idle'>('idle');
  const [detail, setDetail] = useState('');
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [screen, setScreen] = useState<Screen>('main');
  const [menu, setMenu] = useState(false);
  const session = useRef<{ stop(): Promise<void> } | null>(null);
  const feed = useRef<{ stop(): void } | null>(null);
  const transcript = useRef<Transcript | null>(null);
  const stored = useRef<StoredSession | null>(null);

  const active = status !== 'idle' && status !== 'stopped' && status !== 'error';

  // The session has released everything it held (microphone, notification,
  // lease); the screen releases its part and draws the transcript's last state.
  function snapshot(lastStatus: string, endedAt: number | null): StoredSession | null {
    const base = stored.current;
    const tr = transcript.current;
    if (!base || !tr) return null;
    return { ...base, leg: tr.leg(), lastStatus, endedAt };
  }

  function ended() {
    const last = snapshot(status === 'error' ? detail || 'error' : 'stopped', Date.now());
    if (last && last.leg.segments.length > 0) void history.save(last);
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
    const startedAt = Date.now();
    stored.current = { id: `s-${startedAt}`, startedAt, endedAt: null, source, target, leg: tr.leg(), lastStatus: 'leasing' };
    setEntries([]);
    setStatus('leasing');
    setDetail('');
    session.current = startSession({
      token,
      region,
      source,
      target,
      transcript: tr,
      checkpointMs: CHECKPOINT_MS,
      onCheckpoint: () => {
        const snap = snapshot('listening', null);
        if (snap && snap.leg.segments.length > 0) void history.save(snap);
      },
      onEvent: (e) => {
        if (e.type !== 'status') return;
        setStatus(e.status);
        setDetail(e.detail ?? '');
        if (e.status === 'error' || e.status === 'stopped') ended();
        // The balance ran out: the account screen says so and how to top up.
        if (e.status === 'error' && e.detail === 'balance_exhausted') setScreen('account');
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

  if (screen === 'account') {
    return <Account token={token} email={email} onBack={() => setScreen('main')} onSignOut={onSignOut} onDeleted={onAccountDeleted} />;
  }
  if (screen === 'settings') return <Settings onBack={() => setScreen('main')} locked={active} />;
  if (screen === 'history') return <History store={history} onBack={() => setScreen('main')} />;

  const open = (next: Screen) => {
    setMenu(false);
    setScreen(next);
  };

  return (
    <View style={styles.box}>
      <View style={styles.statusLine}>
        <Text style={styles.status}>{statusLine(t, status, detail) || 'Sokuji'}</Text>
      </View>
      <Subtitles entries={entries} bilingual={settings.bilingual} textSize={settings.textSize} />
      <View style={styles.toolbar}>
        <Text style={styles.menuButton} onPress={() => setMenu(true)}>≡</Text>
        <Text style={styles.pair} onPress={() => !active && setScreen('settings')}>
          {settings.source} → {settings.target}
        </Text>
        <Button title={active ? t('mobile.main.stop') : t('mobile.main.start')} onPress={active ? stop : start} />
      </View>
      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenu(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetAccount}>{email}</Text>
            <Text style={styles.sheetRow} onPress={() => open('history')}>{t('mobile.menu.history')}  ›</Text>
            <Text style={styles.sheetRow} onPress={() => open('account')}>{t('mobile.menu.account')}  ›</Text>
            <Text style={styles.sheetRow} onPress={() => open('settings')}>{t('mobile.menu.settings')}  ›</Text>
          </View>
        </Pressable>
      </Modal>
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
  if (status === 'reconnecting') return detail === 'other_session' ? t('mobile.main.status.otherSession') : t('mobile.main.status.reconnecting');
  if (status === 'stopped') return t('mobile.main.status.stopped');
  return t('mobile.main.status.starting');
}

const styles = StyleSheet.create({
  box: { flex: 1, width: '100%' },
  statusLine: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  status: { fontSize: 13, color: '#666' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 56, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ddd' },
  menuButton: { fontSize: 24, paddingHorizontal: 8 },
  pair: { fontWeight: '600', fontSize: 15 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 4 },
  sheetAccount: { fontSize: 12, color: '#666', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  sheetRow: { fontSize: 17, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
});
