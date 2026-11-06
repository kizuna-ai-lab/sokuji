/**
 * Qwen LiveTranslate on the client contract (spec 2026-10-13, §6): one leg,
 * one session at the endpoint the check found — or, when none did, the
 * one `detect` finds before the socket opens (§2). The socket opens through
 * the header seam with a Bearer header (D3); the start resolves on
 * `session.updated`, the one `session.update` confirmed, within a bound.
 * Events become segments (`segments.ts`); under push-to-talk a release
 * commits the turn, and so does a cancel, and a press made before the turn
 * ahead is done waits for that turn's `response.done` (D6) — as it does behind
 * the server's own cut of a long press. A press gone quiet past
 * `QUIET_KEEP_MS` closes its turn and sends nothing until voice comes back.
 * A close the leg did not ask for is judged by the error just before it,
 * else by its code (`qwenDropAction`, spec 2026-11-05 reconnect §4.1): a
 * dropped connection comes back through the leg's own reconnector, on the
 * same key or the token the lease answers, a new session with its own
 * update; any other end fails the leg, in that error's words, else the
 * close's. A managed leg tells its lease when a reported session's
 * connection ends, however it ends. A connection that stays open and answers nothing is a drop too,
 * a stall: under automatic turns a probe goes every `QWEN_PROBE_MS` and one
 * unanswered for `QWEN_STALL_MS` drops it; under push-to-talk, a commit
 * unanswered for `QWEN_TURN_ANSWER_MS` does. A leg with nothing to send
 * keeps the session alive past Qwen's idle close. With a screen source (spec
 * 2026-10-22) the update declares video, the frame in hand goes up right
 * after the first audio — never before it — and later frames as they come,
 * the capture layer owning their pace; a lost source is a degradation, the
 * session going on with audio. Stop sends `session.finish` and closes at
 * once. Every timer reads the request's clock, and nothing is said but
 * through events (CLAUDE.md, "Inside an adapter session").
 */
import {
  AdapterStartError,
  SAMPLE_RATE,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type FrameReason,
  type StartRequest,
} from '../../lib/contract/adapter';
import { every } from '../../lib/contract/clock';
import { framePayload } from '../../lib/contract/framePayload';
import { HeaderSocketError, ruleFor, type OpenHeaderSocket } from '../../lib/contract/headerSocket';
import { WS_OPEN } from '../../lib/contract/socket';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { closeCodeAction, createReconnector, refusalResult, reissueFailed, type AttemptResult, type DropInfo, type GiveUp, type Reconnector } from '../../lib/session/reconnect';
import { isVoiced } from '../../lib/session/turn';
import type { DetectEndpoint, Detection } from './check';
import type { QwenConfig } from './config';
import type { EndpointId } from './endpoints';
import { QwenSegments } from './segments';
import type { QwenCredentials } from './settings';
import {
  appendFrame,
  base64ToPcm,
  COMMIT,
  decodeServerEvent,
  errorCode,
  errorOf,
  errorWords,
  FINISH,
  imageFrame,
  isProbeRefusal,
  PROBE,
  qwenHeaders,
  sessionUpdate,
  socketUrl,
  str,
  type ServerEvent,
} from './wire';

/** The handshake's bound — the seam's registration and upgrade, `session.created`, the update's answer — on the request's clock (spec §6). */
export const START_TIMEOUT_MS = 15_000;
/** How long a mid-session `error` words the close that follows it (OpenAI Translate's rule). */
export const ERROR_WORDS_MS = 10_000;
/** How long a released turn may take to end (`response.done`) before a press held behind it goes up anyway: the probes saw 0.07–0.52 s. */
export const TURN_DONE_MS = 10_000;
/**
 * Qwen closes a session the client sent nothing to for 300 s (`1007 Idle
 * timeout!`, probe 2026-10-16), and a leg sends nothing while its source is
 * muted, or between push-to-talk presses: one quiet this long sends a
 * keepalive. Well under 300, since a hidden page may run the look a minute late.
 */
export const KEEPALIVE_IDLE_MS = 180_000;
/** How often the keepalive looks. */
export const KEEPALIVE_CHECK_MS = 30_000;
/** 100 ms of silence: free under automatic turns; a push-to-talk turn of it costs about 7 audio tokens. */
const KEEPALIVE_SILENCE = new Int16Array(SAMPLE_RATE / 10);
/**
 * Under push-to-talk, how much quiet still goes up between voiced chunks — a
 * pause, the end of a sentence — counted across presses. Past it nothing
 * more is sent: Qwen closes a session once about 30 s of audio since the
 * last speech it heard held none (`1007 no semantic result after merged
 * audio exceeded 30s`, probe 2026-10-16), across turns, and no commit resets
 * that count.
 */
export const QUIET_KEEP_MS = 2_000;
/** The quiet kept back to go up ahead of the voice that ends it, so its first syllable is not clipped. */
export const PRE_ROLL_MS = 300;
/**
 * Under automatic turns, how often a live leg probes its connection (spec
 * 2026-11-05 reconnect §4.2): Qwen sends nothing while the leg is quiet, and
 * a socket whose network went away can stay open, half-open, for minutes.
 * The probe (`PROBE`) is refused within 100 ms, clearing nothing (probe
 * 2026-11-06: the slowest of about 50 took 95 ms; over a 157 s session with
 * two 70 s silences, 76 of 76 were answered, the slowest in 296 ms, and both
 * utterances were transcribed, translated and spoken as without them).
 */
export const QWEN_PROBE_MS = 2_000;
/**
 * A probe nothing at all has answered for this long is a dead connection:
 * a stall. Counted from the first probe still unanswered, never from the
 * last frame heard, so a hidden page's tick a minute late finds every probe
 * answered and no stall. A tick looks before it probes: on a clock that
 * keeps time, a connection is found dead 6–8 s after the last frame it sent.
 */
export const QWEN_STALL_MS = 6_000;
/**
 * Push-to-talk has no probe: there a clear empties the press, and an empty
 * commit leaves the server refusing the next press (probe 2026-11-06). A
 * commit — a release's, or the keepalive's — that nothing at all answers for
 * this long is a stall instead; `input_audio_buffer.committed` comes in about
 * 80 ms. An idle leg owes nothing.
 */
export const QWEN_TURN_ANSWER_MS = 5_000;
const QUIET_KEEP_SAMPLES = (SAMPLE_RATE * QUIET_KEEP_MS) / 1000;
const PRE_ROLL_SAMPLES = (SAMPLE_RATE * PRE_ROLL_MS) / 1000;
/** A socket that failed before it opened: a browser cannot read why. */
export const NEVER_OPENED = "Qwen's socket did not open (check the network, and that the API key is still valid).";
/** The same for a managed leg, which has no key of its own: the grant's session token is what Qwen may have refused. */
export const NEVER_OPENED_MANAGED = "Qwen's socket did not open (check the network; the session token may have been refused).";
/** Why the leg fails when the connection closed with no words, or a reconnect gave up with no attempt's words: worded by the `connection_lost` alias. */
export const CONNECTION_LOST = 'The connection to Qwen was lost.';
const LOST = 'connection_lost';
/** What an attempt's handshake can answer that another attempt would only hear again: the key, a quota, a refused request, a model the key may not use. */
const TERMINAL = new Set(['auth', 'rate_limit', 'client', 'model_access_denied']);
/** The errors a new session may well not meet: the server's own fault, a request rate that has passed. */
const RETRYABLE = new Set(['server', 'throttled']);
/**
 * A 1007 that ends the session, not the request (probe 2026-10-16): idle for
 * 300 s, or 30 s of audio with no speech. A new session starts both counts
 * afresh.
 */
const SESSION_SPENT = /Idle timeout|no semantic result after merged audio/i;

/**
 * What a live socket's close means (spec 2026-11-05 reconnect §4.1; open
 * point §9.2): the error just before it decides first, by the code its words
 * fall under (`errorCode`) — the server's own fault or a passing request
 * rate reconnects; the key, a quota, a request the model refuses or a model
 * the key may not use end — then a 1007 for a spent session, which
 * reconnects; else the close by its code.
 */
export function qwenDropAction(e: { close?: number; reason?: string; recent?: { code: string } }): 'reconnect' | 'end' {
  if (e.recent) return RETRYABLE.has(e.recent.code) ? 'reconnect' : 'end';
  if (e.close === 1007 && e.reason !== undefined && SESSION_SPENT.test(e.reason)) return 'reconnect';
  return closeCodeAction(e.close);
}

export interface QwenAdapterDeps {
  /** The header seam (D3): the platform's in the app, `fakeHeaderSockets().open` in tests. */
  openHeaderSocket: OpenHeaderSocket;
  /** Finds the key's endpoint when no check has (`check.ts`): a stub in tests. */
  detect: DetectEndpoint;
}

type Phase = 'opening' | 'configuring' | 'live' | 'ended';

/** Hears nothing more from a socket the leg has moved on from. */
function detach(ws: WebSocket): void {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
}

const closeWords = (e: CloseEvent) => `${e.code}${e.reason ? ` ${e.reason}` : ''}`;

/**
 * The errors of closes before `session.updated` that would end a live
 * connection (`qwenDropAction`): a reconnect's attempt dials again only after
 * a close a live connection would reconnect on, so a refusal (1008, 1003) is
 * not redialled to the end of the budget. Kept beside the error, not in it:
 * the start's refusal stays the plain error it was.
 */
const closesThatEnd = new WeakSet<Error>();

/** The seam's refusal in the start's words: fixed, quoting nothing; an abort is passed on as it came. */
function seamRefusal(error: unknown, managed: boolean): unknown {
  if (!(error instanceof HeaderSocketError)) {
    return error instanceof Error && error.message.startsWith('The browser would not open the socket')
      ? new AdapterStartError(error.message, 'network')
      : error;
  }
  switch (error.reason) {
    case 'never_opened':
      return new AdapterStartError(managed ? NEVER_OPENED_MANAGED : NEVER_OPENED, 'network');
    case 'timeout':
      return new AdapterStartError('Qwen did not open the connection in time (check the network).', 'network');
    case 'unsupported':
      return new AdapterStartError('Qwen LiveTranslate needs the desktop app or the browser extension.', 'client');
    default:
      return new AdapterStartError('The app could not prepare the connection to Qwen: restart it and try again.', 'client', undefined, { cause: error.cause });
  }
}

class QwenLeg implements AdapterSession {
  /** Each leg is its own connection (split legs): never `shared`. */
  readonly info = { transport: 'websocket' };
  private phase: Phase = 'opening';
  /** The connection in use once live. */
  private socket: WebSocket | null = null;
  /** The live connection's: lets it go, telling the lease when its session was reported. A no-op when none is live. */
  private letGoSession: () => void = () => {};
  /** Each connection's own: a reconnect's segments start afresh, their refs carrying on. */
  private segments: QwenSegments;
  /** What the next connection dials with: the request's key or token, then each token the lease answers. */
  private apiKey: string;
  /** The endpoint the start dialled: every reconnect's too, never detected again. */
  private endpoint: EndpointId | null = null;
  private readonly reconnector: Reconnector;
  /** The drop the reconnector took up last: what a give-up reports with. */
  private drop: DropInfo | null = null;
  /** Why this drop's last attempt failed, in words: what the leg's failure says at a give-up. */
  private lastFailure: string | null = null;
  /** When the drop the reconnector took up last began, on the request's clock: a managed attempt dials no token minted before it. */
  private dropAt = 0;
  /** Managed: the token a request fetched for this drop. Qwen refusing it is final; refusing one the cache served is not. */
  private freshToken: string | null = null;
  /** Managed: a cached token Qwen refused at an attempt's handshake: the next reissue asks past the cache. */
  private refusedToken: string | null = null;
  /** The last mid-session `error`, and when: the words of a close that follows it closely. */
  private lastError: { code: string; message: string; at: number } | null = null;
  /** `session.unreadable` on the ok → failing transition only, a frame's and an audio delta's each. */
  private readable = true;
  private audioReadable = true;
  /**
   * Push-to-talk (D6, probe 2026-10-14): a commit is out and its turn's
   * `response.done` has not come. The server refuses audio until it does, so
   * a press meanwhile is held here and goes up then, its release after it.
   */
  private busy = false;
  private held: Int16Array[] = [];
  private releaseHeld = false;
  /** Audio went up since the last commit: a commit with none leaves the server refusing every later append. */
  private appended = false;
  /** The `TURN_DONE_MS` fallback's cancel, while busy. */
  private cancelTurnWait: (() => void) | null = null;
  /** When audio or a commit last went up: what the idle close counts from. */
  private lastSentAt = 0;
  private stopKeepalive: () => void = () => {};
  /** Automatic turns: ends the connection's probe; a no-op when none runs. */
  private stopProbe: () => void = () => {};
  /** A probe went up on this connection: a refusal of a clear is its answer, no error. */
  private probed = false;
  /** When the first probe since anything was heard went up, else null: what a stall counts from. */
  private unansweredSince: number | null = null;
  /** Qwen honoured a clear: the leg probes no more, on this connection or its reconnects'. */
  private probeHonoured = false;
  /** Push-to-talk: the `QWEN_TURN_ANSWER_MS` wait's cancel, while a commit is unanswered. */
  private cancelTurnAnswer: (() => void) | null = null;
  /** Push-to-talk: the samples of quiet since the last voiced chunk, across presses. */
  private quietSamples = 0;
  /** The last `PRE_ROLL_MS` of a quiet stretch kept back. */
  private preRoll: Int16Array[] = [];
  /** Ends the screen source's subscription; a no-op without a source. */
  private stopFrames: () => void = () => {};
  /** The newest frame that came before any audio went up: it goes right after the first audio. */
  private latest: { jpeg: Uint8Array; reason: FrameReason } | null = null;
  /** Audio has reached the socket: a frame may follow it, and every later one goes at once. */
  private audioWent = false;
  /** The source is lost and has not come back: a second loss is not said again. */
  private sourceLost = false;

  constructor(
    private readonly request: StartRequest<QwenConfig, QwenCredentials>,
    private readonly events: AdapterEvents,
    private readonly deps: QwenAdapterDeps,
  ) {
    this.segments = new QwenSegments({ sink: events, person: request.config.person });
    this.apiKey = request.credentials.apiKey;
    // A dead connection that stays open is found by the probe or the commit's wait (`watchLiveness`, spec 2026-11-05 reconnect §4.2).
    this.reconnector = createReconnector({
      clock: request.clock,
      frame: (type, payload) => this.frame('in', type, payload),
      reconnecting: (e) => this.events.reconnecting(e),
      reconnected: (e) => this.events.reconnected(e),
      gaveUp: (e) => this.gaveUp(e),
      attempt: ({ signal }) => this.attempt(signal),
    });
  }

  async open(): Promise<AdapterSession> {
    try {
      this.watchFrames();
      const endpoint = this.request.config.endpoint ?? this.request.credentials.endpoint ?? await this.detect();
      this.endpoint = endpoint;
      await this.connect(endpoint, this.request.signal);
      return this;
    } catch (error) {
      this.shutDown();
      throw error;
    }
  }

  /**
   * One chunk as it came, while live — no frame per chunk (the hot-path
   * rule). Under push-to-talk quiet goes up for `QUIET_KEEP_MS` since the
   * last voice, over any number of presses; past it the turn is closed once
   * and the quiet kept back, its last `PRE_ROLL_MS` going up ahead of the
   * voice that ends it.
   */
  appendAudio(pcm: Int16Array): void {
    if (!this.live()) return;
    if (this.request.config.manual) {
      if (isVoiced(pcm)) {
        const kept = this.quietSamples > QUIET_KEEP_SAMPLES ? this.preRoll : [];
        this.quietSamples = 0;
        this.preRoll = [];
        for (const quiet of kept) this.up(quiet);
      } else {
        const wasGoingUp = this.quietSamples <= QUIET_KEEP_SAMPLES;
        this.quietSamples += pcm.length;
        if (this.quietSamples > QUIET_KEEP_SAMPLES) {
          this.keepBack(pcm);
          // Once, as the stretch outgrows what goes up: an append left uncommitted is closed 60 s later.
          if (wasGoingUp) {
            this.frame('out', 'session.quiet_held', { afterMs: QUIET_KEEP_MS });
            this.closeTurn();
          }
          return;
        }
      }
    }
    this.up(pcm);
  }

  /** Qwen LiveTranslate takes no typed text (`textInput: () => false`). */
  appendText(): void {}

  /** Nothing to send — audio appended under push-to-talk is the turn already. The quiet count runs on, as the server's does; only the last press's kept-back quiet goes. */
  beginTurn(): void {
    this.preRoll = [];
  }

  /** A release: the turn closes, its translation finishing (D6) — once the turn before is done, when the press is held behind it. */
  endTurn(): void {
    if (this.manual()) this.closeTurn();
  }

  /**
   * A cancel is a release (D6, owner 2026-10-14). The voice gate calls a press
   * with under 500 ms of voice a cancel, which took short words like 对不对; an
   * empty press comes back with empty texts and shows nothing (probe). Never a
   * clear: with speech in the buffer it breaks the next turn, and during a
   * response it cuts that response off.
   */
  cancelTurn(): void {
    this.endTurn();
  }

  /** `session.finish`, framed, then the close before its first `await`: nothing waits for `session.finished`. */
  stop(): Promise<void> {
    const ws = this.live();
    if (ws) {
      ws.send(JSON.stringify(FINISH));
      this.frame('out', FINISH.type);
    }
    this.shutDown();
    return Promise.resolve();
  }

  /** The network is back: a reconnect waiting out its backoff tries now. */
  networkRestored(): void {
    this.reconnector.wake();
  }

  /** The connection, while live under push-to-talk. */
  private manual(): WebSocket | null {
    return this.request.config.manual ? this.live() : null;
  }

  /** A chunk goes up, or waits while the turn before is still being finished. */
  private up(pcm: Int16Array): void {
    const ws = this.live();
    if (!ws) return;
    if (this.busy) {
      if (this.held.length === 0) this.frame('out', 'session.audio_held');
      this.held.push(pcm);
      return;
    }
    ws.send(appendFrame(pcm));
    this.appended = true;
    this.lastSentAt = this.request.clock.now();
    this.audioSent();
  }

  /** The screen source's subscription, when the request has one: frames are kept or sent by `onFrame`, a loss and a return are said. */
  private watchFrames(): void {
    const frames = this.request.frames;
    if (!frames) return;
    this.stopFrames = frames.subscribe(
      (jpeg, reason) => this.onFrame(jpeg, reason),
      () => this.onSourceLost(),
      () => this.onSourceBack(),
    );
  }

  /** A frame: sent at once once audio has gone up, else the newest waits for it. Never timed here: the capture layer owns the pace. */
  private onFrame(jpeg: Uint8Array, reason: FrameReason): void {
    if (this.phase === 'ended') return;
    if (this.audioWent) this.sendImage(jpeg, reason);
    else this.latest = { jpeg, reason };
  }

  /** Audio has reached the socket (`up()`, a held press's release, a keepalive): the first time, the frame in hand goes right after it. */
  private audioSent(): void {
    if (this.audioWent) return;
    this.audioWent = true;
    const waiting = this.latest;
    this.latest = null;
    if (waiting) this.sendImage(waiting.jpeg, waiting.reason);
  }

  /** One frame up, framed by its size and reason alone: the image is never in a Logs line. */
  private sendImage(jpeg: Uint8Array, reason: FrameReason): void {
    const ws = this.live();
    if (!ws) return;
    ws.send(imageFrame(jpeg));
    this.frame('out', 'input_image_buffer.append', { bytes: jpeg.byteLength, reason });
  }

  /** The chosen area is gone: said once per loss, the session going on with audio. The source's name is never in the words. */
  private onSourceLost(): void {
    if (this.phase === 'ended' || this.sourceLost) return;
    this.sourceLost = true;
    this.events.degraded({ code: 'screen_context_lost', message: 'The chosen screen is no longer available; translation continues on audio alone.' });
  }

  private onSourceBack(): void {
    if (this.phase === 'ended') return;
    this.sourceLost = false;
    this.frame('out', 'session.screen_context_back');
  }

  /** A quiet chunk kept back: only the last `PRE_ROLL_MS` of them stay. */
  private keepBack(pcm: Int16Array): void {
    this.preRoll.push(pcm);
    let samples = this.preRoll.reduce((n, c) => n + c.length, 0);
    while (this.preRoll.length > 1 && samples - this.preRoll[0].length >= PRE_ROLL_SAMPLES) {
      samples -= this.preRoll[0].length;
      this.preRoll.shift();
    }
  }

  /** Closes the turn on the wire: at once, or once the turn before is done when audio waits behind it. */
  private closeTurn(): void {
    if (this.busy) this.releaseHeld = this.held.length > 0;
    else this.commit();
  }

  /** Ends the press on the wire, unless nothing went up since the last commit. */
  private commit(): void {
    const ws = this.manual();
    if (!ws || !this.appended) return;
    ws.send(JSON.stringify(COMMIT));
    this.frame('out', COMMIT.type);
    this.lastSentAt = this.request.clock.now();
    this.awaitAnswer();
    this.awaitTurn();
  }

  /** A commit is out: nothing at all heard for `QWEN_TURN_ANSWER_MS` is a stall. Counted from the first commit unanswered. */
  private awaitAnswer(): void {
    if (this.cancelTurnAnswer) return;
    this.cancelTurnAnswer = this.request.clock.setTimeout(() => {
      this.cancelTurnAnswer = null;
      this.dropped({ cause: 'stall' });
    }, QWEN_TURN_ANSWER_MS);
  }

  /** A turn closed on the wire, by the leg or by the server: busy until its `response.done`, or `TURN_DONE_MS` without it. */
  private awaitTurn(): void {
    this.appended = false;
    this.busy = true;
    this.cancelTurnWait = this.request.clock.setTimeout(() => {
      this.cancelTurnWait = null;
      this.frame('out', 'session.turn_timeout', { afterMs: TURN_DONE_MS });
      this.turnDone();
    }, TURN_DONE_MS);
  }

  /** The committed turn is done (`response.done`, or `TURN_DONE_MS` without it): a held press goes up, its release after it. */
  private turnDone(): void {
    if (!this.busy) return;
    this.busy = false;
    this.cancelTurnWait?.();
    this.cancelTurnWait = null;
    const ws = this.live();
    const held = this.held;
    this.held = [];
    if (!ws || held.length === 0) return;
    for (const pcm of held) ws.send(appendFrame(pcm));
    this.appended = true;
    this.lastSentAt = this.request.clock.now();
    this.frame('out', 'session.audio_released', { chunks: held.length });
    this.audioSent();
    if (this.releaseHeld) {
      this.releaseHeld = false;
      this.commit();
    }
  }

  /**
   * A look of the keepalive (probe 2026-10-16): after `KEEPALIVE_IDLE_MS`
   * with nothing gone up, 100 ms of silence. Under push-to-talk it is a turn
   * of its own, committed at once — an append alone is closed 60 s later —
   * never into a press with audio waiting to be committed, nor while a turn
   * is still being finished. A press held with nothing left to send (a muted
   * source, or quiet past its allowance) still gets it: the idle close would
   * come all the same. Its turn comes back empty and shows nothing.
   */
  private keepalive(): void {
    const ws = this.live();
    if (!ws) return;
    const now = this.request.clock.now();
    // A wall clock stepped back (`realClock.now()` is `Date.now()`): the wait carries on from now.
    if (now < this.lastSentAt) this.lastSentAt = now;
    const idleMs = now - this.lastSentAt;
    if (idleMs < KEEPALIVE_IDLE_MS) return;
    const manual = this.request.config.manual;
    if (manual && (this.busy || this.appended)) return;
    ws.send(appendFrame(KEEPALIVE_SILENCE));
    this.frame('out', 'session.keepalive', { idleMs });
    this.audioSent();
    this.lastSentAt = now;
    if (manual) {
      this.appended = true;
      this.commit();
    }
  }

  /**
   * The new connection's liveness (spec 2026-11-05 reconnect §4.2). Under
   * automatic turns, a probe every `QWEN_PROBE_MS` — unless Qwen once
   * honoured one — framed by nothing (the hot-path rule); under push-to-talk,
   * only each commit's wait (`awaitAnswer`).
   */
  private watchLiveness(): void {
    this.probed = false;
    this.unansweredSince = null;
    if (this.request.config.manual || this.probeHonoured) return;
    this.stopProbe = every(this.request.clock, QWEN_PROBE_MS, () => this.probe());
  }

  /** A look, then a probe: a probe unanswered for `QWEN_STALL_MS` drops the connection as a stall. */
  private probe(): void {
    const ws = this.live();
    if (!ws) return;
    const now = this.request.clock.now();
    // A wall clock stepped back (`realClock.now()` is `Date.now()`): the wait carries on from now.
    if (this.unansweredSince !== null && now < this.unansweredSince) this.unansweredSince = now;
    if (this.unansweredSince !== null && now - this.unansweredSince >= QWEN_STALL_MS) {
      this.dropped({ cause: 'stall' });
      return;
    }
    // Before the send: an answer may come within it.
    this.probed = true;
    this.unansweredSince ??= now;
    ws.send(JSON.stringify(PROBE));
  }

  /** Anything from the server answers the probe and the commit. */
  private heard(): void {
    this.unansweredSince = null;
    this.cancelTurnAnswer?.();
    this.cancelTurnAnswer = null;
  }

  /** Qwen cleared on a probe: one that clears may cut into speech, so the leg probes no more and, as before the probe, notices only a close. */
  private probeCleared(): void {
    if (!this.probed || this.probeHonoured) return;
    this.probeHonoured = true;
    this.stopLivenessWatch();
    this.frame('in', 'session.probe_stopped', { reason: 'clear_honoured' });
  }

  /** No probe, and no commit's wait: the connection is let go, or the probe stops. */
  private stopLivenessWatch(): void {
    this.stopProbe();
    this.stopProbe = () => {};
    this.unansweredSince = null;
    this.cancelTurnAnswer?.();
    this.cancelTurnAnswer = null;
  }

  /** Read through a call: across an `await`, the leg may have ended whatever the phase was set to before it. */
  private hasEnded(): boolean {
    return this.phase === 'ended';
  }

  private live(): WebSocket | null {
    const ws = this.socket;
    return this.phase === 'live' && ws !== null && ws.readyState === WS_OPEN ? ws : null;
  }

  /** The key's endpoint, when no check has found it (§2): a refusal in the check's words, anything else the network's. */
  private async detect(): Promise<EndpointId> {
    const { credentials, clock, signal } = this.request;
    this.frame('out', 'session.detect');
    let found: Detection;
    try {
      found = await this.deps.detect(credentials.apiKey, { clock, signal });
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      throw new AdapterStartError('Qwen did not answer the key check (check the network).', 'network', undefined, { cause: error });
    }
    if ('refused' in found) throw new AdapterStartError(found.refused, found.code);
    this.frame('in', 'session.detected', { endpoint: found.endpoint });
    return found.endpoint;
  }

  /**
   * One connection, the start's or a reconnect's: the seam, `session.created`,
   * the update, its answer. Resolves with the socket once `session.updated`
   * is heard, the leg live; rejects, leaving nothing open, when the seam
   * refuses, the server refuses or closes, `START_TIMEOUT_MS` passes, or
   * `signal` aborts — the request's at the start, the reconnector's for an
   * attempt.
   */
  private connect(endpoint: EndpointId, signal: AbortSignal): Promise<WebSocket> {
    return new Promise<WebSocket>((resolve, reject) => {
      const { clock, config, credentials } = this.request;
      // A stop while the endpoint was being found: nothing opens.
      if (signal.aborted) {
        reject(signal.reason ?? new Error('aborted'));
        return;
      }
      const seam = new AbortController();
      let ws: WebSocket | null = null;
      let settled = false;
      const settle = (error?: unknown) => {
        if (settled) return;
        settled = true;
        cancelBound();
        signal.removeEventListener('abort', onAbort);
        if (error === undefined) {
          // Only the handshake settles without an error, on the socket it was given: live, it is let go where the leg
          // lets its socket go (`dropped`, `shutDown`), and it replaces any connection before it.
          this.letGoSession();
          this.letGoSession = letGo;
          resolve(ws as WebSocket);
          return;
        }
        letGo();
        seam.abort(error);
        if (ws) {
          detach(ws);
          if (ws.readyState <= WS_OPEN) ws.close(1000);
        }
        reject(error);
      };
      const onAbort = () => settle(signal.reason ?? new Error('aborted'));
      const cancelBound = clock.setTimeout(() => settle(ws
        ? new AdapterStartError(`Qwen did not start the session within ${START_TIMEOUT_MS / 1000} s.`, 'server')
        : new AdapterStartError(`Qwen did not open the connection within ${START_TIMEOUT_MS / 1000} s.`, 'network')), START_TIMEOUT_MS);
      signal.addEventListener('abort', onAbort, { once: true });

      // The lease hears of this socket's session once it holds both the id and the handshake's request id, in whichever order they land.
      // Each connection's own: a request id that lands after its connection dropped reports that connection's session, never the next one's.
      const lease = credentials.lease;
      let created: string | undefined;
      let seamAnswered = false;
      let seamRequestId: string | undefined;
      let reported = false;
      /** This connection is over: refused, abandoned, dropped, failed, stopped or replaced. */
      let over = false;
      // The lease reports its own failures: a throw here must not end the leg.
      const tellEnded = (id: string) => { try { lease?.sessionEnded(id); } catch { /* the lease's to say */ } };
      const report = () => {
        // Deliberate: an unreported session is still charged by its window.
        if (!lease || reported || created === undefined || !seamAnswered || this.phase === 'ended' || seam.signal.aborted) return;
        reported = true;
        try { lease.sessionCreated(created, seamRequestId); } catch { /* the lease's to say */ }
        // A request id that landed after its connection was let go: that session is reported, and over at once.
        if (over) tellEnded(created);
      };
      /**
       * The leg is done with this connection. When its session was reported,
       * the lease hears that the connection ended, so a report not yet
       * acknowledged is tried no more (spec 2026-11-05 reconnect §4.2).
       */
      const letGo = () => {
        if (over) return;
        over = true;
        if (reported && created !== undefined) tellEnded(created);
      };
      const url = socketUrl(endpoint, config.model);
      const headers = qwenHeaders({ apiKey: this.apiKey });
      const rule = ruleFor(url, { set: {} });
      // The endpoint, the rule's place and the header's name, never a value.
      this.frame('out', 'session.headers', { endpoint, host: rule.host, path: rule.path, set: Object.keys(headers.set) });
      this.deps.openHeaderSocket(url, headers, {
        signal: seam.signal,
        clock,
        onRequestId: (id) => { seamAnswered = true; seamRequestId = id; report(); },
      }).then((socket) => {
        if (settled) {
          detach(socket);
          socket.close(1000);
          return;
        }
        ws = socket;
        socket.binaryType = 'arraybuffer';
        socket.onmessage = (e: MessageEvent) => {
          if (!settled) this.handshake(socket, e.data, settle, (id) => { created = id; report(); });
          else if (socket === this.socket) this.onMessage(e.data);
        };
        // A Logs line: the close that follows says what it did to the session.
        socket.onerror = () => this.frame('in', 'session.socket_error');
        socket.onclose = (e: CloseEvent) => {
          if (!settled) {
            // An attempt's close is one of the reconnect's; `session.connection_lost` is the start's, and the give-up's.
            this.frame('in', this.reconnector.active ? 'session.closed' : 'session.connection_lost', { code: e.code, reason: e.reason });
            const error = new AdapterStartError(`Qwen closed the connection before the session started (${closeWords(e)}).`, e.reason ? errorCode({ code: null, message: e.reason }) : 'server');
            if (qwenDropAction({ close: e.code, reason: e.reason }) === 'end') closesThatEnd.add(error);
            settle(error);
          } else if (socket === this.socket) this.closed(e);
        };
      }, (error: unknown) => settle(seamRefusal(error, lease !== undefined)));
    });
  }

  /** A frame before the leg is live: `session.created` sends the update, `session.updated` settles the start, an `error` refuses it. */
  private handshake(ws: WebSocket, data: unknown, settle: (error?: unknown) => void, created: (id: string) => void): void {
    let e: ServerEvent;
    try {
      e = decodeServerEvent(data);
    } catch (error) {
      this.frame('in', 'session.unreadable', { message: describeCause(error) });
      return;
    }
    if (e.type === 'session.created') {
      const s = (typeof e.session === 'object' && e.session !== null ? e.session : {}) as { id?: unknown; model?: unknown };
      this.frame('in', 'session.created', { id: str(s.id), model: str(s.model) });
      if (this.phase !== 'opening') return;
      const update = sessionUpdate(this.request.config, { video: this.request.frames !== undefined });
      ws.send(JSON.stringify(update));
      this.frame('out', 'session.update', update.session);
      this.phase = 'configuring';
      if (typeof s.id === 'string' && s.id) created(s.id);
    } else if (e.type === 'session.updated') {
      this.frame('in', 'session.updated');
      if (this.phase !== 'configuring') return;
      this.socket = ws;
      this.phase = 'live';
      this.lastSentAt = this.request.clock.now();
      this.stopKeepalive = every(this.request.clock, KEEPALIVE_CHECK_MS, () => this.keepalive());
      this.watchLiveness();
      settle();
    } else if (e.type === 'error') {
      const error = errorOf(e);
      this.frame('in', 'session.error', error);
      settle(new AdapterStartError(errorWords(error), errorCode(error)));
    } else this.frame('in', 'session.unknown', { type: e.type });
  }

  private onMessage(data: unknown): void {
    if (this.phase !== 'live') return;
    this.heard();
    let e: ServerEvent;
    try {
      e = decodeServerEvent(data);
    } catch (error) {
      this.unreadable('frame', error);
      return;
    }
    this.readable = true;
    const itemId = str(e.item_id);
    switch (e.type) {
      case 'input_audio_buffer.speech_started': {
        const speaker = typeof e.speaker_id === 'number' ? e.speaker_id : null;
        this.frame('in', e.type, { itemId, speaker });
        if (itemId) this.segments.heard(itemId, speaker);
        return;
      }
      case 'conversation.item.created': {
        const item = (typeof e.item === 'object' && e.item !== null ? e.item : {}) as { id?: unknown; content?: unknown };
        const id = str(item.id);
        // The heard item carries input audio; the translation's content is empty, and names the heard item before it.
        const inputAudio = Array.isArray(item.content) && item.content.some((c) => (c as { type?: unknown } | null)?.type === 'input_audio');
        const previous = str(e.previous_item_id);
        this.frame('in', e.type, { itemId: id, previous, inputAudio });
        if (id) this.segments.created(id, { inputAudio, previous });
        return;
      }
      case 'response.output_item.added': {
        const item = (typeof e.item === 'object' && e.item !== null ? e.item : {}) as { id?: unknown };
        const id = str(item.id);
        this.frame('in', e.type, { itemId: id });
        if (id) this.segments.answer(id);
        return;
      }
      case 'conversation.item.input_audio_transcription.delta':
      case 'response.audio_transcript.delta':
      case 'response.text.delta': {
        const delta = str(e.delta);
        this.frame('in', e.type, { itemId, delta });
        if (itemId && delta) this.segments.text(itemId, e.type.startsWith('conversation.') ? 'source' : 'translation', delta);
        return;
      }
      case 'conversation.item.input_audio_transcription.completed':
      case 'response.audio_transcript.done':
      case 'response.text.done': {
        const final = str(e.transcript) ?? str(e.text);
        this.frame('in', e.type, { itemId, text: final });
        if (itemId) this.segments.done(itemId, e.type.startsWith('conversation.') ? 'source' : 'translation', final);
        return;
      }
      case 'response.audio.delta':
        this.audio(itemId, e.delta);
        return;
      // The translation's speech is all here: its last phrase takes its karaoke ranges (`QwenSegments.audioDone`).
      case 'response.audio.done':
        this.frame('in', e.type, { itemId });
        if (itemId) this.segments.audioDone(itemId);
        return;
      case 'response.done': {
        const r = (typeof e.response === 'object' && e.response !== null ? e.response : {}) as { status?: unknown; usage?: unknown };
        // The session's running totals: what the live test reads the bill from.
        this.frame('in', e.type, { status: str(r.status), usage: r.usage ?? null });
        // Under push-to-talk, the end of the committed turn: the server takes audio again.
        this.turnDone();
        return;
      }
      case 'error':
        // A probe's refusal is its answer, heard above, and no error: it words no close, and is not framed.
        if (this.probed && isProbeRefusal(e)) return;
        this.serverError(e);
        return;
      // A commit's acknowledgement names its heard item when it already exists; the turn ends at `response.done`, not here.
      // Under push-to-talk one the leg did not send is the server cutting a long press (every ~30 s of audio, probe
      // 2026-10-16): it refuses audio until that turn is done, so the press waits, as it does behind a release.
      case 'input_audio_buffer.committed':
        this.frame('in', e.type, { itemId });
        if (this.manual() && !this.busy) {
          this.frame('in', 'session.server_cut');
          this.awaitTurn();
        }
        return;
      case 'input_audio_buffer.cleared':
        this.frame('in', e.type);
        this.probeCleared();
        return;
      case 'input_audio_buffer.speech_stopped':
      case 'response.created':
      case 'response.content_part.added':
      case 'response.content_part.done':
      case 'response.output_item.done':
      case 'session.finished':
        this.frame('in', e.type);
        return;
      default:
        this.frame('in', 'session.unknown', { type: e.type });
    }
  }

  /** Translated speech, framed by its size; played only on a leg that speaks — the update asked for none otherwise. */
  private audio(itemId: string | null, delta: unknown): void {
    if (typeof delta !== 'string') {
      this.unreadable('audio', new Error('an audio delta with no base64 string'));
      return;
    }
    let pcm: Int16Array;
    try {
      pcm = base64ToPcm(delta);
    } catch (error) {
      this.unreadable('audio', error);
      return;
    }
    this.audioReadable = true;
    this.frame('in', 'response.audio.delta', { itemId, samples: pcm.length });
    if (!this.request.context.speech || !itemId || pcm.length === 0) return;
    this.segments.audio(itemId, pcm);
  }

  /** Mid-session, a Logs line kept for the close that follows: every error the probes saw was followed by one (1007, 1011). */
  private serverError(e: ServerEvent): void {
    const error = errorOf(e);
    this.frame('in', 'session.error', error);
    this.lastError = { code: errorCode(error), message: errorWords(error), at: this.request.clock.now() };
  }

  /** The last mid-session error when it came within `ERROR_WORDS_MS`, and not from a clock stepped back. */
  private recentError(): { code: string; message: string } | null {
    const last = this.lastError;
    if (!last) return null;
    const age = this.request.clock.now() - last.at;
    return age < 0 || age > ERROR_WORDS_MS ? null : { code: last.code, message: last.message };
  }

  /**
   * The socket closed while live, and nothing asked for it: a drop worth
   * retrying reconnects (`qwenDropAction`); any other end fails the leg, in a
   * recent error's words, else the close's, else the lost connection's.
   */
  private closed(e: CloseEvent): void {
    const recent = this.recentError();
    const drop: Pick<DropInfo, 'cause' | 'closeCode' | 'errorCode'> = recent
      ? { cause: 'error', closeCode: e.code, errorCode: recent.code }
      : { cause: 'close', closeCode: e.code };
    if (qwenDropAction({ close: e.code, reason: e.reason, ...(recent ? { recent } : {}) }) === 'reconnect') {
      // The close's own Logs line: `session.connection_lost` is the give-up's.
      this.frame('in', 'session.closed', { code: e.code, reason: e.reason });
      this.dropped(drop);
      return;
    }
    this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
    const reason = e.reason ? { code: null, message: e.reason } : null;
    const failure = recent ?? (reason ? { code: errorCode(reason), message: errorWords(reason) } : { code: LOST, message: CONNECTION_LOST });
    this.end({ ...failure, drop: this.dropInfo(drop, false) });
  }

  private dropInfo(drop: Pick<DropInfo, 'cause' | 'closeCode' | 'errorCode'>, retryable: boolean): DropInfo {
    return { ...drop, retryable, managed: this.request.credentials.lease !== undefined };
  }

  /**
   * A live connection ended unasked, and its end is worth retrying. Break
   * before make (spec 2026-11-05 reconnect §4.2): its segments in flight
   * close as they stand, its turn is let go, and the socket is detached and
   * closed; only then do the attempts begin, the first inside `dropped()`
   * unless the drop is a flap. The screen's subscription is taken again, so
   * the frame in hand waits for the new session's first audio, as at the
   * start: a session that declares video and has no frame by its first turn
   * is ended (spec 2026-10-22 §2).
   */
  private dropped(drop: Pick<DropInfo, 'cause' | 'closeCode' | 'errorCode'>): void {
    if (this.phase === 'ended') return;
    this.segments.abandon();
    this.resetTurnState();
    this.stopKeepalive();
    this.stopKeepalive = () => {};
    this.stopLivenessWatch();
    // The dropped connection's error says nothing of the next one's close.
    this.lastError = null;
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      detach(ws);
      if (ws.readyState <= WS_OPEN) ws.close(1000);
    }
    this.releaseSession();
    this.phase = 'opening';
    this.stopFrames();
    this.watchFrames();
    // An attempt's connection that dropped as it came live: the reconnector fails that attempt, whether or not it has seen it live, and the next one follows.
    if (this.reconnector.active) {
      this.reconnector.dropped(this.dropInfo(drop, true));
      return;
    }
    this.newDrop(this.dropInfo(drop, true));
  }

  /** A drop the reconnector takes up: its start, its words, and the tokens it fetched or saw refused, start afresh. */
  private newDrop(drop: DropInfo): void {
    this.drop = drop;
    this.dropAt = this.request.clock.now();
    this.lastFailure = null;
    this.freshToken = null;
    this.refusedToken = null;
    this.reconnector.dropped(drop);
  }

  /**
   * A dropped connection's turn is gone with it (spec 2026-11-05 reconnect
   * §4.3): nothing waits on its `response.done`, what it held never goes up,
   * the quiet count and the frame's wait start again on the next
   * connection, whose segments are new — their refs carrying on.
   */
  private resetTurnState(): void {
    this.busy = false;
    this.held = [];
    this.releaseHeld = false;
    this.appended = false;
    this.cancelTurnWait?.();
    this.cancelTurnWait = null;
    this.quietSamples = 0;
    this.preRoll = [];
    this.latest = null;
    this.audioWent = false;
    this.segments.stop();
    this.segments = new QwenSegments({ sink: this.events, person: this.request.config.person, firstRef: this.segments.nextRef });
  }

  /**
   * One reconnect attempt (spec 2026-11-05 reconnect §4.2). Managed: the
   * lease's token first, never one minted before this drop began — the one
   * it fetched since then while it lasts, which the drop's later attempts
   * and the other leg's drop in the same blip share, else one request for
   * both — a refusal stopping the attempts. Then
   * the start's own connect, on the endpoint the start dialled: a new
   * session, whose update and report go as at the start. An answer the
   * handshake would give again (`TERMINAL`), or a close there that would end
   * a live connection, stops them too, in its own code — but for Qwen
   * refusing a token the lease's cache served (lapsed early, revoked): the
   * next attempt asks past the cache. The signal, every
   * attempt's of this drop, aborts at the budget's end and on a stop.
   */
  private async attempt(signal: AbortSignal): Promise<AttemptResult> {
    const { clock, credentials } = this.request;
    const lease = credentials.lease;
    let reissued = false;
    let reissueMs = 0;
    const failed = (code: string, message: string): AttemptResult => {
      this.lastFailure = message;
      return { ok: false, final: false, code, message, reissued, reissueMs };
    };
    // An answer nobody reads; it leaves the last failure's words as they were.
    const abandoned: AttemptResult = { ok: false, final: false, code: LOST, message: 'The attempt was abandoned.', reissued: false, reissueMs: 0 };
    if (lease) {
      const refused = this.refusedToken;
      this.refusedToken = null;
      const asked = clock.now();
      const answer = await lease.reissue({ notBefore: this.dropAt, ...(refused !== null ? { refused } : {}) });
      reissueMs = clock.now() - asked;
      // Abandoned meanwhile (a stop, the budget's end): nobody reads the answer, and nothing opens.
      if (signal.aborted || this.hasEnded()) return abandoned;
      if (!answer.ok) {
        this.lastFailure = answer.message;
        // A refusal stops the attempts (spec §6); a reissue that could not answer is a failed attempt.
        return answer.retry ? reissueFailed(answer.message, reissueMs) : refusalResult(answer);
      }
      reissued = answer.fresh;
      if (answer.fresh) this.freshToken = answer.apiKey;
      this.apiKey = answer.apiKey;
    }
    // A handshake an attempt before this one left halfway starts over.
    this.phase = 'opening';
    let ws: WebSocket;
    try {
      ws = await this.connect(this.endpoint as EndpointId, signal);
    } catch (error) {
      // Closed by the abort (a stop, the budget's end): not the attempt's own failure.
      if (signal.aborted || this.hasEnded()) return abandoned;
      const code = error instanceof AdapterStartError ? error.code : 'network';
      const message = describeCause(error);
      // Qwen refused a token the cache served: the next attempt asks past the cache. One fetched for this drop is refused for good, as an own key is.
      if (code === 'auth' && lease && this.apiKey !== this.freshToken) {
        this.refusedToken = this.apiKey;
        return failed(code, message);
      }
      // A handshake's close is read as a live one's (§4.1): one that would end a live connection ends the attempts, in the handshake's words.
      const ends = error instanceof Error && closesThatEnd.has(error);
      if (!TERMINAL.has(code) && !ends) return failed(code, message);
      this.lastFailure = message;
      return { ok: false, final: true, reason: 'terminal_error', code, message };
    }
    if (signal.aborted || this.hasEnded()) return abandoned;
    // It dropped as it came live (`dropped()` let it go): the next attempt goes on, and that drop is this one.
    if (this.socket !== ws) return failed(LOST, 'The new connection dropped as it opened.');
    return { ok: true, reissued, reissueMs };
  }

  /**
   * The attempts ended without a connection: the leg fails with the policy's
   * code and the drop it gave up on, in the last attempt's words, or the
   * lost connection's when none was made; the verdict's reason stays in
   * `giveUp` and the frames. The Qwen lease has no grant-end test: its own
   * timer ends the run at the grant's end, so a `lease_ended` here fails as
   * the connection lost.
   */
  private gaveUp(e: GiveUp): void {
    const { code, message: _verdict, ...giveUp } = e;
    this.end({ code, message: this.lastFailure ?? CONNECTION_LOST, ...(this.drop ? { drop: this.drop } : {}), giveUp });
  }

  /** A frame, or an audio delta, that will not read: a Logs line and `parse_error` on each latch's ok → failing transition only. */
  private unreadable(latch: 'frame' | 'audio', error: unknown): void {
    if (latch === 'frame' ? !this.readable : !this.audioReadable) return;
    if (latch === 'frame') this.readable = false;
    else this.audioReadable = false;
    this.frame('in', 'session.unreadable', { message: describeCause(error) });
    this.events.degraded({ code: 'parse_error', message: `A message from Qwen could not be read: ${describeCause(error)}`, cause: error });
  }

  /** A session that ends by itself, live or reconnecting: said once, then nothing (the kit's `ended-silence`). */
  private end(failed: Parameters<AdapterEvents['failed']>[0]): void {
    if (this.phase === 'ended') return;
    this.shutDown();
    this.events.failed(failed);
  }

  /** Every way a leg ends: the reconnect cancelled, the segments silent, the socket closed and no longer heard. */
  private shutDown(): void {
    this.phase = 'ended';
    // Waits, an attempt's connect and a reissue's late answer: all cancelled, and nothing more is said.
    this.reconnector.cancel();
    this.stopKeepalive();
    this.stopKeepalive = () => {};
    this.stopLivenessWatch();
    this.cancelTurnWait?.();
    this.cancelTurnWait = null;
    this.held = [];
    this.preRoll = [];
    this.stopFrames();
    this.stopFrames = () => {};
    this.latest = null;
    this.segments.stop();
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      detach(ws);
      if (ws.readyState <= WS_OPEN) ws.close(1000);
    }
    this.releaseSession();
  }

  /** The live connection is let go: the lease hears its reported session's connection ended. */
  private releaseSession(): void {
    const letGo = this.letGoSession;
    this.letGoSession = () => {};
    letGo();
  }

  private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
    if (this.phase === 'ended') return;
    this.events.frame(payload === undefined ? { direction, type } : { direction, type, payload: framePayload(payload) });
  }
}

export function createQwenAdapter(deps: QwenAdapterDeps): Adapter<QwenConfig, QwenCredentials> {
  return {
    start(request, events) {
      // An aborted start opens nothing.
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('aborted'));
      return new QwenLeg(request, events, deps).open();
    },
  };
}
