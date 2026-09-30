/**
 * OpenAI Live on the new contract (spec: "L0 — the client contract"), ported
 * from `OpenAILiveClient` (`src/services/clients/`, compiled until the
 * deletion after the live test) without its items, ids, karaoke bookkeeping
 * or segmentation stage: one leg, one WebSocket to the Live endpoint, opened
 * through the header seam with a Bearer header and no `Origin` (F14; ruling
 * 7). The start resolves on `session.started`, within a bound, and a refused
 * one rejects in words (choice 12). Deltas and audio become segments
 * (`segments.ts`): the translation cut where the source was, stating it
 * (ruling 3), its audio placed by the output's timeline, with real ranges
 * (ruling 2). A push-to-talk release mutes the session and a press unmutes
 * it (ruling 5). A lost connection is tried again once, then the leg fails
 * (ruling 6). Stop sends `session.close` and closes at once (ruling 8).
 * Every timer reads the request's clock, and nothing is said but through
 * events (CLAUDE.md, "Inside an IClient session").
 */
import {
  AdapterStartError,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type StartRequest,
} from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import { HeaderSocketError, platformHeaderSocket, ruleFor, type OpenHeaderSocket } from '../../lib/contract/headerSocket';
import { WS_OPEN } from '../../lib/contract/socket';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { LiveConfig } from './config';
import { computeRms, FLOOR_RMS, LiveSegments } from './segments';
import type { LiveCredentials } from './settings';
import {
  appendFrame,
  base64ToPcm,
  decodeServerEvent,
  errorCode,
  errorWords,
  LIVE_WS_URL,
  liveHeaders,
  muteFrame,
  SESSION_CLOSE,
  sessionStart,
  stampOf,
  unmuteFrame,
  type ErrorEvent,
  type OpenAIError,
  type OutputAudioDeltaEvent,
  type ServerEvent,
  type SessionClosedEvent,
  type SessionStartedEvent,
  type TranscriptDeltaEvent,
  type UsageUpdatedEvent,
} from './wire';

/** The old client's bound on the start (`OpenAILiveClient.ts:76`), now on the request's clock, the header seam's registration and upgrade inside it (choice 12). */
export const START_TIMEOUT_MS = 30_000;
/** A socket that failed before it opened: a browser cannot read why — a refused key is a 401 on the upgrade (ruling 9; choice 12). */
export const NEVER_OPENED = "OpenAI's socket did not open (check the network, and that the API key is still valid).";
/** A second unexpected end this soon after a reconnect is not tried again (`OpenAILiveClient.ts:80`; ruling 6). */
export const RECONNECT_GRACE_MS = 60_000;
/** How long a mid-session `error` words the end that follows it (OpenAI Translate's ruling 3; choice 13). */
export const ERROR_WORDS_MS = 10_000;
/**
 * How much voiced audio must go up between two equal usage reports for them
 * to read as a stall: 2 s at 24 kHz. Billing counts whole seconds and moves
 * only with appended audio (U2'), so a push-to-talk tap near a report is not
 * one (choice 14).
 */
export const STALL_VOICED_SAMPLES = 48_000;
/** Why the leg fails when its connection is gone for good: worded by the `connection_lost` alias. */
export const CONNECTION_LOST = 'The connection to OpenAI was lost and could not be restored.';
/** Refusals the user can act on: an end that follows one, or a reconnect refused so, fails in its words (ruling 6). */
const ACTIONABLE = new Set(['auth', 'rate_limit']);
/** Where the rule the seam installs applies: the Logs name it, never a value. */
const RULE = ruleFor(LIVE_WS_URL, { set: {} });

export interface LiveAdapterDeps {
  /** The header seam (F14): the platform's in the app, `fakeHeaderSockets().open` in tests. */
  openHeaderSocket: OpenHeaderSocket;
}

type Phase = 'opening' | 'live' | 'reconnecting' | 'ended';

/** Hears nothing more from a socket the leg has moved on from. */
function detach(ws: WebSocket): void {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
}

const closeWords = (e: CloseEvent) => `${e.code}${e.reason ? ` ${e.reason}` : ''}`;

/**
 * The seam's refusal in the start's words (choice 12). A browser that would
 * not open the socket comes as `nativeSocket` words it — fixed, quoting
 * nothing; an abort is passed on as it came.
 */
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
      return new AdapterStartError('OpenAI did not open the connection in time (check the network).', 'network');
    case 'unsupported':
      return new AdapterStartError('OpenAI Live needs the desktop app or the browser extension.', 'client');
    default:
      return new AdapterStartError('The app could not prepare the connection to OpenAI: restart it and try again.', 'client', undefined, { cause: error.cause });
  }
}

class LiveLeg implements AdapterSession {
  readonly info = { transport: 'websocket' };
  private phase: Phase = 'opening';
  /** The connection in use: started, and heard. Null while opening and while reconnecting. */
  private socket: WebSocket | null = null;
  private readonly segments: LiveSegments;
  /** A reconnect's attempt, which a stop aborts. */
  private attempt: AbortController | null = null;
  /** When the last reconnect succeeded: a second end within the grace is not tried again. */
  private reconnectedAt: number | null = null;
  /** Push-to-talk: the session is muted — a release's (ruling 5). */
  private muted = false;
  /** The last usage seconds, and the voiced samples sent since: two equal reports around `STALL_VOICED_SAMPLES` of them are a stall (choice 14). */
  private usage: number | null = null;
  private voicedSamples = 0;
  /** The last mid-session `error`, and when (choice 13). */
  private lastError: { code: string; message: string; at: number } | null = null;
  /** `session.unreadable` on the ok → failing transition only, a frame's and an audio delta's each. */
  private readable = true;
  private audioReadable = true;
  private eventIds = 0;

  constructor(
    private readonly request: StartRequest<LiveConfig, LiveCredentials>,
    private readonly events: AdapterEvents,
    private readonly openHeaderSocket: OpenHeaderSocket,
  ) {
    const { config, clock } = request;
    this.segments = new LiveSegments({
      clock,
      silence: config.silence,
      sentencesPerSegment: config.sentencesPerSegment,
      sink: events,
      // Each translation cut and why, for the live test (Stage 2 translation cuts, choice 14).
      cut: (summary) => this.frame('out', 'translation.cut', summary),
    });
  }

  async open(): Promise<AdapterSession> {
    try {
      await this.connect(this.request.signal);
      return this;
    } catch (error) {
      this.shutDown();
      throw error;
    }
  }

  /** One chunk as it came, while live and not muted — no frame per chunk (the hot-path rule). */
  appendAudio(pcm: Int16Array): void {
    const ws = this.live();
    if (!ws || this.muted) return;
    ws.send(appendFrame(pcm));
    if (pcm.some((s) => s !== 0)) this.voicedSamples += pcm.length;
  }

  /** OpenAI Live takes no typed text (`textInput: () => false`). */
  appendText(): void {}

  /** A press unmutes a session a release muted (ruling 5). */
  beginTurn(): void {
    const ws = this.manual();
    if (!ws || !this.muted) return;
    const frame = unmuteFrame(this.nextId('unmute'));
    ws.send(JSON.stringify(frame));
    this.frame('out', frame.type, { eventId: frame.event_id });
    this.muted = false;
  }

  /** A release mutes: what was said still finishes translating, and a muted session with nothing appended stops billing (ruling 5; U2'). */
  endTurn(): void {
    this.mute();
  }

  /** The same: what the press appended is the model's input already, and no clear exists. */
  cancelTurn(): void {
    this.mute();
  }

  /** `session.close`, framed, then the close before its first `await`: nothing waits for `session.closed` (ruling 8; choice 16). */
  stop(): Promise<void> {
    const ws = this.socket;
    if (this.phase === 'live' && ws && ws.readyState === WS_OPEN) {
      ws.send(JSON.stringify(SESSION_CLOSE));
      this.frame('out', 'session.close');
    }
    this.shutDown();
    return Promise.resolve();
  }

  private mute(): void {
    const ws = this.manual();
    if (!ws || this.muted) return;
    const frame = muteFrame(this.nextId('mute'));
    ws.send(JSON.stringify(frame));
    this.frame('out', frame.type, { eventId: frame.event_id });
    this.muted = true;
  }

  /** The connection, while live under manual turns. */
  private manual(): WebSocket | null {
    return this.request.context.turns === 'manual' ? this.live() : null;
  }

  private live(): WebSocket | null {
    const ws = this.socket;
    return this.phase === 'live' && ws !== null && ws.readyState === WS_OPEN ? ws : null;
  }

  /** The phase as it stands now: read past an `await`, where the compiler would keep an earlier assignment's narrowing. */
  private is(phase: Phase): boolean {
    return this.phase === phase;
  }

  private nextId(kind: string): string {
    this.eventIds += 1;
    return `${kind}_${this.eventIds}`;
  }

  /**
   * One connection: the seam, `session.start`, its answer (choice 12).
   * Resolves once `session.started` is heard, the connection adopted and the
   * leg live; rejects, leaving nothing open, when the seam refuses, the
   * server refuses or closes, `START_TIMEOUT_MS` passes, or `signal` aborts.
   */
  private connect(signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const { clock, config, credentials } = this.request;
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
        ? new AdapterStartError(`OpenAI did not start the session within ${START_TIMEOUT_MS / 1000} s.`, 'server')
        : new AdapterStartError(`OpenAI did not open the connection within ${START_TIMEOUT_MS / 1000} s.`, 'network')), START_TIMEOUT_MS);
      signal.addEventListener('abort', onAbort, { once: true });

      const headers = liveHeaders(credentials);
      // The rule's place and header names, never a value.
      this.frame('out', 'session.headers', { ...RULE, set: Object.keys(headers.set), remove: headers.remove ?? [] });
      this.openHeaderSocket(LIVE_WS_URL, headers, { signal: seam.signal, clock }).then((socket) => {
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
            // OpenAI Translate's name for the same close; the refusal that follows says it was the start's (choice 15).
            this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
            settle(new AdapterStartError(`OpenAI closed the connection before the session started (${closeWords(e)}).`, 'server'));
          } else if (socket === this.socket) this.unexpected('socket_closed', { code: e.code, reason: e.reason });
        };
        const start = sessionStart(config, this.nextId('start'));
        socket.send(JSON.stringify(start));
        this.frame('out', 'session.start', { model: start.session.model, voice: start.session.audio.output.voice, delegation: start.session.delegation.type, instructions: start.session.instructions });
      }, (error: unknown) => settle(seamRefusal(error)));
    });
  }

  /** A frame before `session.started`: its answer settles the connection; anything else is a Logs line. */
  private handshake(ws: WebSocket, data: unknown, settle: (error?: unknown) => void): void {
    let e: ServerEvent;
    try {
      e = decodeServerEvent(data);
    } catch (error) {
      this.frame('in', 'session.unreadable', { message: describeCause(error) });
      return;
    }
    if (e.type === 'session.started') {
      const s = (e as unknown as SessionStartedEvent).session;
      this.socket = ws;
      this.phase = 'live';
      this.frame('in', 'session.started', { id: typeof s?.id === 'string' ? s.id : null, expiresAt: typeof s?.expires_at === 'number' ? s.expires_at : null });
      settle();
    } else if (e.type === 'error') {
      // U10: an invalid voice is `invalid_request_error` `forbidden` "Voice session access denied." — a refused start, in OpenAI's words.
      const error = (e as unknown as ErrorEvent).error ?? {};
      this.errorFrame(error);
      settle(new AdapterStartError(errorWords(error), errorCode(error)));
    } else if (e.type === 'session.closed') {
      this.closedFrame(e as unknown as SessionClosedEvent);
      settle(new AdapterStartError('OpenAI closed the session before it started.', 'server'));
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
    switch (e.type) {
      case 'session.input_transcript.delta':
      case 'session.output_transcript.delta':
        this.transcript(e as unknown as TranscriptDeltaEvent);
        return;
      case 'session.output_audio.delta':
        this.audio(e as unknown as OutputAudioDeltaEvent);
        return;
      case 'session.usage.updated':
        this.usageUpdated(e as unknown as UsageUpdatedEvent);
        return;
      case 'session.closed':
        this.serverClosed(e as unknown as SessionClosedEvent);
        return;
      case 'error':
        this.serverError((e as unknown as ErrorEvent).error ?? {});
        return;
      case 'session.input_audio.muted':
      case 'session.input_audio.unmuted':
      case 'session.delegation.created':
      case 'session.instructions.appended':
      case 'session.thinking.appended':
      case 'session.commentary.appended':
      case 'session.updated':
      case 'session.started':
        this.frame('in', e.type);
        return;
      case 'info':
        this.frame('in', 'session.info');
        return;
      default:
        this.frame('in', 'session.unknown', { type: e.type });
    }
  }

  /** A transcript delta, framed with its stamps, into its side. */
  private transcript(e: TranscriptDeltaEvent): void {
    const startMs = stampOf(e.start_ms);
    const endMs = stampOf(e.end_ms);
    this.frame('in', e.type, { delta: typeof e.delta === 'string' ? e.delta : null, startMs, endMs });
    if (typeof e.delta !== 'string' || !e.delta) return;
    if (e.type === 'session.input_transcript.delta') this.segments.input(e.delta, startMs, endMs);
    else this.segments.output(e.delta, startMs, endMs);
  }

  /** An output frame: every one advances the timeline; one above the floor is framed and, on a leg that speaks, played (choice 10). */
  private audio(e: OutputAudioDeltaEvent): void {
    if (typeof e.delta !== 'string') {
      this.unreadable('audio', new Error('an audio delta with no base64 string'));
      return;
    }
    let pcm: Int16Array;
    try {
      pcm = base64ToPcm(e.delta);
    } catch (error) {
      this.unreadable('audio', error);
      return;
    }
    this.audioReadable = true;
    const rms = computeRms(pcm);
    const voiced = rms > FLOOR_RMS;
    if (voiced) this.frame('in', e.type, { samples: pcm.length, rms: Math.round(rms * 10_000) / 10_000 });
    this.segments.audio(pcm, { voiced, play: this.request.context.speech });
  }

  /** The seconds billed, framed; two equal reports with 2 s of voiced audio sent between them are a stall (choice 14). */
  private usageUpdated(e: UsageUpdatedEvent): void {
    const seconds = stampOf(e.usage?.seconds);
    this.frame('in', e.type, { seconds });
    if (seconds === null) return;
    const frozen = this.usage !== null && seconds === this.usage && this.voicedSamples >= STALL_VOICED_SAMPLES;
    this.usage = seconds;
    this.voicedSamples = 0;
    if (frozen) {
      this.frame('in', 'session.stalled', { seconds });
      this.unexpected('stalled', { seconds });
    }
  }

  /** The server ended the session: at its expiry the run ends (ruling 8); any other end unrequested is a lost connection (ruling 6). */
  private serverClosed(e: SessionClosedEvent): void {
    this.closedFrame(e);
    const reason = typeof e.reason === 'string' ? e.reason : null;
    if (reason === 'expired') this.end({ reason: 'expired' });
    else this.unexpected('session_closed', { reason });
  }

  /** Mid-session, a Logs line, kept for the end that may follow (choice 13): `invalid_audio` and its kin do not end the session (U10). */
  private serverError(error: OpenAIError): void {
    this.errorFrame(error);
    this.lastError = { code: errorCode(error), message: errorWords(error), at: this.request.clock.now() };
  }

  private errorFrame(error: OpenAIError): void {
    this.frame('in', 'session.error', { type: error.type ?? null, code: error.code ?? null, message: error.message ?? null, param: error.param ?? null });
  }

  private closedFrame(e: SessionClosedEvent): void {
    this.frame('in', 'session.closed', { reason: typeof e.reason === 'string' ? e.reason : null, seconds: stampOf(e.usage?.seconds) });
  }

  /** The last mid-session error when it came within `ERROR_WORDS_MS`, and not from a clock stepped back. */
  private recentError(): { code: string; message: string } | null {
    const last = this.lastError;
    if (!last) return null;
    const age = this.request.clock.now() - last.at;
    return age < 0 || age > ERROR_WORDS_MS ? null : { code: last.code, message: last.message };
  }

  /**
   * The connection is gone while live (ruling 6): after an actionable error,
   * in its words; within the grace of the last reconnect, for good; else
   * one attempt. Said once: a second cause while reconnecting is the same.
   */
  private unexpected(cause: 'socket_closed' | 'session_closed' | 'stalled', detail: Record<string, unknown>): void {
    if (this.phase !== 'live') return;
    this.frame('in', 'session.connection_lost', { cause, ...detail });
    // A stop made from inside the reconnect's callbacks ends the leg there (Stage 2 OpenAI Live, ruling 6).
    if (!this.is('live')) return;
    const recent = this.recentError();
    if (recent && ACTIONABLE.has(recent.code)) {
      this.end({ failed: recent });
      return;
    }
    const reconnectedAt = this.reconnectedAt;
    if (reconnectedAt !== null && this.request.clock.now() - reconnectedAt < RECONNECT_GRACE_MS) {
      this.end({ failed: { code: 'connection_lost', message: CONNECTION_LOST } });
      return;
    }
    void this.reconnect();
  }

  /** Break before make: the old socket closes, both sides close as they stand, then one attempt, the seam registering again. */
  private async reconnect(): Promise<void> {
    this.phase = 'reconnecting';
    const old = this.socket;
    this.socket = null;
    if (old) {
      detach(old);
      if (old.readyState <= WS_OPEN) old.close(1000);
    }
    this.segments.connectionLost();
    // A new session starts unmuted, unbilled and readable.
    this.muted = false;
    this.usage = null;
    this.voicedSamples = 0;
    this.readable = true;
    this.audioReadable = true;
    this.lastError = null;
    this.frame('out', 'session.reconnecting');
    this.events.reconnecting();
    // A stop made from inside the reconnect's callbacks ends the leg there (Stage 2 OpenAI Live, ruling 6).
    if (this.is('ended')) return;
    const attempt = new AbortController();
    this.attempt = attempt;
    try {
      await this.connect(attempt.signal);
    } catch (error) {
      // A stop while the attempt ran has said all there is to say.
      if (this.attempt !== attempt || this.is('ended')) return;
      this.attempt = null;
      this.frame('in', 'session.reconnect_failed', { message: describeCause(error) });
      // A key revoked or a quota spent reads as its cause, in the words a refused start gives (ruling 6).
      const refused = error instanceof AdapterStartError && ACTIONABLE.has(error.code);
      this.end(refused ? { failed: { code: error.code, message: error.message } } : { failed: { code: 'connection_lost', message: CONNECTION_LOST } });
      return;
    }
    if (this.attempt !== attempt || !this.is('live')) return;
    this.attempt = null;
    this.reconnectedAt = this.request.clock.now();
    this.frame('in', 'session.reconnected');
    this.events.reconnected();
  }

  /** A frame, or an audio delta, that will not read: a Logs line and `parse_error` on each latch's ok → failing transition only. */
  private unreadable(latch: 'frame' | 'audio', error: unknown): void {
    if (latch === 'frame' ? !this.readable : !this.audioReadable) return;
    if (latch === 'frame') this.readable = false;
    else this.audioReadable = false;
    this.frame('in', 'session.unreadable', { message: describeCause(error) });
    this.events.degraded({ code: 'parse_error', message: `A message from OpenAI could not be read: ${describeCause(error)}`, cause: error });
  }

  /** A session that ends by itself: said once, then nothing (the kit's `ended-silence`). */
  private end(how: { failed: { code: string; message: string } } | { reason: string }): void {
    if (this.phase !== 'live' && this.phase !== 'reconnecting') return;
    this.shutDown();
    if ('failed' in how) this.events.failed(how.failed);
    else this.events.closed({ reason: how.reason });
  }

  /** Every way a leg ends: no timer left, no attempt running, the socket closed and no longer heard. */
  private shutDown(): void {
    this.phase = 'ended';
    const attempt = this.attempt;
    this.attempt = null;
    attempt?.abort(new Error('The session stopped.'));
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

export function createLiveAdapter(deps: Partial<LiveAdapterDeps> = {}): Adapter<LiveConfig, LiveCredentials> {
  const openHeaderSocket = deps.openHeaderSocket ?? platformHeaderSocket;
  return {
    start(request, events) {
      // An aborted start opens nothing.
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('aborted'));
      return new LiveLeg(request, events, openHeaderSocket).open();
    },
  };
}
