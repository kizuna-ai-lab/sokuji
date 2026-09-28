/**
 * OpenAI Realtime on the new contract (spec: "L0 — the client contract"),
 * ported from `OpenAIGAClient` (`src/services/clients/`, still compiled
 * until the deletion plan) without its items, its segmentation stage or the
 * old MainPanel's orchestration: one leg, one WebSocket to the GA endpoint,
 * the key in a subprotocol (choice 7). The start resolves on
 * `session.updated`, the configuration confirmed, so a refused one rejects
 * in words within a bound (ruling 22; choice 6). Items become segments,
 * paired by the input each translation follows (`items.ts`, choice 8);
 * in-band responses go up one at a time (`queue.ts`, ruling 8); the drift
 * anchor re-sends the instructions out of band (ruling 2). Every timer
 * reads the request's clock, and nothing is said but through events
 * (CLAUDE.md, "Inside an IClient session").
 */
import type {
  ConversationItemAdded,
  ConversationItemInputAudioTranscriptionCompletedEvent,
  ConversationItemInputAudioTranscriptionDeltaEvent,
  ConversationItemInputAudioTranscriptionFailedEvent,
  InputAudioBufferCommittedEvent,
  InputAudioBufferSpeechStartedEvent,
  InputAudioBufferSpeechStoppedEvent,
  RateLimitsUpdatedEvent,
  RealtimeError,
  RealtimeErrorEvent,
  ResponseAudioDeltaEvent,
  ResponseAudioDoneEvent,
  ResponseAudioTranscriptDeltaEvent,
  ResponseAudioTranscriptDoneEvent,
  ResponseCreatedEvent,
  ResponseDoneEvent,
  ResponseOutputItemAddedEvent,
  ResponseOutputItemDoneEvent,
  ResponseTextDeltaEvent,
  ResponseTextDoneEvent,
  SessionCreatedEvent,
  SessionUpdatedEvent,
} from 'openai/resources/realtime/realtime';
import {
  AdapterStartError,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type StartRequest,
} from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import { base64ToPcm } from '../../lib/contract/pcm64';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { RealtimeConfig } from './config';
import { RealtimeItems } from './items';
import { ACTIVE_RESPONSE, ResponseQueue, type Request } from './queue';
import type { RealtimeCredentials } from './settings';
import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
import {
  anchorResponse,
  appendFrame,
  CLEAR,
  COMMIT,
  decodeServerEvent,
  errorCode,
  errorWords,
  isOutOfBand,
  realtimeProtocols,
  realtimeUrl,
  requestOf,
  responseCreate,
  sessionUpdate,
  textItem,
  unwrapTranslationText,
  type ServerEvent,
} from './wire';

/** The old client's bound on the start (`OpenAIGAClient.ts:185-228`), now on the request's clock, and closing the socket (choice 6). */
export const START_TIMEOUT_MS = 30_000;
/** A socket that failed before it opened: a browser cannot read why (choice 6). */
export const NEVER_OPENED = "OpenAI's socket did not open (check the network, and that the API key is still valid).";
/**
 * How long a mid-session `error` words the close that follows it (ruling
 * 13; choice 14): a close later than this is the connection's own. OpenAI
 * Translate's starting value, which its live test and this one's settle.
 */
export const ERROR_WORDS_MS = 10_000;
/** The drift anchor's interval (ruling 2): at the start, then after every fifth completed translation (`MainPanel.tsx:4245-4325` before `aecaae2b`). */
export const ANCHOR_EVERY = 5;

/** Known events with nothing to act on: a Logs line under their own name (choice 13). */
const QUIET = new Set([
  'conversation.item.done', 'conversation.item.deleted', 'conversation.item.truncated', 'conversation.item.input_audio_transcription.segment',
  'input_audio_buffer.timeout_triggered', 'response.content_part.added', 'response.content_part.done',
]);

export interface RealtimeAdapterDeps {
  /** `new WebSocket(url, protocols)` in the app; a `FakeSocket` factory in tests. */
  openSocket: OpenSocket;
}

const closeWords = (e: CloseEvent) => `${e.code}${e.reason ? ` ${e.reason}` : ''}`;

/** A thrown value's name alone (`SyntaxError`, `SecurityError`), never its message: a browser that refuses a subprotocol quotes it, the key in it. */
function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name !== '' ? name : 'unknown error';
}

/** A conversation item's id and role, whatever kind of item it is. */
function itemOf(item: unknown): { id: string | undefined; role: string | undefined } {
  const i = (item ?? {}) as { id?: unknown; role?: unknown };
  return { id: typeof i.id === 'string' ? i.id : undefined, role: typeof i.role === 'string' ? i.role : undefined };
}

class RealtimeLeg implements AdapterSession {
  readonly info: { transport: string };
  readonly opening: Promise<AdapterSession>;
  /** `opening` until the server's session exists; `configuring` once `session.update` went out; `live` once the server confirmed it. */
  private phase: 'opening' | 'configuring' | 'live' | 'ended' = 'opening';
  private opened = false;
  private readonly socket: WebSocket;
  private readonly items: RealtimeItems;
  private readonly queue: ResponseQueue;
  /** The client's own ids, one counter: request event ids (`sokuji_<n>`) and typed items' (`sokuji_text_<n>`, under the API's 32 characters). */
  private ids = 0;
  /** Typed items already sent: a request asked again sends its `response.create` alone (choice 10). */
  private readonly itemsSent = new Set<string>();
  /** An in-band response is in progress: `busy` said (choice 10). */
  private producing = false;
  /** In-band responses that ended `completed`: what the anchor counts (ruling 2; choice 11). */
  private completed = 0;
  /** The count the last anchor went up at; -1 before the first. */
  private anchoredAt = -1;
  /** The last frame parsed: `session.unreadable` on the ok → failing transition only (choice 15). */
  private readable = true;
  /** The last output audio decoded: its own episode, since every frame that parses re-arms `readable`. */
  private audioReadable = true;
  /** The last `error` event mid-session, and when: the words of a close that follows it closely (ruling 13; choice 14). */
  private lastError: { code: string; message: string; at: number } | null = null;
  private settle: { resolve(): void; reject(error: unknown): void } | null = null;

  constructor(
    private readonly request: StartRequest<RealtimeConfig, RealtimeCredentials>,
    private readonly events: AdapterEvents,
    openSocket: OpenSocket,
  ) {
    const { config, clock, signal } = request;
    // The WebRTC step's attachment point (choice 18): today every config says `websocket`.
    this.info = { transport: config.transport };
    this.items = new RealtimeItems(events);
    this.queue = new ResponseQueue({
      clock,
      eventId: () => `sokuji_${++this.ids}`,
      sink: {
        send: (asked, eventId, waitedMs, merged) => this.ask(asked, eventId, waitedMs, merged),
        queued: (asked, waiting) => this.frame('out', 'response.queued', { for: asked.kind, waiting }),
      },
    });
    const url = realtimeUrl(config);
    const protocols = realtimeProtocols(request.credentials);
    try {
      this.socket = openSocket(url, protocols);
    } catch (error) {
      // In fixed words and with no cause: a browser that refuses the socket quotes the subprotocols, the key among them (choice 7).
      throw new AdapterStartError(`The browser would not open the socket (${errorName(error)}).`, 'network');
    }
    this.socket.binaryType = 'arraybuffer';
    this.opening = new Promise<AdapterSession>((resolve, reject) => {
      const cancelTimer = clock.setTimeout(() => this.refuse(this.opened
        ? new AdapterStartError(`OpenAI did not start the session within ${START_TIMEOUT_MS / 1000} s.`, 'server')
        : new AdapterStartError(`OpenAI did not open the connection within ${START_TIMEOUT_MS / 1000} s.`, 'network')), START_TIMEOUT_MS);
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
    this.socket.onerror = () => this.frame('in', 'session.socket_error');
    this.socket.onclose = (e: CloseEvent) => this.onClose(e);
  }

  /** One chunk as it came — no pacing, no resampling — and no frame per chunk (the hot-path rule). */
  appendAudio(pcm: Int16Array): void {
    if (this.phase !== 'live') return;
    this.send(appendFrame(pcm));
  }

  /**
   * Typed text (ruling 8): trimmed, shown at once as its own source, and
   * sent — or held first in first out while a response is in progress.
   * Dropped while the session is not live.
   */
  appendText(text: string): void {
    const trimmed = text.trim();
    if (this.phase !== 'live' || !trimmed) return;
    const itemId = `sokuji_text_${++this.ids}`;
    this.items.typed(itemId, trimmed);
    this.queue.push({ kind: 'text', itemId, text: trimmed });
  }

  /** Nothing to send at a press over WebSocket: the buffer takes what is appended. */
  beginTurn(): void {}

  /** A release with speech, under manual turns: what was appended becomes an input item now, and its response goes up when none is in progress (ruling 8; choice 12). */
  endTurn(): void {
    if (this.phase !== 'live' || this.request.context.turns !== 'manual') return;
    // A commit that did not go up made no input: no response is asked for it.
    if (!this.send(JSON.stringify(COMMIT))) return;
    this.frame('out', 'input_audio_buffer.commit');
    this.queue.push({ kind: 'turn' });
  }

  /** A release without speech: the press's audio is cleared, never left to join the next turn (spec, "Defects removed by construction"; choice 12). */
  cancelTurn(): void {
    if (this.phase !== 'live' || this.request.context.turns !== 'manual') return;
    if (this.send(JSON.stringify(CLEAR))) this.frame('out', 'input_audio_buffer.clear');
  }

  /** The close before its first `await`; nothing is sent to end the session first. */
  stop(): Promise<void> {
    this.shutDown();
    return Promise.resolve();
  }

  private onOpen(): void {
    if (this.phase !== 'opening') return;
    this.opened = true;
    const { config, context } = this.request;
    // Never the protocols: the second carries the key.
    this.frame('out', 'session.opened', {
      model: config.model, modalities: config.modalities, voice: config.voice ?? null, turnDetection: config.turnDetection?.type ?? null, manual: context.turns === 'manual',
    });
  }

  private onMessage(data: unknown): void {
    if (this.phase === 'ended') return;
    let e: ServerEvent;
    try {
      e = decodeServerEvent(data);
    } catch (error) {
      this.unreadable('frame', error);
      return;
    }
    this.readable = true;
    // Each read through its SDK type: a field the SDK renames fails the typecheck.
    switch (e.type) {
      case 'session.created': return this.created(e as unknown as SessionCreatedEvent);
      case 'session.updated': return this.updated(e as unknown as SessionUpdatedEvent);
      case 'error': return this.serverError((e as unknown as Partial<RealtimeErrorEvent>).error ?? {});
      case 'input_audio_buffer.committed': return this.committed(e as unknown as InputAudioBufferCommittedEvent);
      case 'input_audio_buffer.speech_started': {
        const s = e as unknown as InputAudioBufferSpeechStartedEvent;
        return this.frame('in', e.type, { itemId: s.item_id ?? null, audioStartMs: s.audio_start_ms ?? null });
      }
      case 'input_audio_buffer.speech_stopped': {
        const s = e as unknown as InputAudioBufferSpeechStoppedEvent;
        return this.frame('in', e.type, { itemId: s.item_id ?? null, audioEndMs: s.audio_end_ms ?? null });
      }
      case 'input_audio_buffer.cleared': return this.frame('in', e.type);
      case 'conversation.item.added': return this.itemAdded(e as unknown as ConversationItemAdded);
      case 'conversation.item.input_audio_transcription.delta': return this.inputDelta(e as unknown as ConversationItemInputAudioTranscriptionDeltaEvent);
      case 'conversation.item.input_audio_transcription.completed': return this.inputDone(e as unknown as ConversationItemInputAudioTranscriptionCompletedEvent);
      case 'conversation.item.input_audio_transcription.failed': return this.inputFailed(e as unknown as ConversationItemInputAudioTranscriptionFailedEvent);
      case 'response.created': return this.responseCreated(e as unknown as ResponseCreatedEvent);
      case 'response.output_item.added': return this.outputAdded(e as unknown as ResponseOutputItemAddedEvent);
      case 'response.output_audio_transcript.delta':
      case 'response.output_text.delta': return this.outputDelta(e as unknown as ResponseAudioTranscriptDeltaEvent | ResponseTextDeltaEvent);
      case 'response.output_audio_transcript.done': {
        const d = e as unknown as ResponseAudioTranscriptDoneEvent;
        return this.outputDone(d, d.transcript);
      }
      case 'response.output_text.done': {
        const d = e as unknown as ResponseTextDoneEvent;
        return this.outputDone(d, d.text);
      }
      case 'response.output_audio.delta': return this.audioDelta(e as unknown as ResponseAudioDeltaEvent);
      case 'response.output_audio.done': {
        const d = e as unknown as ResponseAudioDoneEvent;
        return this.frame('in', e.type, { responseId: d.response_id ?? null, itemId: d.item_id ?? null });
      }
      case 'response.output_item.done': return this.outputItemDone(e as unknown as ResponseOutputItemDoneEvent);
      case 'response.done': return this.responseDone(e as unknown as ResponseDoneEvent);
      case 'rate_limits.updated': return this.frame('in', e.type, { rateLimits: (e as unknown as RateLimitsUpdatedEvent).rate_limits ?? null });
      default:
        if (QUIET.has(e.type)) this.frame('in', e.type);
        else this.frame('in', 'session.unknown', { type: e.type });
    }
  }

  /** The server's session: framed with its defaults and its expiry, then the configuration goes up (ruling 22). */
  private created(e: SessionCreatedEvent): void {
    const s = (e.session ?? {}) as { id?: unknown; model?: unknown; expires_at?: unknown };
    this.frame('in', 'session.created', { id: s.id ?? null, model: s.model ?? null, expiresAt: s.expires_at ?? null });
    if (this.phase !== 'opening') return;
    const update = sessionUpdate(this.request.config);
    if (this.send(JSON.stringify(update))) this.frame('out', 'session.update', update.session);
    this.phase = 'configuring';
  }

  /** The configuration confirmed: the start resolves (ruling 22), and the first anchor goes up (ruling 2). */
  private updated(e: SessionUpdatedEvent): void {
    const s = (e.session ?? {}) as { output_modalities?: unknown; audio?: unknown; reasoning?: unknown; max_output_tokens?: unknown };
    // What the server confirmed, for the live test's reading of the hints (survey §2.16 item 3); never the instructions, which the out frame carries.
    this.frame('in', 'session.updated', { outputModalities: s.output_modalities ?? null, audio: s.audio ?? null, reasoning: s.reasoning ?? null, maxOutputTokens: s.max_output_tokens ?? null });
    if (this.phase !== 'configuring') return;
    this.phase = 'live';
    const settle = this.settle;
    this.settle = null;
    settle?.resolve();
    this.anchor();
  }

  /** Before the start, a refusal in OpenAI's words; mid-session a Logs line, kept for the close that may follow (ruling 13), and perhaps the refusal of a request asked (choice 10) — or, the 60-minute cap, the run's end. */
  private serverError(error: Partial<RealtimeError>): void {
    this.frame('in', 'session.error', { type: error.type ?? null, code: error.code ?? null, message: error.message ?? null, param: error.param ?? null, eventId: error.event_id ?? null });
    const refusal = { code: errorCode(error), message: errorWords(error) };
    if (this.phase !== 'live') {
      this.refuse(new AdapterStartError(refusal.message, refusal.code));
      return;
    }
    // The 60-minute cap ends the run at once, in its words, whether or not the server closes the socket after it (ruling 14; choice 14).
    if (refusal.code === 'segment_ended') {
      this.end({ failed: refusal });
      return;
    }
    // A request refused because a response was active is asked again (choice 10): routine, never the words of a close that follows (ruling 13).
    if (error.code !== ACTIVE_RESPONSE) this.lastError = { ...refusal, at: this.request.clock.now() };
    this.queue.refused(error.event_id, error.code);
  }

  private committed(e: InputAudioBufferCommittedEvent): void {
    this.frame('in', e.type, { itemId: e.item_id ?? null, previousItemId: e.previous_item_id ?? null });
    if (this.phase === 'live' && typeof e.item_id === 'string') this.items.committed(e.item_id);
  }

  private itemAdded(e: ConversationItemAdded): void {
    const { id, role } = itemOf(e.item);
    this.frame('in', e.type, { itemId: id ?? null, role: role ?? null, previousItemId: e.previous_item_id ?? null });
    if (this.phase !== 'live' || id === undefined) return;
    if (role === 'user') this.items.inputAdded(id);
    else if (role === 'assistant') this.items.assistantAdded(id, e.previous_item_id);
  }

  private inputDelta(e: ConversationItemInputAudioTranscriptionDeltaEvent): void {
    this.frame('in', e.type, { itemId: e.item_id ?? null, delta: e.delta ?? null });
    if (this.phase === 'live' && typeof e.item_id === 'string' && typeof e.delta === 'string') this.items.inputDelta(e.item_id, e.delta);
  }

  private inputDone(e: ConversationItemInputAudioTranscriptionCompletedEvent): void {
    this.frame('in', e.type, { itemId: e.item_id ?? null, transcript: e.transcript ?? null });
    if (this.phase === 'live' && typeof e.item_id === 'string') this.items.inputDone(e.item_id, typeof e.transcript === 'string' ? e.transcript : '');
  }

  private inputFailed(e: ConversationItemInputAudioTranscriptionFailedEvent): void {
    const error = e.error ?? {};
    this.frame('in', e.type, { itemId: e.item_id ?? null, error: { type: error.type ?? null, code: error.code ?? null, message: error.message ?? null } });
    if (this.phase === 'live' && typeof e.item_id === 'string') this.items.inputFailed(e.item_id);
  }

  /** A response began: in band it is `busy`, and the queue's; out of band — the anchor's — neither (ruling 2). */
  private responseCreated(e: ResponseCreatedEvent): void {
    const id = e.response?.id;
    const outOfBand = isOutOfBand(e.response);
    this.frame('in', e.type, { responseId: id ?? null, outOfBand });
    if (this.phase !== 'live' || typeof id !== 'string') return;
    this.items.responseCreated(id, outOfBand);
    if (outOfBand) return;
    this.queue.created(id, requestOf(e.response));
    if (!this.producing) {
      this.producing = true;
      this.events.busy(true);
    }
  }

  private outputAdded(e: ResponseOutputItemAddedEvent): void {
    const { id, role } = itemOf(e.item);
    this.frame('in', e.type, { responseId: e.response_id ?? null, itemId: id ?? null, role: role ?? null });
    if (this.phase === 'live' && id !== undefined && typeof e.response_id === 'string') this.items.outputAdded(id, e.response_id);
  }

  private outputDelta(e: ResponseAudioTranscriptDeltaEvent | ResponseTextDeltaEvent): void {
    this.frame('in', e.type, { responseId: e.response_id ?? null, itemId: e.item_id ?? null, delta: e.delta ?? null });
    if (this.phase === 'live' && typeof e.item_id === 'string' && typeof e.response_id === 'string' && typeof e.delta === 'string') {
      this.items.outputDelta(e.item_id, e.response_id, e.delta);
    }
  }

  /** The final text, trimmed and unwrapped (choice 5): it settles the translation. */
  private outputDone(e: ResponseAudioTranscriptDoneEvent | ResponseTextDoneEvent, text: unknown): void {
    this.frame('in', e.type, { responseId: e.response_id ?? null, itemId: e.item_id ?? null, text: text ?? null });
    if (this.phase === 'live' && typeof e.item_id === 'string' && typeof e.response_id === 'string' && typeof text === 'string') {
      this.items.outputDone(e.item_id, e.response_id, unwrapTranslationText(text));
    }
  }

  /** Output audio: framed by its size, never its content; played on a leg that speaks, ranged by arrival (ruling 3). */
  private audioDelta(e: ResponseAudioDeltaEvent): void {
    if (this.phase !== 'live') return;
    // No base64 string where the audio should be: the same episode as audio that will not decode (choice 15), in fixed words that quote nothing of the frame.
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
    this.frame('in', e.type, { responseId: e.response_id ?? null, itemId: e.item_id ?? null, samples: pcm.length });
    // A leg that does not speak asked for text alone; audio it gets anyway is not played.
    if (this.request.context.speech && typeof e.item_id === 'string' && typeof e.response_id === 'string') this.items.audio(e.item_id, e.response_id, pcm);
  }

  private outputItemDone(e: ResponseOutputItemDoneEvent): void {
    const { id } = itemOf(e.item);
    this.frame('in', e.type, { responseId: e.response_id ?? null, itemId: id ?? null });
    if (this.phase === 'live' && id !== undefined) this.items.itemDone(id);
  }

  /**
   * A response ended, whatever its status: its translations close. In band,
   * `busy` ends, the next request goes up, and a completed one counts
   * toward the anchor (ruling 2). Framed with its usage — the anchor's too,
   * which is its cost (survey §1.13).
   */
  private responseDone(e: ResponseDoneEvent): void {
    const r = e.response;
    const id = r?.id;
    const outOfBand = isOutOfBand(r);
    this.frame('in', e.type, { responseId: id ?? null, status: r?.status ?? null, statusDetails: r?.status_details ?? null, outOfBand, usage: r?.usage ?? null });
    if (this.phase !== 'live' || typeof id !== 'string') return;
    this.items.responseDone(id);
    if (outOfBand) return;
    if (this.producing) {
      this.producing = false;
      this.events.busy(false);
    }
    if (r?.status === 'completed') this.completed += 1;
    this.queue.done(id);
    if (this.completed > 0 && this.completed % ANCHOR_EVERY === 0) this.anchor();
  }

  /**
   * The drift anchor (ruling 2; choice 11): this leg's instructions again,
   * out of band and as text, at the start and after every fifth completed
   * translation — once per count, never on a closed socket. It is no
   * request of the queue's: nothing waits for it, and it waits for nothing.
   */
  private anchor(): void {
    if (this.phase !== 'live' || this.anchoredAt === this.completed) return;
    this.anchoredAt = this.completed;
    const eventId = `sokuji_${++this.ids}`;
    if (!this.send(JSON.stringify(anchorResponse(eventId, this.request.config.instructions)))) return;
    this.frame('out', 'response.anchor', { eventId, translations: this.completed });
  }

  /**
   * A request the queue sends (ruling 8): a typed text's item first — once,
   * however often its response is asked — then its `response.create`. Each
   * is framed, and the item counted sent, only when it went up: an item
   * that did not asks no response. The releases merged into it — waiting
   * behind it, their commits in the conversation already, so its response
   * answers them too — are framed as its `merged` count.
   */
  private ask(asked: Request, eventId: string, waitedMs: number, merged: number): void {
    if (asked.kind === 'text' && !this.itemsSent.has(asked.itemId)) {
      if (!this.send(JSON.stringify(textItem(asked.itemId, asked.text)))) return;
      this.itemsSent.add(asked.itemId);
      this.frame('out', 'conversation.item.create', { itemId: asked.itemId, length: asked.text.length });
    }
    if (this.send(JSON.stringify(responseCreate(eventId)))) {
      this.frame('out', 'response.create', { eventId, for: asked.kind, waitedMs, ...(merged > 0 ? { merged } : {}) });
    }
  }

  /** A frame, or an audio delta, that will not read: a Logs line and `parse_error` on each latch's ok → failing transition only (choice 15). */
  private unreadable(latch: 'frame' | 'audio', error: unknown): void {
    if (latch === 'frame' ? !this.readable : !this.audioReadable) return;
    if (latch === 'frame') this.readable = false;
    else this.audioReadable = false;
    this.frame('in', 'session.unreadable', { message: describeCause(error) });
    if (this.phase === 'live') this.events.degraded({ code: 'parse_error', message: `A message from OpenAI could not be read: ${describeCause(error)}`, cause: error });
  }

  /** The last mid-session error, when the close follows it within `ERROR_WORDS_MS` (ruling 13); a negative age — a wall clock stepped back — is not recent either. */
  private recentError(): { code: string; message: string } | null {
    const last = this.lastError;
    if (!last) return null;
    const age = this.request.clock.now() - last.at;
    if (age < 0 || age > ERROR_WORDS_MS) return null;
    return { code: last.code, message: last.message };
  }

  /** What goes up, when the socket is open; nothing on a closed one. True when it went up: only what went up is framed. */
  private send(data: string): boolean {
    if (this.socket.readyState !== WS_OPEN) return false;
    this.socket.send(data);
    return true;
  }

  private onClose(e: CloseEvent): void {
    if (this.phase === 'ended') return;
    this.frame('in', 'session.connection_lost', { code: e.code, reason: e.reason });
    if (this.phase !== 'live') {
      this.refuse(this.opened
        ? new AdapterStartError(`OpenAI closed the connection before the session started (${closeWords(e)}).`, 'server')
        : new AdapterStartError(NEVER_OPENED, 'network'));
      return;
    }
    // A close right after a mid-session error reads as that error — a key revoked, a quota spent; any other as the lost connection (ruling 14). The 60-minute cap has ended the run already.
    this.end({ failed: this.recentError() ?? { code: 'connection_lost', message: `The connection to OpenAI closed (${closeWords(e)}).` } });
  }

  /** A start that will not resolve: rejected once, the socket closed, nothing emitted but frames. */
  private refuse(error: unknown): void {
    if (this.phase === 'live' || this.phase === 'ended') return;
    this.shutDown();
    const settle = this.settle;
    this.settle = null;
    settle?.reject(error);
  }

  /** A session that ends by itself: said once, then nothing (the kit's `ended-silence`). */
  private end(how: { failed: { code: string; message: string } }): void {
    if (this.phase !== 'live') return;
    this.shutDown();
    this.events.failed(how.failed);
  }

  /** Every way a leg ends: nothing waits or goes up, the socket is closed and no longer heard. */
  private shutDown(): void {
    this.phase = 'ended';
    this.queue.stop();
    this.items.stop();
    const socket = this.socket;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState <= WS_OPEN) socket.close(1000);
  }

  private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
    if (this.phase === 'ended') return;
    this.events.frame(payload === undefined ? { direction, type } : { direction, type, payload: framePayload(payload) });
  }
}

export function createRealtimeAdapter(deps: Partial<RealtimeAdapterDeps> = {}): Adapter<RealtimeConfig, RealtimeCredentials> {
  const openSocket = deps.openSocket ?? nativeSocket;
  return {
    start(request, events) {
      // An aborted start opens nothing.
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('aborted'));
      try {
        return new RealtimeLeg(request, events, openSocket).opening;
      } catch (error) {
        // A start rejects, never throws: the socket's refusal already in fixed words, any other failure as it was thrown.
        return Promise.reject(error);
      }
    },
  };
}
