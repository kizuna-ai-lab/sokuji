import { Platform } from 'react-native';
import { AudioManager, AudioRecorder, RecordingNotificationManager } from 'react-native-audio-api';
import { addNetworkStateListener } from 'expo-network';
import i18next from 'i18next';
import { SonioxSttStream } from '@shared/providers/soniox/sttStream';
import { LegSpeech } from '@shared/providers/soniox/speech';
import { nativeSocket } from '@shared/providers/soniox/socket';
import { eventsFrom } from '@shared/lib/contract/events';
import { SAMPLE_RATE as TTS_SAMPLE_RATE } from '@shared/lib/contract/adapter';
import { SONIOX_PARTICIPANT_DEFAULT_VOICE } from '@shared/lib/soniox/ttsCatalog';
import type { SonioxRegion } from '@shared/lib/soniox/regions';
import { floatToInt16 } from './pcm';
import { leaseKey, sessionEnd, sessionStarted, type Grant } from './lease';
import { appendLog, openLogFile } from './logFile';
import { createTicker } from './ticker';
import type { Transcript } from './transcript';
import { createInterruptionHandler } from './interruptions';
import { createSpeechPlayer, type SpeechPlayer } from './speech';
import { currentRoute as nativeRoute, onRouteChange as nativeRouteChange } from './routeNative';
import type { Route } from './route';

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

function defaultPlayer(): SpeechPlayer & { close(): Promise<void> } {
  // Loaded here, not at the top: the node tests never construct a context.
  const { AudioContext } = require('react-native-audio-api') as { AudioContext: new (o: { sampleRate: number }) => { close(): Promise<void> } & Parameters<typeof createSpeechPlayer>[0]['context'] };
  const context = new AudioContext({ sampleRate: TTS_SAMPLE_RATE });
  const player = createSpeechPlayer({ context, sampleRate: TTS_SAMPLE_RATE });
  return { ...player, close: () => context.close() };
}

export function startSession(o: {
  token: string;
  region: SonioxRegion;
  source: string;
  target: string;
  /** Where every Soniox message goes (Task 4): the desktop's transcript model. */
  transcript: Pick<Transcript, 'message' | 'reconnected'> & Partial<Pick<Transcript, 'setSpeech' | 'setClock'>>;
  onEvent: (e: SessionEvent) => void;
  /** R13: the other side's translation read aloud to me; null for subtitles only. */
  listen?: { voice: string | null; speed: number } | null;
  /** R14: the microphone to record with; null for the phone's own. */
  inputDeviceId?: string | null;
  /** The output route now, and its changes — the native lookups unless a test supplies them. */
  getRoute?: () => Promise<Route>;
  onRouteChange?: (cb: (route: Route) => void) => () => void;
  /** The speech player — the real AudioContext unless a test supplies one. */
  createPlayer?: () => SpeechPlayer & { close?(): Promise<void> | void };
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
  // The last attempt's failure, kept on the status line through the next
  // attempt: a minute of 409s says "another session" until a grant arrives.
  let lastFailure: string | undefined;
  // Soniox's last error_code before a close: a 400 is a refused configuration.
  let lastErrorCode: string | null = null;
  let stopping: Promise<void> | null = null;
  // stop() aborts the lease request in flight: a stopped session never waits
  // out a 409 and never wins a lease it will not use.
  const abort = new AbortController();
  // R13: speech goes through headphones only. Whether the lease asks for the
  // spoken shape is decided at Start; headphones out later mute what the grant
  // carries, headphones in on a grant without the voice take a new grant.
  const headphones = (r: Route) => r === 'headphones' || r === 'bluetooth';
  let spokenWanted = false;
  let route: Route = 'speaker';
  let speech: LegSpeech | null = null;
  let player: (SpeechPlayer & { close?(): Promise<void> | void }) | null = null;
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
  const spokenDetail = () => (o.listen ? (speech && headphones(route) ? 'spoken' : 'subtitles_only') : undefined);
  // The ticker as the shared modules' clock: their timers must not be JS timers either.
  const tickerClock = { now: () => Date.now(), setTimeout: (fn: () => void, ms: number) => ticker.after(ms, fn) };
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
    o.transcript.setSpeech?.(null);
    speech?.close();
    speech = null;
    player?.stop();
    try {
      await player?.close?.();
    } catch (err) {
      log(`player close failed: ${reason(err)}`);
    }
    player = null;
    const g = grant;
    grant = null;
    if (g) await sessionEnd({ token: o.token, leaseId: g.leaseId, ...waits });
    clearInterval(driver);
  }

  // The running stream is ended for a fresh grant: Soniox flushes the last
  // words and closes, and the close reconnects with a new lease; forced if the
  // close never comes.
  function rotate(why: string): void {
    const s = stream;
    if (!s || !s.isOpen() || rotating) return;
    rotating = true;
    log(`rotation: ${why}`);
    s.end();
    ticker.after(5000, () => {
      if (stream === s && rotating) s.close();
    });
  }

  // R13: the headphones came out → the voice stops and the subtitles stay;
  // back in → the voice resumes at the next sentence. Headphones in on a
  // session that never asked for the voice → the next grant asks for it,
  // taken now when a stream is running.
  function applyRoute(next: Route): void {
    route = next;
    if (!o.listen || !running) return;
    if (!headphones(next)) {
      player?.stop();
      speech?.setOn(false);
    } else if (speech) {
      speech.setOn(true);
    } else if (!spokenWanted) {
      spokenWanted = true;
      rotate('headphones in: asking for the spoken shape');
      return;
    }
    if (stream?.isOpen()) status('listening', spokenDetail());
  }

  async function stopSession(): Promise<void> {
    if (closed) return;
    stopping ??= (async () => {
      await teardown();
      status('stopped');
      closed = true;
    })();
    return stopping;
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
      status(droppedAt ? 'reconnecting' : 'leasing', lastFailure);
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
      grant = await leaseKey({ token: o.token, region: o.region, signal: abort.signal, sleep: (ms) => ticker.sleep(ms, abort.signal), timer: ticker, ...(spokenWanted ? { participantSpeech: true } : {}) });
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
      lastErrorCode = null;
      s = new SonioxSttStream({ clock: tickerClock });
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
        onError: (code, message) => {
          lastErrorCode = code;
          log(`error ${code} ${message}`);
        },
        onClose: ({ code, reason: why }) => {
          const since = ((Date.now() - lastTokenAt) / 1000).toFixed(1);
          log(`close ${code ?? '-'} ${why ?? ''} — ${since}s since last token`);
          if (stream !== me || !running) return;
          stream = null;
          if (lastErrorCode === '400') {
            // A refused configuration (a bad language pair, say): no retry can fix it.
            log('configuration refused by Soniox');
            void fail('invalid_config');
            return;
          }
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
      // The grant's par_tts stream, when the spoken shape was asked for: the
      // desktop's LegSpeech feeds the Soniox TTS stream, whose audio the player plays.
      const tts = grant.streams.find((x) => x.role === 'par_tts');
      if (o.listen && tts) {
        speech?.close();
        speech = new LegSpeech({
          region: grant.region,
          key: tts.apiKey,
          clientReferenceId: tts.clientReferenceId,
          voice: o.listen.voice ?? SONIOX_PARTICIPANT_DEFAULT_VOICE,
          speed: o.listen.speed,
          events: eventsFrom((e) => {
            if (e.kind === 'audio' && headphones(route)) player?.play(e.payload.pcm);
          }),
          clock: tickerClock,
          openSocket: nativeSocket,
        });
        speech.setOn(headphones(route));
        o.transcript.setSpeech?.(speech);
        void sessionStarted({ token: o.token, leaseId: grant.leaseId, role: tts.role, signal: abort.signal, timer: ticker }).catch((err) =>
          log(`session-started (${tts.role}) failed: ${reason(err)}`),
        );
      }
      failures = 0;
      rotating = false;
      lastFailure = undefined;
      log(`${Math.max(0, Math.round((expiresAt - Date.now()) / 60000))} min left in this grant`);
      status('listening', spokenDetail());
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
      lastFailure = message === 'lease_conflict' ? 'other_session' : message;
      status('reconnecting', lastFailure);
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
    // The transcript's fin grace runs on the ticker too.
    o.transcript.setClock?.(tickerClock);
    // Phone microphone only, even with a headset connected (ruling for the first
    // version): a headset mic is far from the speaker in a lecture hall.
    // Record only, unless the translation is to be heard: then play and record,
    // with Bluetooth output over A2DP (never HFP: that would make playback mono
    // and take the microphone, R14) and no loudspeaker by default.
    AudioManager.setAudioSessionOptions(
      o.listen
        ? { iosCategory: 'playAndRecord', iosMode: 'default', iosOptions: ['allowBluetoothA2DP'] }
        : { iosCategory: 'record', iosMode: 'default', iosOptions: [] },
    );
    AudioManager.observeAudioInterruptions(true);
    const permission = await AudioManager.requestRecordingPermissions();
    if (!running) return;
    if (permission !== 'Granted') {
      await fail('microphone_denied');
      return;
    }
    if (o.inputDeviceId) {
      try {
        await AudioManager.setInputDevice(o.inputDeviceId);
      } catch (err) {
        log(`input device ${o.inputDeviceId} not set: ${reason(err)}`);
      }
    }
    if (o.listen) {
      route = await (o.getRoute ?? nativeRoute)();
      spokenWanted = headphones(route);
      player = (o.createPlayer ?? defaultPlayer)();
      subscriptions.push({ remove: (o.onRouteChange ?? nativeRouteChange)(applyRoute) });
      if (!running) return;
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
        rotate('grant ends in 15 s');
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
      // The notification's own actions. Stop ends the recording natively and
      // tells the app: the session ends with it, or the lease stays held and
      // the next foreground reconnects into a dead microphone. Pause and
      // Resume act on the recorder natively; the screen is told which.
      const onNotification = [
        RecordingNotificationManager.addEventListener('recordingNotificationStop', () => {
          log('notification: stop');
          void stopSession();
        }),
        RecordingNotificationManager.addEventListener('recordingNotificationPause', () => {
          log('notification: pause');
          status('listening', 'paused');
        }),
        RecordingNotificationManager.addEventListener('recordingNotificationResume', () => {
          log('notification: resume');
          status('listening', spokenDetail());
        }),
      ];
      for (const sub of onNotification) if (sub) subscriptions.push(sub);
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
    subscriptions.push(...[onInterruption, onRoute, onNetwork].filter((x): x is { remove(): void } => !!x));
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

  return { stop: stopSession };
}
