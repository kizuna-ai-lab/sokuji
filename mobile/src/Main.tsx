import { useRef, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Clipboard from 'expo-clipboard';
import type { SonioxToken } from '@shared/providers/soniox/sttStream';
import type { SonioxRegion } from '@shared/lib/soniox/regions';
import { startSession, type Status } from './session';

const REGIONS: SonioxRegion[] = ['us', 'eu', 'jp'];
const KEEP_AWAKE_TAG = 'sokuji-session';

interface Lane {
  final: string;
  pending: string;
}

const emptyLane = (): Lane => ({ final: '', pending: '' });

// Final tokens are appended; non-final ones replace the grey tail on every message.
function fold(lane: Lane, tokens: SonioxToken[]): Lane {
  let final = lane.final;
  let pending = '';
  for (const t of tokens) {
    const text = t.text === '<end>' || t.text === '<fin>' ? '\n' : t.text;
    if (t.is_final) final += text;
    else pending += text;
  }
  return { final, pending };
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

  const active = status !== 'idle' && status !== 'stopped' && status !== 'error';

  async function start() {
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
          setLog((l) => [...l, e.line]);
        } else {
          const original = e.tokens.filter((t) => t.translation_status !== 'translation');
          const translated = e.tokens.filter((t) => t.translation_status === 'translation');
          if (original.length) setHeard((l) => fold(l, original));
          if (translated.length) setTranslation((l) => fold(l, translated));
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
      <Button title={active ? 'Stop' : 'Start'} onPress={active ? stop : start} />
      <Text style={styles.status}>
        {status}
        {detail === 'sign_in_required' ? ' — Sign in again' : detail ? ` — ${detail}` : ''}
      </Text>

      <Text style={styles.heading}>Heard</Text>
      <ScrollView style={styles.lane}>
        <Text>
          {heard.final}
          <Text style={styles.pending}>{heard.pending}</Text>
        </Text>
      </ScrollView>
      <Text style={styles.heading}>Translation</Text>
      <ScrollView style={styles.lane}>
        <Text>
          {translation.final}
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
});
