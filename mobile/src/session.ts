import { Platform } from 'react-native';
import { AudioManager, AudioRecorder, RecordingNotificationManager } from 'react-native-audio-api';
import { SonioxSttStream, type SonioxToken } from '@shared/providers/soniox/sttStream';
import type { SonioxRegion } from '@shared/lib/soniox/regions';
import { floatToInt16 } from './pcm';
import { leaseKey, sessionEnd, sessionStarted, type Grant } from './lease';

export type Status = 'leasing' | 'connecting' | 'listening' | 'reconnecting' | 'stopped' | 'error';

export type SessionEvent =
  | { type: 'status'; status: Status; detail?: string }
  | { type: 'tokens'; tokens: SonioxToken[] }
  | { type: 'log'; line: string };

// The model name is a literal here: src/providers/soniox/config.ts is not DOM-free.
const MODEL = 'stt-rt-v5';

export function startSession(o: {
  token: string;
  region: SonioxRegion;
  source: string;
  target: string;
  onEvent: (e: SessionEvent) => void;
}): { stop(): Promise<void> } {
  let running = true;
  let connecting = false;
  let stream: SonioxSttStream | null = null;
  let grant: Grant | null = null;
  let recorder: AudioRecorder | null = null;
  let sampleRate = 0;
  let lastTokenAt = Date.now();
  let droppedAt: number | null = null;
  // Gate A.2: drop → session-end → new lease → first tokens, each logged with its delay.
  let awaitingFirstTokens = false;
  let gapFrom: number | null = null;

  const status = (s: Status, detail?: string) => o.onEvent({ type: 'status', status: s, detail });
  const log = (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(stamped);
    o.onEvent({ type: 'log', line: stamped });
  };

  async function connect(): Promise<void> {
    if (!running || connecting) return;
    connecting = true;
    try {
      status(droppedAt ? 'reconnecting' : 'leasing');
      if (droppedAt && grant) {
        // Release the old lease before asking for a new one, never after: the backend
        // ends the account's session, so a late session-end would end the new lease.
        const old = grant;
        grant = null;
        const t0 = Date.now();
        const ended = await sessionEnd({ token: o.token, leaseId: old.leaseId });
        log(`session-end ${ended ? 'ok' : 'gave up'} after ${Date.now() - t0} ms (${Date.now() - droppedAt} ms since drop)`);
        if (!running) return;
      }
      grant = await leaseKey({ token: o.token, region: o.region });
      if (droppedAt) log(`new lease ${Date.now() - droppedAt} ms after the drop`);
      if (!running) {
        // Stopped while this lease was being granted: stop() saw no lease to end.
        await sessionEnd({ token: o.token, leaseId: grant.leaseId });
        return;
      }
      status('connecting');
      const s = new SonioxSttStream();
      stream = s;
      s.setHandlers({
        onMessage: (m) => {
          if (m.tokens?.length) {
            lastTokenAt = Date.now();
            if (awaitingFirstTokens && gapFrom !== null) {
              log(`first tokens ${Date.now() - gapFrom} ms after the drop`);
              awaitingFirstTokens = false;
              gapFrom = null;
            }
            o.onEvent({ type: 'tokens', tokens: m.tokens });
          }
        },
        onError: (code, message) => log(`error ${code} ${message}`),
        onClose: ({ code, reason }) => {
          const since = ((Date.now() - lastTokenAt) / 1000).toFixed(1);
          log(`close ${code ?? '-'} ${reason ?? ''} — ${since}s since last token`);
          if (stream !== s || !running) return;
          stream = null;
          droppedAt = Date.now();
          gapFrom = droppedAt;
          awaitingFirstTokens = true;
          status('reconnecting');
          void connect();
        },
      });
      const st = grant.streams[0];
      await s.connect({
        apiKey: st.apiKey,
        region: grant.region,
        model: MODEL,
        sampleRate,
        languageHints: [o.source],
        translation: { type: 'one_way', target_language: o.target },
        clientReferenceId: st.clientReferenceId,
      });
      // stop() may have ended this lease while the socket was opening.
      if (!running) return;
      await sessionStarted({ token: o.token, leaseId: grant.leaseId, role: st.role });
      if (droppedAt) {
        log(`reconnected after ${Date.now() - droppedAt} ms`);
        droppedAt = null;
      }
      status('listening');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`connect failed: ${message}`);
      status('error', message);
    } finally {
      connecting = false;
    }
  }

  async function begin(): Promise<void> {
    AudioManager.setAudioSessionOptions({ iosCategory: 'record', iosMode: 'default', iosOptions: ['allowBluetoothHFP'] });
    AudioManager.observeAudioInterruptions(true);
    const permission = await AudioManager.requestRecordingPermissions();
    if (permission !== 'Granted') {
      running = false;
      status('error', 'microphone_denied');
      return;
    }
    const r = new AudioRecorder();
    const ready = r.onAudioReady({ sampleRate: 16000, bufferLength: 1600, channelCount: 1 }, ({ buffer }) => {
      if (!sampleRate) {
        // The config's sampleRate is what the recorder actually delivers, never assumed.
        sampleRate = buffer.sampleRate;
        log(`first buffer: ${buffer.sampleRate} Hz, ${buffer.length} samples`);
        void connect();
        return;
      }
      if (stream?.isOpen()) stream.sendAudio(floatToInt16(buffer.getChannelData(0)));
    });
    if (ready.status === 'error') {
      running = false;
      status('error', ready.message);
      return;
    }
    if (Platform.OS === 'android') {
      await AudioManager.requestNotificationPermissions();
      // The foreground service carries the microphone type only while this is up;
      // Android 14 stops background capture without it.
      await RecordingNotificationManager.show({ title: 'Sokuji', contentText: 'Listening', showStopAction: true });
    }
    const started = await r.start();
    if (started.status === 'error') {
      running = false;
      status('error', started.message);
      return;
    }
    recorder = r;
    status('leasing');
  }

  void begin();

  return {
    async stop() {
      running = false;
      stream?.end();
      if (recorder) {
        recorder.clearOnAudioReady();
        await recorder.stop();
        recorder = null;
      }
      if (Platform.OS === 'android') await RecordingNotificationManager.hide();
      stream?.close();
      stream = null;
      if (grant) await sessionEnd({ token: o.token, leaseId: grant.leaseId });
      status('stopped');
    },
  };
}
