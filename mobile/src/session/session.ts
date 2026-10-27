import { Platform } from 'react-native';
import { AudioManager, AudioRecorder, RecordingNotificationManager } from 'react-native-audio-api';
import { addNetworkStateListener } from 'expo-network';
import i18next from 'i18next';
import { SonioxSttStream } from '@shared/providers/soniox/sttStream';
import type { SonioxRegion } from '@shared/lib/soniox/regions';
import { floatToInt16 } from './pcm';
import { leaseKey, sessionEnd, sessionStarted, type Grant } from './lease';
import { appendLog, openLogFile } from './logFile';
import { createTicker } from './ticker';
import type { Transcript } from './transcript';
import { createInterruptionHandler } from './interruptions';

export type Status = 'leasing' | 'connecting' | 'listening' | 'reconnecting' | 'stopped' | 'error';

export type SessionEvent =
  | { type: 'status'; status: Status; detail?: string }
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
  /** Where every Soniox message goes (Task 4): the desktop's transcript model. */
  transcript: Pick<Transcript, 'message' | 'reconnected'>;
  onEvent: (e: SessionEvent) => void;
  /** Every `checkpointMs` of ticker time while running (the history store's save), never on a JS timer. */
  checkpointMs?: number;
  onCheckpoint?: () => void;
}): { stop(): Promise<void> } {
  let running = true;
  // Set once the session has said its last word ('stopped' or 'error'):
  // nothing that settles later reaches the screen.
  let closed = false;
  let tearingDown = false;
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
  let cancelRetry: (() => void) | null = null;
  let cancelCheckpoint: (() => void) | null = null;
  // A close that lands while connect() is still running reconnects once it returns.
  let reconnectAfter = false;
  // The OS subscriptions a running session holds; released in teardown.
  let subscriptions: Array<{ remove(): void }> = [];
  // stop() aborts the lease request in flight: a stopped session never waits
  // out a 409 and never wins a lease it will not use.
  const abort = new AbortController();
  // Every wait hangs off this, never off setTimeout: on Android the JS timers stop
  // with the activity in the background, while the audio callback keeps coming
  // (it ticks below). A foreground interval ticks as well; whichever comes first.
  const ticker = createTicker();
  const driver = setInterval(() => ticker.tick(), 250);
  const sleep = (ms: number) => ticker.sleep(ms);
  const waits = { sleep, timer: ticker };

  const emit = (e: SessionEvent) => {
    if (!closed) o.onEvent(e);
  };
  const status = (s: Status, detail?: string) => emit({ type: 'status', status: s, detail });
  const log = (line: string) => {
    const stamped = `${new Date().toISOString()} ${line}`;
    console.log(stamped);
    appendLog(stamped);
    emit({ type: 'log', line: stamped });
  };
  const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

  // Everything the session holds, released in one place: the retry, the lease
  // request, the socket, the microphone, the Android notification, the lease.
  // It runs before 'stopped' and before a terminal 'error' alike, so an error
  // never leaves the microphone on behind a screen with no Stop button.
  async function teardown(): Promise<void> {
    if (tearingDown) return;
    tearingDown = true;
    running = false;
    reconnectAfter = false;
    cancelRetry?.();
    cancelRetry = null;
    cancelCheckpoint?.();
    cancelCheckpoint = null;
    for (const sub of subscriptions) sub.remove();
    subscriptions = [];
    abort.abort();
    stream?.end();
    const r = recorder;
    recorder = null;
    if (r) {
      r.clearOnAudioReady();
      try {
        await r.stop();
      } catch (err) {
        log(`recorder stop failed: ${reason(err)}`);
      }
    }
    if (Platform.OS === 'android') {
      try {
        await RecordingNotificationManager.hide();
      } catch (err) {
        log(`notification hide failed: ${reason(err)}`);
      }
    }
    stream?.close();
    stream = null;
    const g = grant;
    grant = null;
    if (g) await sessionEnd({ token: o.token, leaseId: g.leaseId, ...waits });
    clearInterval(driver);
  }

  async function fail(detail: string): Promise<void> {
    await teardown();
    status('error', detail);
    closed = true;
  }

  async function connect(): Promise<void> {
    if (!running || connecting) return;
    connecting = true;
    let s: SonioxSttStream | null = null;
    try {
      status(droppedAt ? 'reconnecting' : 'leasing');
      if (droppedAt && grant) {
        // Release the old lease before asking for a new one, never after: the backend
        // ends the account's session, so a late session-end would end the new lease.
        const old = grant;
        grant = null;
        const t0 = Date.now();
        const ended = await sessionEnd({ token: o.token, leaseId: old.leaseId, ...waits });
        log(`session-end ${ended ? 'ok' : 'gave up'} after ${Date.now() - t0} ms (${Date.now() - droppedAt} ms since drop)`);
        if (!running) return;
      }
      grant = await leaseKey({ token: o.token, region: o.region, signal: abort.signal, sleep: (ms) => ticker.sleep(ms, abort.signal), timer: ticker });
      expiresAt = Date.now() + grant.maxSessionDurationSeconds * 1000;
      log(`lease granted: ${(grant.maxSessionDurationSeconds / 60).toFixed(1)} min`);
      if (droppedAt) log(`new lease ${Date.now() - droppedAt} ms after the drop`);
      if (!running) {
        // Stopped while this lease was being granted: teardown saw no lease to end.
        const g = grant;
        grant = null;
        await sessionEnd({ token: o.token, leaseId: g.leaseId, ...waits });
        return;
      }
      status('connecting');
      s = new SonioxSttStream();
      stream = s;
      const me = s;
      s.setHandlers({
        onMessage: (m) => {
          if (m.tokens?.length) {
            lastTokenAt = Date.now();
            if (awaitingFirstTokens && gapFrom !== null) {
              log(`first tokens ${Date.now() - gapFrom} ms after the drop`);
              awaitingFirstTokens = false;
              gapFrom = null;
            }
            o.transcript.message(m.tokens);
          }
        },
        onError: (code, message) => log(`error ${code} ${message}`),
        onClose: ({ code, reason: why }) => {
          const since = ((Date.now() - lastTokenAt) / 1000).toFixed(1);
          log(`close ${code ?? '-'} ${why ?? ''} — ${since}s since last token`);
          if (stream !== me || !running) return;
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
        // Language identification is always on; a hint only when the user chose a language.
        ...(o.source === 'auto' ? {} : { languageHints: [o.source] }),
        translation: { type: 'one_way', target_language: o.target },
        clientReferenceId: st.clientReferenceId,
      });
      // stop() may have ended this lease while the socket was opening.
      if (!running) return;
      // A new socket after a drop numbers speakers from 1 again.
      if (droppedAt) o.transcript.reconnected();
      await sessionStarted({ token: o.token, leaseId: grant.leaseId, role: st.role, signal: abort.signal, timer: ticker });
      if (!running) return;
      if (droppedAt) {
        log(`reconnected after ${Date.now() - droppedAt} ms`);
        droppedAt = null;
      }
      failures = 0;
      rotating = false;
      status('listening', `${Math.max(0, Math.round((expiresAt - Date.now()) / 60000))} min left in this grant`);
    } catch (err) {
      const message = reason(err);
      // A socket that opened before the failure (session-started refused, say)
      // would keep taking audio and outlive its replacement: it goes with the attempt.
      if (s && stream === s) {
        stream = null;
        s.close();
      }
      if (!running) {
        log(`connect ended after stop: ${message}`);
        return;
      }
      if (TERMINAL.has(message)) {
        log(`connect failed: ${message}`);
        await fail(message);
        return;
      }
      const delay = RETRY_DELAYS_MS[failures] ?? RETRY_EVERY_MS;
      failures += 1;
      log(`connect failed (#${failures}): ${message} — retrying in ${delay / 1000} s`);
      // A minute of 409s: another device holds the account's one lease. Said on
      // screen, and the retries go on, since that session may end any moment.
      status('reconnecting', message === 'lease_conflict' ? 'other_session' : message);
      if (droppedAt === null) droppedAt = Date.now();
      // A close that landed during this attempt is answered by this retry, not
      // by a second connect() after it.
      reconnectAfter = false;
      cancelRetry = ticker.after(delay, () => {
        cancelRetry = null;
        void connect();
      });
    } finally {
      connecting = false;
      if (reconnectAfter && running && !cancelRetry) {
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
    if (!running) return;
    if (permission !== 'Granted') {
      await fail('microphone_denied');
      return;
    }
    const r = new AudioRecorder();
    const ready = r.onAudioReady({ sampleRate: 16000, bufferLength: 1600, channelCount: 1 }, ({ buffer }) => {
      // The one thing that keeps running with the screen off on Android: it
      // advances every wait the session has pending.
      ticker.tick();
      if (!running) return;
      if (!sampleRate) {
        // The config's sampleRate is what the recorder actually delivers, never assumed.
        sampleRate = buffer.sampleRate;
        log(`first buffer: ${buffer.sampleRate} Hz, ${buffer.length} samples`);
        void connect();
        return;
      }
      // Checked here, not on a timer: iOS slows timers in the background, audio keeps coming.
      if (!rotating && stream?.isOpen() && Date.now() >= expiresAt - ROTATE_BEFORE_MS) {
        rotating = true;
        log('rotation: grant ends in 15 s');
        const s = stream;
        s.end();
        // end() lets Soniox flush the last words and close; force it if that never comes.
        ticker.after(5000, () => {
          if (stream === s && rotating) s.close();
        });
        return;
      }
      if (stream?.isOpen()) stream.sendAudio(floatToInt16(buffer.getChannelData(0)));
    });
    if (ready.status === 'error') {
      await fail(ready.message);
      return;
    }
    if (Platform.OS === 'android') {
      await AudioManager.requestNotificationPermissions();
      // The foreground service carries the microphone type only while this is up;
      // Android 14 stops background capture without it.
      await RecordingNotificationManager.show({ title: 'Sokuji', contentText: i18next.t('mobile.main.status.listening', { defaultValue: 'Listening' }), showStopAction: true });
      if (!running) {
        // Stopped while the notification was going up: teardown hid nothing.
        await RecordingNotificationManager.hide();
        return;
      }
    }
    const started = await r.start();
    if (started.status === 'error') {
      await fail(started.message);
      return;
    }
    if (!running) {
      // Stopped while the recorder was starting: teardown saw no recorder.
      r.clearOnAudioReady();
      await r.stop();
      return;
    }
    recorder = r;
    // A phone call or Siri: capture pauses and, when the OS allows, resumes;
    // the socket and the lease are kept.
    const interruptions = createInterruptionHandler({
      pauseCapture: () => recorder?.pause(),
      resumeCapture: () => recorder?.resume(),
      log,
    });
    const onInterruption = AudioManager.addSystemEventListener('interruption', (e) => {
      log(`interruption ${e.type}${e.type === 'ended' ? ` (resume: ${e.shouldResume})` : ''}`);
      interruptions.onInterruption({ type: e.type, shouldResume: !!e.shouldResume });
    });
    const onRoute = AudioManager.addSystemEventListener('routeChange', (e) => interruptions.onRouteChange({ reason: String(e.reason) }));
    // The network is back: retry now rather than wait out the backoff.
    const onNetwork = addNetworkStateListener(({ isConnected }) => {
      if (!isConnected || !running || !cancelRetry) return;
      cancelRetry();
      cancelRetry = null;
      log('network back: retrying now');
      void connect();
    });
    subscriptions = [onInterruption, onRoute, onNetwork].filter((x): x is { remove(): void } => !!x);
    if (o.onCheckpoint && o.checkpointMs) {
      const every = o.checkpointMs;
      const checkpoint = () => {
        cancelCheckpoint = null;
        if (!running) return;
        o.onCheckpoint?.();
        cancelCheckpoint = ticker.after(every, checkpoint);
      };
      cancelCheckpoint = ticker.after(every, checkpoint);
    }
    status('leasing');
  }

  begin().catch((err) => {
    log(`start failed: ${reason(err)}`);
    void fail(reason(err));
  });

  return {
    async stop() {
      if (closed) return;
      await teardown();
      status('stopped');
      closed = true;
    },
  };
}
