/**
 * Qwen LiveTranslate on the client contract (spec 2026-10-13, §6): one leg,
 * one session at the storefront the check found — or, when none did, the
 * one `detect` finds before the socket opens (§2). The socket opens through
 * the header seam with a Bearer header (D3); the start resolves on
 * `session.updated`, the one `session.update` confirmed, within a bound.
 * Events become segments (`segments.ts`); a push-to-talk release commits
 * the turn and a cancel clears it (D6). An error words the close that
 * follows it, and any end the leg did not ask for fails it: there is no
 * reconnect (D8). Stop sends `session.finish` and closes at once. Every
 * timer reads the request's clock, and nothing is said but through events
 * (CLAUDE.md, "Inside an adapter session").
 */
import {
  AdapterStartError,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type StartRequest,
} from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import { HeaderSocketError, ruleFor, type OpenHeaderSocket } from '../../lib/contract/headerSocket';
import { WS_OPEN } from '../../lib/contract/socket';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { DetectEndpoint, Detection } from './check';
import type { QwenConfig } from './config';
import type { EndpointId } from './endpoints';
import { QwenSegments } from './segments';
import type { QwenCredentials } from './settings';
import {
  appendFrame,
  base64ToPcm,
  CLEAR,
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

  /** One chunk as it came, while live — no frame per chunk (the hot-path rule). */
  appendAudio(pcm: Int16Array): void {
    this.live()?.send(appendFrame(pcm));
  }

  /** Qwen LiveTranslate takes no typed text (`textInput: () => false`). */
  appendText(): void {}

  /** Nothing to send: audio appended under push-to-talk is the turn already. */
  beginTurn(): void {}

  /** A release: the turn closes, its translation finishing (D6). */
  endTurn(): void {
    const ws = this.manual();
    if (!ws) return;
    ws.send(JSON.stringify(COMMIT));
    this.frame('out', COMMIT.type);
  }

  /** A cancel: the buffer empties; the server never finishes that response, so the segments close here (D6). */
  cancelTurn(): void {
    const ws = this.manual();
    if (!ws) return;
    ws.send(JSON.stringify(CLEAR));
    this.frame('out', CLEAR.type);
    this.segments.cancel();
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
      case 'response.done': {
        const r = (typeof e.response === 'object' && e.response !== null ? e.response : {}) as { status?: unknown; usage?: unknown };
        // The session's running totals: what the live test reads the bill from.
        this.frame('in', e.type, { status: str(r.status), usage: r.usage ?? null });
        return;
      }
      case 'error':
        this.serverError(e);
        return;
      // A release's and a cancel's acknowledgements: each closes a push-to-talk turn for the segments (`QwenSegments.cancel`).
      case 'input_audio_buffer.committed':
        this.frame('in', e.type);
        this.segments.committed();
        return;
      case 'input_audio_buffer.cleared':
        this.frame('in', e.type);
        this.segments.cleared();
        return;
      case 'input_audio_buffer.speech_stopped':
      case 'response.created':
      case 'response.content_part.added':
      case 'response.content_part.done':
      case 'response.audio.done':
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
