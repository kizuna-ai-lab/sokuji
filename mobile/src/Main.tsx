import { useEffect, useRef, useState } from 'react';
import { AppState, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Clipboard from 'expo-clipboard';
import type { SonioxToken } from '@shared/providers/soniox/sttStream';
import type { SonioxRegion } from '@shared/lib/soniox/regions';
import { startSession, type Status } from './session';

const REGIONS: SonioxRegion[] = ['us', 'eu', 'jp'];
const KEEP_AWAKE_TAG = 'sokuji-session';
// Shown on screen so a tester can tell which code the phone is running.
const BUILD_LABEL = 'proto r5: no UI updates in background';
// Only the tail is rendered: re-rendering an hour of text on every token starved the JS thread.
const SHOWN_LINES = 20;
const SHOWN_LOG_LINES = 200;
const FLUSH_MS = 1000;

// The whole transcript, kept outside React state: lines closed by <end>/<fin>, the open
// line's final text, and the non-final tail that the next message replaces.
interface Transcript {
  lines: string[];
  open: string;
  pending: string;
}

interface Lane {
  text: string;
  pending: string;
}

const emptyTranscript = (): Transcript => ({ lines: [], open: '', pending: '' });
const emptyLane = (): Lane => ({ text: '', pending: '' });

function fold(t: Transcript, tokens: SonioxToken[]): void {
  let pending = '';
  for (const tok of tokens) {
    if (!tok.is_final) {
      pending += tok.text;
    } else if (tok.text === '<end>' || tok.text === '<fin>') {
      t.lines.push(t.open);
      t.open = '';
    } else {
      t.open += tok.text;
    }
  }
  t.pending = pending;
}

function tail(t: Transcript): Lane {
  const lines = t.lines.slice(-(SHOWN_LINES - 1));
  return { text: [...lines, t.open].join('\n'), pending: t.pending };
}

export default function Main({ token, onSignOut }: { token: string; onSignOut: () => void }) {
  const [source, setSource] = useState('en');
  const [target, setTarget] = useState('zh');
  const [region, setRegion] = useState<SonioxRegion>('us');
  const [status, setStatus] = useState<Status | 'idle'>('idle');
  const [detail, setDetail] = useState('');
  const [heard, setHeard] = useState<Lane>(emptyLane);
  const [translation, setTranslation] = useState<Lane>(emptyLane);
  const [log, setLog] = useState<string[]>([]);
  const session = useRef<{ stop(): Promise<void> } | null>(null);
  const heardAll = useRef(emptyTranscript());
  const translationAll = useRef(emptyTranscript());
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
      setHeard(tail(heardAll.current));
      setTranslation(tail(translationAll.current));
    }, FLUSH_MS);
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  // Unattended test builds only: start a session as soon as the screen opens.
  useEffect(() => {
    if (process.env.EXPO_PUBLIC_AUTOSTART === '1') void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = status !== 'idle' && status !== 'stopped' && status !== 'error';

  async function start() {
    heardAll.current = emptyTranscript();
    translationAll.current = emptyTranscript();
    setHeard(emptyLane());
    setTranslation(emptyLane());
    setDetail('');
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    session.current = startSession({
      token,
      region,
      source: source.trim(),
      target: target.trim(),
      onEvent: (e) => {
        if (e.type === 'status') {
          setStatus(e.status);
          setDetail(e.detail ?? '');
        } else if (e.type === 'log') {
          setLog((l) => [...l.slice(-(SHOWN_LOG_LINES - 1)), e.line]);
        } else {
          const original = e.tokens.filter((t) => t.translation_status !== 'translation');
          const translated = e.tokens.filter((t) => t.translation_status === 'translation');
          if (original.length) fold(heardAll.current, original);
          if (translated.length) fold(translationAll.current, translated);
          dirty.current = true;
        }
      },
    });
  }

  async function stop() {
    await session.current?.stop();
    session.current = null;
    deactivateKeepAwake(KEEP_AWAKE_TAG);
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
      <Text style={styles.build}>{BUILD_LABEL}</Text>
      <Button title={active ? 'Stop' : 'Start'} onPress={active ? stop : start} />
      <Text style={styles.status}>
        {status}
        {detail === 'sign_in_required' ? ' — Sign in again' : detail ? ` — ${detail}` : ''}
      </Text>

      <Text style={styles.heading}>Heard</Text>
      <ScrollView style={styles.lane}>
        <Text>
          {heard.text}
          <Text style={styles.pending}>{heard.pending}</Text>
        </Text>
      </ScrollView>
      <Text style={styles.heading}>Translation</Text>
      <ScrollView style={styles.lane}>
        <Text>
          {translation.text}
          <Text style={styles.pending}>{translation.pending}</Text>
        </Text>
      </ScrollView>

      <View style={styles.row}>
        <Text style={styles.heading}>Gate A log</Text>
        <Button title="Copy log" onPress={() => Clipboard.setStringAsync(log.join('\n'))} />
        <Button title="Sign out" disabled={active} onPress={onSignOut} />
      </View>
      <ScrollView style={styles.log}>
        {log.map((l, i) => (
          <Text key={i} style={styles.logLine}>{l}</Text>
        ))}
      </ScrollView>
    </View>
  );
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
  log: { maxHeight: 160 },
  logLine: { fontSize: 11, color: '#555' },
  build: { fontSize: 11, color: '#999' },
});
