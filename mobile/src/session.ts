import { Platform } from 'react-native';
import { AudioManager, AudioRecorder, RecordingNotificationManager } from 'react-native-audio-api';
import { SonioxSttStream, type SonioxToken } from '@shared/providers/soniox/sttStream';
import type { SonioxRegion } from '@shared/lib/soniox/regions';
import { floatToInt16 } from './pcm';
import { leaseKey, sessionEnd, sessionStarted, type Grant } from './lease';
import { appendLog, openLogFile } from './logFile';

export type Status = 'leasing' | 'connecting' | 'listening' | 'reconnecting' | 'stopped' | 'error';

export type SessionEvent =
  | { type: 'status'; status: Status; detail?: string }
  | { type: 'tokens'; tokens: SonioxToken[] }
  | { type: 'log'; line: string };

// The model name is a literal here: src/providers/soniox/config.ts is not DOM-free.
const MODEL = 'stt-rt-v5';

// While running, every failure but these is retried: 2 s, 5 s, 10 s, then every 15 s.
const TERMINAL = new Set(['sign_in_required', 'microphone_denied', 'balance_exhausted']);
// Rotate to a fresh grant this long before the current one runs out.
const ROTATE_BEFORE_MS = 15000;
const RETRY_DELAYS_MS = [2000, 5000, 10000];
const RETRY_EVERY_MS = 15000;

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
  let failures = 0;
  // The grant's duration is what the balance buys (capped at 5 h); Soniox ends the
  // stream with a 403 when it runs out, so the session rotates to a new grant first.
  let expiresAt = Infinity;
  let rotating = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  // A close that lands while connect() is still running reconnects once it returns.
  let reconnectAfter = false;

  const status = (s: Status, detail?: string) => o.onEvent({ type: 'status', status: s, detail });
  const log = (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(stamped);
    appendLog(stamped);
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
      expiresAt = Date.now() + grant.maxSessionDurationSeconds * 1000;
      log(`lease granted: ${(grant.maxSessionDurationSeconds / 60).toFixed(1)} min`);
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
          if (connecting) reconnectAfter = true;
          else void connect();
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
      failures = 0;
      rotating = false;
      status('listening', `${Math.max(0, Math.round((expiresAt - Date.now()) / 60000))} min left in this grant`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (TERMINAL.has(message) || !running) {
        log(`connect failed: ${message}`);
        status('error', message);
        return;
      }
      const delay = RETRY_DELAYS_MS[failures] ?? RETRY_EVERY_MS;
      failures += 1;
      log(`connect failed (#${failures}): ${message} — retrying in ${delay / 1000} s`);
      status('reconnecting', message);
      if (droppedAt === null) droppedAt = Date.now();
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    } finally {
      connecting = false;
      if (reconnectAfter && running && !retryTimer) {
        reconnectAfter = false;
        void connect();
      }
    }
  }

  async function begin(): Promise<void> {
    const where = openLogFile();
    log(`log file ${where}`);
    // Phone microphone only, even with a headset connected (ruling for the first
    // version): a headset mic is far from the speaker in a lecture hall.
    AudioManager.setAudioSessionOptions({ iosCategory: 'record', iosMode: 'default', iosOptions: [] });
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
      // Checked here, not on a timer: iOS slows timers in the background, audio keeps coming.
      if (running && !rotating && stream?.isOpen() && Date.now() >= expiresAt - ROTATE_BEFORE_MS) {
        rotating = true;
        log('rotation: grant ends in 15 s');
        const s = stream;
        s.end();
        // end() lets Soniox flush the last words and close; force it if that never comes.
        setTimeout(() => {
          if (stream === s && rotating) s.close();
        }, 5000);
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
      if (retryTimer) clearTimeout(retryTimer);
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
