// Task 4 step 2: the microphone alone, no socket. Answers what the hardware
// actually delivers for a 16 kHz / 100 ms request before the session uses it.
import { useRef, useState } from 'react';
import { Button, Platform, StyleSheet, Text, View } from 'react-native';
import { AudioManager, AudioRecorder, RecordingNotificationManager } from 'react-native-audio-api';
import { floatToInt16 } from './pcm';

export default function MicProbe() {
  const recorder = useRef<AudioRecorder | null>(null);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const stats = useRef({ frames: 0, samples: 0, first: '', startedAt: 0 });
  const [tick, setTick] = useState(0);

  const log = (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(stamped);
    setLines((l) => [...l.slice(-20), stamped]);
  };

  async function start() {
    AudioManager.setAudioSessionOptions({ iosCategory: 'record', iosMode: 'default', iosOptions: ['allowBluetoothHFP'] });
    AudioManager.observeAudioInterruptions(true);
    const permission = await AudioManager.requestRecordingPermissions();
    if (permission !== 'Granted') {
      log(`microphone ${permission}`);
      return;
    }
    if (Platform.OS === 'android') {
      await AudioManager.requestNotificationPermissions();
      await RecordingNotificationManager.show({ title: 'Sokuji', contentText: 'Listening', showStopAction: true });
    }
    stats.current = { frames: 0, samples: 0, first: '', startedAt: Date.now() };
    const r = new AudioRecorder();
    const ready = r.onAudioReady({ sampleRate: 16000, bufferLength: 1600, channelCount: 1 }, ({ buffer }) => {
      const s = stats.current;
      const pcm = floatToInt16(buffer.getChannelData(0));
      if (s.frames === 0) {
        s.first = `first buffer: sampleRate=${buffer.sampleRate} length=${buffer.length} channels=${buffer.numberOfChannels} int16=${pcm.length}`;
      }
      s.frames += 1;
      s.samples += buffer.length;
      if (s.frames % 10 === 0) setTick((t) => t + 1);
    });
    if (ready.status === 'error') {
      log(`onAudioReady error: ${ready.message}`);
      return;
    }
    const started = await r.start();
    if (started.status === 'error') {
      log(`start error: ${started.message}`);
      return;
    }
    recorder.current = r;
    setRunning(true);
    log('recording');
  }

  async function stop() {
    const r = recorder.current;
    recorder.current = null;
    setRunning(false);
    if (r) {
      r.clearOnAudioReady();
      await r.stop();
    }
    if (Platform.OS === 'android') await RecordingNotificationManager.hide();
    const s = stats.current;
    const secs = (Date.now() - s.startedAt) / 1000;
    log(`stopped: ${s.frames} frames, ${s.samples} samples in ${secs.toFixed(1)} s = ${(s.samples / secs).toFixed(0)} samples/s`);
  }

  const s = stats.current;
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Mic probe</Text>
      <Button title={running ? 'Stop' : 'Start'} onPress={running ? stop : start} />
      <Text>{s.first || 'no buffer yet'}</Text>
      <Text key={tick}>frames {s.frames}, samples {s.samples}</Text>
      {lines.map((l, i) => (
        <Text key={i} style={styles.log}>{l}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 16, gap: 8, width: '100%' },
  title: { fontSize: 18, fontWeight: '600' },
  log: { fontSize: 11, color: '#555' },
});
