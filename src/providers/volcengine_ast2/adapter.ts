/**
 * Doubao AST 2.0 on the new contract (spec: "L0 — the client contract"),
 * ported from `VolcengineAST2Client` (`src/services/clients/`, still
 * compiled until the deletion plan) without its display bookkeeping: items,
 * ids and the punctuation lane are L1's and L2's now. One protobuf socket
 * per leg, its credentials in the URL's query (ruling 2); subtitles become
 * segments (`segments.ts`), spoken sentences rangeless audio (`speech.ts`),
 * and what goes up is resampled and paced (`audioIn.ts`). Every timer reads
 * the request's clock, and nothing is said but through events (CLAUDE.md,
 * "Inside an IClient session").
 */
import {
  AdapterStartError,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type Side,
  type StartRequest,
} from '../../lib/contract/adapter';
import { every } from '../../lib/contract/clock';
import { framePayload } from '../../lib/contract/framePayload';
import { describeCause } from '../../lib/diagnostics/describeCause';
import { IDLE_MS, InputPacer, KEEPALIVE_MS, PACKET_SAMPLES, TAIL_MS } from './audioIn';
import type { Ast2Config } from './config';
import { decodeOggOpus } from './decode';
import { Ast2Segments, type SubtitlePhase } from './segments';
import type { Ast2Credentials } from './settings';
import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
import { Ast2Speech, type OggDecoder } from './speech';
import {
  ast2Url,
  audioFrame,
  decodeResponse,
  eventName,
  EventType,
  finishSessionFrame,
  isOk,
  OFFLINE,
  REFUSED_UPGRADE,
  startSessionFrame,
  statusFailureCode,
  statusText,
  toNumber,
  type Ast2Response,
  type SessionIds,
} from './wire';

/** The old client's bound on the start (`VolcengineAST2Client.ts:438-448`), now on the request's clock. */
export const START_TIMEOUT_MS = 30_000;

export interface Ast2AdapterDeps {
  /** `new WebSocket(url)` in the app; a `FakeSocket` factory in tests. */
  openSocket: OpenSocket;
  /** A spoken sentence's Ogg Opus as 24 kHz pcm (`decode.ts` in the app). */
  decode: OggDecoder;
  /** A fresh session or connection id. */
  newId: () => string;
  /** False: the device is offline, and a socket that failed before it opened says nothing about the credentials. */
  online: () => boolean;
}

/** The keepalive's packet: 80 ms of silence. */
const SILENCE = new Int16Array(PACKET_SAMPLES);

const SUBTITLES: Readonly<Record<number, [Side, SubtitlePhase]>> = {
  [EventType.SourceSubtitleStart]: ['source', 'start'],
  [EventType.SourceSubtitleResponse]: ['source', 'response'],
  [EventType.SourceSubtitleEnd]: ['source', 'end'],
  [EventType.TranslationSubtitleStart]: ['translation', 'start'],
  [EventType.TranslationSubtitleResponse]: ['translation', 'response'],
  [EventType.TranslationSubtitleEnd]: ['translation', 'end'],
};

const closeWords = (e: CloseEvent) => `${e.code}${e.reason ? ` ${e.reason}` : ''}`;

/** A thrown value's name alone (`SyntaxError`, `SecurityError`), never its message. */
function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name !== '' ? name : 'unknown error';
}

class Ast2Leg implements AdapterSession {
  readonly info = { transport: 'websocket' };
  readonly opening: Promise<AdapterSession>;
  private phase: 'opening' | 'live' | 'ended' = 'opening';
  private opened = false;
  private readonly ids: SessionIds;
  private sequence = 0;
  private readonly socket: WebSocket;
  private readonly segments: Ast2Segments;
  /** None on a leg that does not speak: its TTS events are ignored (`s2t` sends none). */
  private readonly speech: Ast2Speech | null;
  private readonly pacer = new InputPacer();
  private lastAudioAt = 0;
  private idle = false;
  /** The last frame would not read: said on the ok → failing transition only, as Soniox's and Gemini's are. */
  private unreadable = false;
  private stopKeepalive: () => void = () => {};
  private settle: { resolve(): void; reject(error: unknown): void } | null = null;

  constructor(
    private readonly request: StartRequest<Ast2Config, Ast2Credentials>,
    private readonly events: AdapterEvents,
    private readonly deps: Ast2AdapterDeps,
  ) {
    this.ids = { session: deps.newId(), connection: deps.newId() };
    this.segments = new Ast2Segments(events);
    this.speech = request.config.mode === 's2s' ? new Ast2Speech(deps.decode, events) : null;
    this.socket = deps.openSocket(ast2Url(request.credentials));
    this.socket.binaryType = 'arraybuffer';
    this.opening = new Promise<AdapterSession>((resolve, reject) => {
      const { clock, signal } = request;
      const cancelTimer = clock.setTimeout(() => this.refuse(this.opened
        ? new AdapterStartError(`Doubao did not start the session within ${START_TIMEOUT_MS / 1000} s.`, 'server')
        : new AdapterStartError(`Doubao did not open the connection within ${START_TIMEOUT_MS / 1000} s.`, 'network')), START_TIMEOUT_MS);
      const onAbort = () => this.refuse(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', onAbort, { once: true });
      const done = () => { cancelTimer(); signal.removeEventListener('abort', onAbort); };
      this.settle = {
        resolve: () => { done(); resolve(this); },
        reject: (error) => { done(); reject(error); },
      };
    });
    this.socket.onopen = () => this.onOpen();
    this.socket.onmessage = (e: MessageEvent) => this.onMessage(e.data);
    // A Logs line: the close that follows says what it did to the session.
    this.socket.onerror = () => { if (this.phase !== 'ended') this.frame('in', 'session.socket_error'); };
    this.socket.onclose = (e: CloseEvent) => this.onClose(e);
  }

  appendAudio(pcm: Int16Array): void {
    if (this.phase !== 'live') return;
    for (const packet of this.pacer.push(pcm)) this.sendAudio(packet);
    this.lastAudioAt = this.request.clock.now();
    if (this.idle) {
      this.idle = false;
      this.frame('out', 'audio.resumed');
    }
  }

  /** Doubao takes no typed text (`textInput: false`). */
  appendText(): void {}

  /** Nothing to mark: Doubao's own VAD finds speech. */
  beginTurn(): void {}

  /** A release, with or without speech (ruling 6): what waits, then 500 ms of silence at once, so the server closes the segment now. */
  endTurn(): void {
    this.tail(false);
  }

  cancelTurn(): void {
    this.tail(true);
  }

  /** `FinishSession` and the close before its first `await`; what the server still sends is not awaited (parity). */
  stop(): Promise<void> {
    if (this.phase === 'live' && this.socket.readyState === WS_OPEN) this.socket.send(finishSessionFrame(this.ids, this.sequence++));
    this.shutDown();
    return Promise.resolve();
  }

  private onOpen(): void {
    if (this.phase !== 'opening') return;
    this.opened = true;
    const { config, credentials } = this.request;
    this.socket.send(startSessionFrame({
      ids: this.ids,
      sequence: this.sequence++,
      mode: config.mode,
      source: config.sourceLanguage,
      target: config.targetLanguage,
      ...(config.corpus ? { corpus: config.corpus } : {}),
      ...(credentials.kind === 'app' ? { appKey: credentials.appKey } : {}),
    }));
    // Never the request's meta: it carries the App ID (`conformance.ts`' credential rule).
    this.frame('out', 'session.start', { sessionId: this.ids.session, mode: config.mode, source: config.sourceLanguage, target: config.targetLanguage, corpus: config.corpus ?? null });
  }

  private onMessage(data: unknown): void {
    if (this.phase === 'ended') return;
    let r: Ast2Response;
    try {
      r = decodeResponse(data);
    } catch (error) {
      // Once per episode, in the Logs and as a notice: a persistent failure would otherwise say it per TTS chunk (the hot-path rule). The next frame that reads ends the episode.
      if (!this.unreadable) {
        this.unreadable = true;
        this.frame('in', 'session.unreadable', { message: describeCause(error) });
        if (this.phase === 'live') this.events.degraded({ code: 'parse_error', message: `A message from Doubao could not be read: ${describeCause(error)}`, cause: error });
      }
      return;
    }
    this.unreadable = false;
    const meta = r.responseMeta;
    const status = meta?.StatusCode ?? 0;
    const sequence = meta?.Sequence ?? 0;
    if (!isOk(status)) {
      this.frame('in', 'session.status', { event: eventName(r.event), statusCode: status, message: meta?.Message ?? '', sequence });
      // Ruling 8: a refusal while opening; mid-session, the run ends with its code.
      this.failWith(statusFailureCode(status), statusText(status, meta?.Message));
      return;
    }
    if (meta?.SessionID && meta.SessionID !== this.ids.session) {
      this.frame('in', 'session.foreign', { event: eventName(r.event) });
      return;
    }
    const subtitle = SUBTITLES[r.event];
    if (subtitle) {
      this.subtitle(subtitle[0], subtitle[1], r, sequence);
      return;
    }
    switch (r.event) {
      case EventType.SessionStarted:
        this.frame('in', 'session.started', { sessionId: this.ids.session });
        if (this.phase === 'opening') this.started();
        return;
      case EventType.SessionFailed:
        this.frame('in', 'session.failed', { statusCode: status, message: meta?.Message ?? '' });
        this.failWith('server', statusText(status, meta?.Message));
        return;
      case EventType.SessionFinished:
      case EventType.SessionCanceled:
        this.frame('in', r.event === EventType.SessionFinished ? 'session.finished' : 'session.canceled');
        if (this.phase === 'opening') this.refuse(new AdapterStartError('Doubao ended the session before it started.', 'server'));
        else this.end({ reason: eventName(r.event) });
        return;
      case EventType.TTSSentenceStart:
      case EventType.TTSResponse:
      case EventType.TTSSentenceEnd:
      case EventType.TTSEnded:
        this.tts(r, sequence);
        return;
      case EventType.UsageResponse: {
        const billing = meta?.Billing;
        this.frame('in', 'session.usage', {
          durationMsec: toNumber(billing?.DurationMsec) ?? null,
          wordCount: toNumber(billing?.WordCount) ?? null,
          items: (billing?.Items ?? []).map((i) => ({ unit: i.Unit ?? '', quantity: i.Quantity ?? 0 })),
        });
        return;
      }
      case EventType.AudioMuted:
        this.frame('in', 'session.audio_muted', { mutedDurationMs: r.mutedDurationMs });
        return;
      default:
        if (r.event !== EventType.None) this.frame('in', 'session.unknown', { event: eventName(r.event) });
    }
  }

  /** One subtitle, with what pairing may need later framed beside it (ruling 11): the Sequence and both times. */
  private subtitle(side: Side, phase: SubtitlePhase, r: Ast2Response, sequence: number): void {
    const ref = this.phase === 'live' ? this.segments.subtitle(side, phase, r.text) : null;
    this.frame('in', `subtitle.${side}`, { phase, ref, text: r.text, startTime: r.startTime, endTime: r.endTime, sequence, spkChg: r.spkChg });
  }

  private tts(r: Ast2Response, sequence: number): void {
    const speech = this.speech;
    if (!speech || this.phase !== 'live') return;
    if (r.event === EventType.TTSResponse) {
      speech.chunk(r.data);
    } else if (r.event === EventType.TTSSentenceStart) {
      const ref = this.segments.speechRef();
      speech.sentenceStart(ref);
      // The locked ref, shown or not: the live test reads here whether the sentence's translation was ever shown.
      this.frame('in', 'tts.sentence_start', { ref: ref ?? null, sequence });
    } else {
      this.frame('in', r.event === EventType.TTSSentenceEnd ? 'tts.sentence_end' : 'tts.ended', { ...speech.flush(), sequence });
    }
  }

  private started(): void {
    this.phase = 'live';
    this.lastAudioAt = this.request.clock.now();
    this.stopKeepalive = every(this.request.clock, KEEPALIVE_MS, () => this.keepalive());
    const settle = this.settle;
    this.settle = null;
    settle?.resolve();
  }

  /**
   * The keepalive (ruling 7): nothing reaches the server while the
   * microphone is muted or between push-to-talk turns, and it would time the
   * session out. Silence goes up only once no audio has for `IDLE_MS`, one
   * 80 ms packet per 80 ms, so it is never spliced between two chunks of
   * speech (survey §0.6). Framed on the transitions only. An idle's first
   * tick sends what the pacer still holds before any silence, so no speech
   * from before the idle follows it.
   */
  private keepalive(): void {
    if (this.phase !== 'live') return;
    const since = this.request.clock.now() - this.lastAudioAt;
    if (since < IDLE_MS) return;
    if (!this.idle) {
      this.idle = true;
      for (const packet of this.pacer.drain()) this.sendAudio(packet);
      this.frame('out', 'audio.idle', { sinceMs: since });
    }
    this.sendAudio(SILENCE);
  }

  private tail(cancelled: boolean): void {
    if (this.phase !== 'live' || this.request.context.turns !== 'manual') return;
    for (const packet of this.pacer.tail()) this.sendAudio(packet);
    this.lastAudioAt = this.request.clock.now();
    this.frame('out', 'turn.tail', { ms: TAIL_MS, ...(cancelled ? { cancelled: true } : {}) });
  }

  private sendAudio(packet: Int16Array): void {
    if (this.socket.readyState === WS_OPEN) this.socket.send(audioFrame(this.ids, this.sequence++, packet));
  }

  private onClose(e: CloseEvent): void {
    if (this.phase === 'opening') {
      this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
      // A browser cannot see the upgrade's HTTP status (choice 8).
      this.refuse(this.opened
        ? new AdapterStartError(`Doubao closed the connection before the session started (${closeWords(e)}).`, 'server')
        : this.deps.online()
          ? new AdapterStartError(REFUSED_UPGRADE, 'auth')
          : new AdapterStartError(OFFLINE, 'network'));
      return;
    }
    if (this.phase !== 'live') return;
    this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
    this.end({ failed: { code: 'connection_lost', message: `The connection to Doubao closed (${closeWords(e)}).` } });
  }

  private failWith(code: 'client' | 'server', message: string): void {
    if (this.phase === 'opening') this.refuse(new AdapterStartError(message, code));
    else this.end({ failed: { code, message } });
  }

  /** A start that will not resolve: rejected once, the socket closed, nothing emitted but frames. */
  private refuse(error: unknown): void {
    if (this.phase !== 'opening') return;
    this.shutDown();
    const settle = this.settle;
    this.settle = null;
    settle?.reject(error);
  }

  /** A session that ends by itself: said once, then nothing (the kit's `ended-silence`). */
  private end(how: { failed: { code: string; message: string } } | { reason: string }): void {
    if (this.phase !== 'live') return;
    this.shutDown();
    if ('failed' in how) this.events.failed(how.failed);
    else this.events.closed({ reason: how.reason });
  }

  /** Every way a leg ends: no timer left, no decode, the socket closed and no longer heard. */
  private shutDown(): void {
    this.phase = 'ended';
    this.stopKeepalive();
    this.speech?.stop();
    const socket = this.socket;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState <= WS_OPEN) socket.close(1000);
  }

  private frame(direction: 'in' | 'out', type: string, payload?: Record<string, unknown>): void {
    this.events.frame(payload === undefined ? { direction, type } : { direction, type, payload: framePayload(payload) });
  }
}

export function createAst2Adapter(deps: Partial<Ast2AdapterDeps> = {}): Adapter<Ast2Config, Ast2Credentials> {
  const resolved: Ast2AdapterDeps = {
    openSocket: deps.openSocket ?? nativeSocket,
    decode: deps.decode ?? decodeOggOpus,
    newId: deps.newId ?? (() => crypto.randomUUID()),
    online: deps.online ?? (() => navigator.onLine !== false),
  };
  return {
    start(request, events) {
      // An aborted start opens nothing.
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('aborted'));
      try {
        return new Ast2Leg(request, events, resolved).opening;
      } catch (error) {
        // A start rejects, never throws. In fixed words and with no cause: a browser that refuses the socket quotes its URL, and the URL carries the credentials.
        return Promise.reject(new AdapterStartError(`The browser would not open the socket (${errorName(error)}).`, 'network'));
      }
    },
  };
}
