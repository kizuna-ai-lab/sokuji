import { Platform } from 'react-native';
import { AudioManager, RecordingNotificationManager } from 'react-native-audio-api';
import { addNetworkStateListener } from 'expo-network';
import i18next from 'i18next';
import { SonioxSttStream, SONIOX_STT_MODEL } from '@shared/providers/soniox/sttStream';
import { LegSpeech } from '@shared/providers/soniox/speech';
import { nativeSocket } from '@shared/providers/soniox/socket';
import { eventsFrom } from '@shared/lib/contract/events';
import { SAMPLE_RATE as TTS_SAMPLE_RATE } from '@shared/lib/contract/adapter';
import { SONIOX_PARTICIPANT_DEFAULT_VOICE } from '@shared/lib/soniox/ttsCatalog';
import type { SonioxRegion } from '@shared/lib/soniox/regions';
import { leaseKey, sessionEnd, sessionStarted, type Grant } from './lease';
import { appendLog, openLogFile } from './logFile';
import { createTicker } from './ticker';
import type { Transcript } from './transcript';
import { createInterruptionHandler } from './interruptions';
import { createSpeechPlayer, type SpeechPlayer } from './speech';
import { currentRoute as nativeRoute, onRouteChange as nativeRouteChange } from './routeNative';
import type { Route } from './route';
import { echoCancellationFor, headphones, speakable, type CaptureChain, type EchoSettings } from './capture';
import type { Capture } from './captureAdapter';
import { createCapture } from './captureNative';
import { createNativeSpeechPlayer } from './speechNative';
import type { CaptureInfo } from '../../modules/audio-capture/src/AudioCaptureModule';

export type Status = 'leasing' | 'connecting' | 'listening' | 'reconnecting' | 'stopped' | 'error';

export type SessionEvent =
  /** With 'listening', for the analytics: `voice`, whether the current grant carries the spoken translation (the shape the backend granted); `route`, where speech goes (with `listen` on); `chain`, the canceller running. */
  | { type: 'status'; status: Status; detail?: string; voice?: boolean; route?: Route; chain?: CaptureChain }
  | { type: 'log'; line: string };

// While running, every failure but these is retried: 2 s, 5 s, 10 s, then every 15 s.
const TERMINAL = new Set(['sign_in_required', 'microphone_denied', 'balance_exhausted']);
// Rotate to a fresh grant this long before the current one runs out.
const ROTATE_BEFORE_MS = 15000;
const RETRY_DELAYS_MS = [2000, 5000, 10000];
const RETRY_EVERY_MS = 15000;

function defaultPlayer(log: (line: string) => void, onFailed: () => void): SpeechPlayer & { close(): Promise<void> } {
  // Android: the module plays, since its canceller needs every sample (spec §5).
  if (Platform.OS === 'android') return createNativeSpeechPlayer(TTS_SAMPLE_RATE, (message) => {
    log(`speech track failed: ${message}`);
    onFailed();
  });
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
  /** D7, D8: echo cancellation, for the phone's speaker and for every other output. */
  echo: EchoSettings;
  /** The capture — the native module unless a test supplies one. */
  createCapture?: (o: Parameters<typeof createCapture>[0]) => Capture;
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
  // The capture running or paused, the mode it was asked for (null: reopen it
  // whatever the route says) and what it reports. No info: a mode change is on
  // its way, so no frame is sent and no chain counts.
  let capture: Capture | null = null;
  let captureMode: boolean | null = null;
  let captureInfo: CaptureInfo | null = null;
  // The OS has the microphone (a phone call): nothing starts until it gives it back.
  let capturePaused = false;
  // The speech track would not open: nothing will be heard, whatever the route allows.
  let trackFailed = false;
  // The capture itself is stopped for that. Apart from `capturePaused`: the OS can
  // give the microphone back while a restart is still ending in a pause.
  let captureHalted = false;
  // The notification's Pause: only its Resume ends this, not a call ending.
  let heldByUser = false;
  // The first start is begin()'s: a route change before it only moves `route`.
  let captureBegun = false;
  let syncingCapture = false;
  // A frame came since the last start: a capture error then is worth one restart.
  let heardSinceStart = false;
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
  // R13: the lease asks for the spoken shape whenever the translation is to be
  // heard; what it may do on the current route is decided by spoken() below.
  const spokenWanted = !!o.listen;
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
  const status = (s: Status, detail?: string, voice?: boolean) => emit({
    type: 'status',
    status: s,
    detail,
    ...(voice === undefined ? {} : { voice, ...(o.listen ? { route } : {}), ...(captureInfo ? { chain: captureInfo.chain } : {}) }),
  });
  const echoWanted = () => echoCancellationFor({ ...o.echo, listen: !!o.listen, route });
  const chain = () => captureInfo?.chain ?? null;
  const spoken = () => speakable({ ...o.echo, listen: !!o.listen, route, chain: chain() });
  const spokenDetail = () => (o.listen && speech ? (spoken() && !trackFailed ? 'spoken' : 'subtitles_only') : undefined);
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
    const c = capture;
    capture = null;
    if (c) {
      try {
        await c.stop();
      } catch (err) {
        log(`capture stop failed: ${reason(err)}`);
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

  // Every frame the capture delivers.
  function onAudio(pcm: Int16Array): void {
    // The one thing that keeps running with the screen off on Android: it
    // advances every wait the session has pending.
    ticker.tick();
    heardSinceStart = true;
    if (!running || !captureInfo) return;
    if (!sampleRate) {
      // What the module reports it delivers, never assumed.
      sampleRate = captureInfo.sampleRate;
      log(`first frame: ${sampleRate} Hz, ${pcm.length} samples, chain ${captureInfo.chain}`);
      void connect();
      return;
    }
    // Checked here, not on a timer: iOS slows timers in the background, audio keeps coming.
    if (!rotating && stream?.isOpen() && Date.now() >= expiresAt - ROTATE_BEFORE_MS) {
      rotate('grant ends in 15 s');
      return;
    }
    if (stream?.isOpen()) stream.sendAudio(pcm);
  }

  function onCaptureStopped(why: string, message?: string): void {
    log(`capture stopped: ${why}${message ? ` (${message})` : ''}`);
    if (!running) return;
    if (why === 'interrupted') {
      capturePaused = true;
      captureHalted = true;
      return;
    }
    // A capture that dies again before a single frame will not come back.
    if (!heardSinceStart) {
      void fail('microphone_denied');
      return;
    }
    captureMode = null;
    void syncCapture();
  }

  // Bluetooth output over A2DP, never HFP: that would make playback mono and take
  // the microphone (R14). voiceChat and the loudspeaker only with the switch on
  // (spec §4.1); the library must ask for what the module set, or its next
  // activation undoes it.
  function setSessionOptions(echoCancellation: boolean): void {
    AudioManager.setAudioSessionOptions(
      !o.listen
        ? { iosCategory: 'record', iosMode: 'default', iosOptions: [] }
        : echoCancellation
          ? { iosCategory: 'playAndRecord', iosMode: 'voiceChat', iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'] }
          : { iosCategory: 'playAndRecord', iosMode: 'default', iosOptions: ['defaultToSpeaker', 'allowBluetoothA2DP'] },
    );
  }

  async function startCapture(echoCancellation: boolean): Promise<Capture> {
    log(`capture wanted: echo cancellation ${echoCancellation ? 'on' : 'off'}, route ${route}, listen ${!!o.listen}`);
    setSessionOptions(echoCancellation);
    const c = (o.createCapture ?? createCapture)({
      options: { echoCancellation, sampleRate: 16000, inputDeviceId: o.inputDeviceId ?? null },
      onAudio,
      onStopped: onCaptureStopped,
    });
    heardSinceStart = false;
    captureInfo = await c.start();
    return c;
  }

  // Stop, start in the asked mode, keep what it reports. A processed start the
  // module refuses leaves plain capture: the session stays up with subtitles,
  // since the chain then says `none`. Only a plain start refused as well throws.
  async function restartCapture(echoCancellation: boolean): Promise<void> {
    const t0 = Date.now();
    const old = capture;
    capture = null;
    captureInfo = null;
    captureMode = null;
    if (old) {
      try {
        await old.stop();
      } catch (err) {
        log(`capture stop failed: ${reason(err)}`);
      }
      if (!running) return;
    }
    let c: Capture;
    try {
      c = await startCapture(echoCancellation);
    } catch (err) {
      if (!echoCancellation) throw err;
      log(`processed capture refused: ${reason(err)}`);
      c = await startCapture(false);
    }
    if (!running) {
      // Stopped while it was starting: teardown saw no capture.
      await c.stop();
      return;
    }
    capture = c;
    captureMode = echoCancellation;
    captureHalted = false;
    if (old) log(`capture restarted in ${Date.now() - t0} ms: echo cancellation ${echoCancellation ? 'on' : 'off'}, chain ${chain()}`);
    // The OS took the microphone while this was starting.
    if (capturePaused) {
      captureHalted = true;
      await c.pause();
    }
  }

  // Brings the capture to the mode the route asks for, however many routes went
  // by meanwhile: the pass in flight reads the latest one before it ends.
  async function syncCapture(): Promise<void> {
    if (!captureBegun || syncingCapture) return;
    syncingCapture = true;
    try {
      while (running && !capturePaused) {
        if (!capture || captureMode !== echoWanted()) await restartCapture(echoWanted());
        else if (captureHalted) await resumeHalted(capture);
        else break;
      }
    } catch (err) {
      log(`capture failed: ${reason(err)}`);
      // During an interruption that is the OS's doing: the resume tries again.
      if (!capturePaused) {
        await fail('microphone_denied');
        return;
      }
    } finally {
      syncingCapture = false;
    }
    if (!running) return;
    speech?.setOn(spoken());
    if (stream?.isOpen() && !connecting) status('listening', heldByUser ? 'paused' : spokenDetail(), speech !== null);
  }

  // An interruption stops the module and resuming starts it again. The route may
  // have moved meanwhile: the mode is decided again, not resumed blindly.
  function pauseCapture(): void {
    if (capturePaused) return;
    capturePaused = true;
    captureHalted = true;
    capture?.pause().catch((err) => log(`capture pause failed: ${reason(err)}`));
  }

  async function resumeCapture(): Promise<void> {
    if (!capturePaused || !running || heldByUser) return;
    capturePaused = false;
    await syncCapture();
  }

  async function resumeHalted(c: Capture): Promise<void> {
    captureHalted = false;
    try {
      captureInfo = await c.resume();
      if (!running) await c.stop();
    } catch (err) {
      log(`capture resume failed: ${reason(err)}`);
      captureMode = null;
    }
  }

  // Spec §6: the voice stops before the output changes under it (it must not
  // jump to the loudspeaker mid-sentence through an unprocessed microphone), the
  // capture restarts in the new route's mode with the socket and the lease kept,
  // then the voice follows what the capture reports.
  function applyRoute(next: Route): void {
    const leftHeadphones = headphones(route) && !headphones(next);
    route = next;
    if (!o.listen || !running) return;
    if (leftHeadphones) player?.stop();
    if (captureMode !== null && captureMode !== echoWanted()) captureInfo = null;
    speech?.setOn(spoken());
    void syncCapture();
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
      // By role, never by position: a voiced grant carries par_tts beside par_stt.
      const st = grant.streams.find((x) => x.role === 'par_stt');
      if (!st) throw new Error('missing_stt_stream');
      await s.connect({
        apiKey: st.apiKey,
        region: grant.region,
        model: SONIOX_STT_MODEL,
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
            if (e.kind === 'audio' && spoken()) player?.play(e.payload.pcm);
          }),
          clock: tickerClock,
          openSocket: nativeSocket,
        });
        speech.setOn(spoken());
        o.transcript.setSpeech?.(speech);
        // No session-started for the TTS stream: the backend reports the start of
        // transcription streams only (a TTS role carries no started bit there and
        // is refused with 400); the par_stt report above already extended the lease.
      }
      failures = 0;
      rotating = false;
      lastFailure = undefined;
      log(`${Math.max(0, Math.round((expiresAt - Date.now()) / 60000))} min left in this grant`);
      status('listening', spokenDetail(), !!tts);
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
    // Record only, unless the translation is to be heard: then play and record.
    setSessionOptions(false);
    AudioManager.observeAudioInterruptions(true);
    const permission = await AudioManager.requestRecordingPermissions();
    if (!running) return;
    if (permission !== 'Granted') {
      await fail('microphone_denied');
      return;
    }
    // On Android the module takes the device itself (spec §4.2).
    if (o.inputDeviceId && Platform.OS === 'ios') {
      try {
        await AudioManager.setInputDevice(o.inputDeviceId);
      } catch (err) {
        log(`input device ${o.inputDeviceId} not set: ${reason(err)}`);
      }
    }
    if (o.listen) {
      route = await (o.getRoute ?? nativeRoute)();
      // Stopped during the lookup: teardown has run, and would not see what is created below.
      if (!running) return;
      player = o.createPlayer?.() ?? defaultPlayer(log, () => {
        trackFailed = true;
        if (stream?.isOpen() && !connecting) status('listening', heldByUser ? 'paused' : spokenDetail(), speech !== null);
      });
      subscriptions.push({ remove: (o.onRouteChange ?? nativeRouteChange)(applyRoute) });
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
      // The notification's own actions. Stop tells the app: the session ends with
      // it, or the lease stays held and the next foreground reconnects into a dead
      // microphone. Pause and Resume reach us through patches/react-native-audio-api:
      // the library's recorder is idle, the capture is the module's.
      const onNotification = [
        RecordingNotificationManager.addEventListener('recordingNotificationStop', () => {
          log('notification: stop');
          void stopSession();
        }),
        // Said only while a stream is up: before the first grant the session is
        // not listening, and the screen's first 'listening' is what the
        // analytics count as the start.
        RecordingNotificationManager.addEventListener('recordingNotificationPause', () => {
          log('notification: pause');
          heldByUser = true;
          pauseCapture();
          if (stream?.isOpen()) status('listening', 'paused', speech !== null);
        }),
        RecordingNotificationManager.addEventListener('recordingNotificationResume', () => {
          log('notification: resume');
          heldByUser = false;
          void resumeCapture();
          if (stream?.isOpen()) status('listening', spokenDetail(), speech !== null);
        }),
      ];
      for (const sub of onNotification) if (sub) subscriptions.push(sub);
    }
    captureBegun = true;
    await syncCapture();
    // Stopped while the capture was starting, or it could not start at all.
    if (!running) return;
    // A phone call or Siri: capture pauses and, when the OS allows, resumes;
    // the socket and the lease are kept.
    const interruptions = createInterruptionHandler({
      pauseCapture,
      resumeCapture: () => { void resumeCapture(); },
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
