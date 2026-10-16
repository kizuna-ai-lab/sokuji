/**
 * Qwen LiveTranslate on the client contract (spec 2026-10-13, §6): one leg,
 * one session at the storefront the check found — or, when none did, the
 * one `detect` finds before the socket opens (§2). The socket opens through
 * the header seam with a Bearer header (D3); the start resolves on
 * `session.updated`, the one `session.update` confirmed, within a bound.
 * Events become segments (`segments.ts`); under push-to-talk a release
 * commits the turn, and so does a cancel, and a press made before the turn
 * ahead is done waits for that turn's `response.done` (D6) — as it does behind
 * the server's own cut of a long press. A press gone quiet past
 * `QUIET_KEEP_MS` closes its turn and sends nothing until voice comes back.
 * An error words the close that follows it, and any end the leg did not ask
 * for fails it: there is no reconnect (D8). A leg with nothing to send keeps
 * the session alive past Qwen's idle close. Stop sends `session.finish` and closes at once. Every
 * timer reads the request's clock, and nothing is said but through events
 * (CLAUDE.md, "Inside an adapter session").
 */
import {
  AdapterStartError,
  SAMPLE_RATE,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type StartRequest,
} from '../../lib/contract/adapter';
import { every } from '../../lib/contract/clock';
import { framePayload } from '../../lib/contract/framePayload';
import { HeaderSocketError, ruleFor, type OpenHeaderSocket } from '../../lib/contract/headerSocket';
import { WS_OPEN } from '../../lib/contract/socket';
import { describeCause } from '../../lib/diagnostics/describeCause';
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
const QUIET_KEEP_SAMPLES = (SAMPLE_RATE * QUIET_KEEP_MS) / 1000;
const PRE_ROLL_SAMPLES = (SAMPLE_RATE * PRE_ROLL_MS) / 1000;
/** A socket that failed before it opened: a browser cannot read why. */
export const NEVER_OPENED = "Qwen's socket did not open (check the network, and that the API key is still valid).";
/** Why the leg fails when the connection closed with no words (D8): worded by the `connection_lost` alias. */
export const CONNECTION_LOST = 'The connection to Qwen was lost.';

export interface QwenAdapterDeps {
  /** The header seam (D3): the platform's in the app, `fakeHeaderSockets().open` in tests. */
  openHeaderSocket: OpenHeaderSocket;
  /** Finds the key's storefront when no check has (`check.ts`): a stub in tests. */
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

/** The seam's refusal in the start's words: fixed, quoting nothing; an abort is passed on as it came. */
function seamRefusal(error: unknown): unknown {
  if (!(error instanceof HeaderSocketError)) {
    return error instanceof Error && error.message.startsWith('The browser would not open the socket')
      ? new AdapterStartError(error.message, 'network')
      : error;
  }
  switch (error.reason) {
    case 'never_opened':
      return new AdapterStartError(NEVER_OPENED, 'network');
    case 'timeout':
      return new AdapterStartError('Qwen did not open the connection in time (check the network).', 'network');
    case 'unsupported':
      return new AdapterStartError('Qwen LiveTranslate needs the desktop app or the browser extension.', 'client');
    default:
      return new AdapterStartError('The app could not prepare the connection to Qwen: restart it and try again.', 'client', undefined, { cause: error.cause });
  }
}

class QwenLeg implements AdapterSession {
  readonly info = { transport: 'websocket' };
  private phase: Phase = 'opening';
  /** The connection in use once live. */
  private socket: WebSocket | null = null;
  private readonly segments: QwenSegments;
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
  /** Push-to-talk: the samples of quiet since the last voiced chunk, across presses. */
  private quietSamples = 0;
  /** The last `PRE_ROLL_MS` of a quiet stretch kept back. */
  private preRoll: Int16Array[] = [];

  constructor(
    private readonly request: StartRequest<QwenConfig, QwenCredentials>,
    private readonly events: AdapterEvents,
    private readonly deps: QwenAdapterDeps,
  ) {
    this.segments = new QwenSegments({ sink: events, person: request.config.person });
  }

  async open(): Promise<AdapterSession> {
    try {
      const endpoint = this.request.config.endpoint ?? await this.detect();
      await this.connect(endpoint);
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
    this.awaitTurn();
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
    this.lastSentAt = now;
    if (manual) {
      this.appended = true;
      this.commit();
    }
  }

  private live(): WebSocket | null {
    const ws = this.socket;
    return this.phase === 'live' && ws !== null && ws.readyState === WS_OPEN ? ws : null;
  }

  /** The key's storefront, when no check has found it (§2): a refusal in the check's words, anything else the network's. */
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
   * One connection: the seam, `session.created`, the update, its answer.
   * Resolves once `session.updated` is heard, the leg live; rejects, leaving
   * nothing open, when the seam refuses, the server refuses or closes,
   * `START_TIMEOUT_MS` passes, or the request's signal aborts.
   */
  private connect(endpoint: EndpointId): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const { clock, config, credentials, signal } = this.request;
      // A stop while the storefront was being found: nothing opens.
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
          resolve();
          return;
        }
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

      const url = socketUrl(endpoint, config.model);
      const headers = qwenHeaders(credentials);
      const rule = ruleFor(url, { set: {} });
      // The storefront, the rule's place and the header's name, never a value.
      this.frame('out', 'session.headers', { endpoint, host: rule.host, path: rule.path, set: Object.keys(headers.set) });
      this.deps.openHeaderSocket(url, headers, { signal: seam.signal, clock }).then((socket) => {
        if (settled) {
          detach(socket);
          socket.close(1000);
          return;
        }
        ws = socket;
        socket.binaryType = 'arraybuffer';
        socket.onmessage = (e: MessageEvent) => {
          if (!settled) this.handshake(socket, e.data, settle);
          else if (socket === this.socket) this.onMessage(e.data);
        };
        // A Logs line: the close that follows says what it did to the session.
        socket.onerror = () => this.frame('in', 'session.socket_error');
        socket.onclose = (e: CloseEvent) => {
          if (!settled) {
            this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
            settle(new AdapterStartError(`Qwen closed the connection before the session started (${closeWords(e)}).`, e.reason ? errorCode({ code: null, message: e.reason }) : 'server'));
          } else if (socket === this.socket) this.closed(e);
        };
      }, (error: unknown) => settle(seamRefusal(error)));
    });
  }

  /** A frame before the leg is live: `session.created` sends the update, `session.updated` settles the start, an `error` refuses it. */
  private handshake(ws: WebSocket, data: unknown, settle: (error?: unknown) => void): void {
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
      const update = sessionUpdate(this.request.config);
      ws.send(JSON.stringify(update));
      this.frame('out', 'session.update', update.session);
      this.phase = 'configuring';
    } else if (e.type === 'session.updated') {
      this.frame('in', 'session.updated');
      if (this.phase !== 'configuring') return;
      this.socket = ws;
      this.phase = 'live';
      this.lastSentAt = this.request.clock.now();
      this.stopKeepalive = every(this.request.clock, KEEPALIVE_CHECK_MS, () => this.keepalive());
      settle();
    } else if (e.type === 'error') {
      const error = errorOf(e);
      this.frame('in', 'session.error', error);
      settle(new AdapterStartError(errorWords(error), errorCode(error)));
    } else this.frame('in', 'session.unknown', { type: e.type });
  }

  private onMessage(data: unknown): void {
    if (this.phase !== 'live') return;
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

  /** The socket closed while live: nothing asked for it (D8). In a recent error's words, else the close's, else the lost connection. */
  private closed(e: CloseEvent): void {
    this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
    const reason = e.reason ? { code: null, message: e.reason } : null;
    this.end(this.recentError()
      ?? (reason ? { code: errorCode(reason), message: errorWords(reason) } : { code: 'connection_lost', message: CONNECTION_LOST }));
  }

  /** A frame, or an audio delta, that will not read: a Logs line and `parse_error` on each latch's ok → failing transition only. */
  private unreadable(latch: 'frame' | 'audio', error: unknown): void {
    if (latch === 'frame' ? !this.readable : !this.audioReadable) return;
    if (latch === 'frame') this.readable = false;
    else this.audioReadable = false;
    this.frame('in', 'session.unreadable', { message: describeCause(error) });
    this.events.degraded({ code: 'parse_error', message: `A message from Qwen could not be read: ${describeCause(error)}`, cause: error });
  }

  /** A session that ends by itself: said once, then nothing (the kit's `ended-silence`). */
  private end(failed: { code: string; message: string }): void {
    if (this.phase !== 'live') return;
    this.shutDown();
    this.events.failed(failed);
  }

  /** Every way a leg ends: the segments silent, the socket closed and no longer heard. */
  private shutDown(): void {
    this.phase = 'ended';
    this.stopKeepalive();
    this.stopKeepalive = () => {};
    this.cancelTurnWait?.();
    this.cancelTurnWait = null;
    this.held = [];
    this.preRoll = [];
    this.segments.stop();
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      detach(ws);
      if (ws.readyState <= WS_OPEN) ws.close(1000);
    }
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
