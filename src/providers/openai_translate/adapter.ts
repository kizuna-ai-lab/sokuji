/**
 * OpenAI Translate on the new contract (spec: "L0 — the client contract"),
 * ported from `OpenAITranslateGAClient` (`src/services/clients/`, deleted
 * since) without its items,
 * ids, karaoke bookkeeping or segmentation stage: one leg, one WebSocket to
 * the translations endpoint, the key in a subprotocol (choice 3). The start
 * resolves on `session.updated`, the configuration confirmed, so a refused
 * one rejects in words within a bound (choices 1, 2). Deltas become segments
 * (`segments.ts`), the translation cut where the source was and stating it as
 * its origin (Stage 2 translation cuts, rulings 1, 2); a push-to-talk release
 * sends a real-time silence tail
 * (`tail.ts`, ruling 2). Every timer reads the request's clock, and nothing
 * is said but through events (CLAUDE.md, "Inside an adapter session").
 */
import type {
  RealtimeError,
  RealtimeErrorEvent,
  RealtimeTranslationInputTranscriptDeltaEvent,
  RealtimeTranslationOutputAudioDeltaEvent,
  RealtimeTranslationOutputTranscriptDeltaEvent,
  RealtimeTranslationSessionCreatedEvent,
  RealtimeTranslationSessionUpdatedEvent,
} from 'openai/resources/realtime/realtime';
import {
  AdapterStartError,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type StartRequest,
} from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { TranslateConfig } from './config';
import { TranslateSegments } from './segments';
import type { TranslateCredentials } from './settings';
import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
import { ReleaseTail, type TailSummary } from './tail';
import {
  appendFrame,
  base64ToPcm,
  computeRms,
  decodeServerEvent,
  elapsedMsOf,
  errorCode,
  errorWords,
  isSilentFrame,
  OUTPUT_RATE,
  SESSION_CLOSE,
  sessionUpdate,
  translateProtocols,
  translateUrl,
  type ServerEvent,
} from './wire';

/** The old client's bound on the start (`OpenAITranslateGAClient.ts:771`), now on the request's clock, and closing the socket (choice 2). */
export const START_TIMEOUT_MS = 30_000;
/** A socket that failed before it opened: a browser cannot read why (choice 2). */
export const NEVER_OPENED = "OpenAI's socket did not open (check the network, and that the API key is still valid).";
/**
 * How long a mid-session `error` words the close that follows it (ruling 3;
 * choice 9): a close later than this is the connection's own, not the
 * error's. A starting value the live test's `session.error` frames settle.
 */
export const ERROR_WORDS_MS = 10_000;

export interface TranslateAdapterDeps {
  /** `new WebSocket(url, protocols)` in the app; a `FakeSocket` factory in tests. */
  openSocket: OpenSocket;
}

type Side = 'source' | 'translation';

const closeWords = (e: CloseEvent) => `${e.code}${e.reason ? ` ${e.reason}` : ''}`;

/** A thrown value's name alone (`SyntaxError`, `SecurityError`), never its message: a browser that refuses a subprotocol quotes it, the key in it. */
function errorName(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name !== '' ? name : 'unknown error';
}

class TranslateLeg implements AdapterSession {
  readonly info: { transport: string };
  readonly opening: Promise<AdapterSession>;
  /** `opening` until the server's session exists; `configuring` once `session.update` went out; `live` once the server confirmed it. */
  private phase: 'opening' | 'configuring' | 'live' | 'ended' = 'opening';
  private opened = false;
  private readonly socket: WebSocket;
  private readonly segments: TranslateSegments;
  private readonly tail: ReleaseTail;
  /** Samples sent this session: the server frames them on a 200 ms grid (the tail's pad). */
  private sent = 0;
  /** The last frame parsed: `session.unreadable` on the ok → failing transition only (choice 17). */
  private readable = true;
  /** The last output audio decoded: its own episode, since every frame that parses re-arms `readable` (Gemini's `partsReadable`). */
  private audioReadable = true;
  /** A foreign output rate is said once per session (choice 16). */
  private rateWarned = false;
  /** The last `error` event mid-session, and when: the words of a close that follows it closely (ruling 3; choice 9). */
  private lastError: { code: string; message: string; at: number } | null = null;
  private settle: { resolve(): void; reject(error: unknown): void } | null = null;

  constructor(
    private readonly request: StartRequest<TranslateConfig, TranslateCredentials>,
    private readonly events: AdapterEvents,
    openSocket: OpenSocket,
  ) {
    const { config, clock, signal } = request;
    // WebSocket only (2026-09-29): every config says `websocket`.
    this.info = { transport: config.transport };
    this.segments = new TranslateSegments({
      clock,
      silence: config.silence,
      sink: events,
      // Each translation cut and why, for the live test (Stage 2 translation cuts, choice 14).
      cut: (summary) => this.frame('out', 'translation.cut', summary),
    });
    this.tail = new ReleaseTail({ clock, send: (pcm) => this.send(pcm), ended: (summary) => this.tailEnded(summary) });
    this.socket = openSocket(translateUrl(config), translateProtocols(request.credentials));
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

  /** One chunk as it came — no pacing, no resampling (parity) — and no frame per chunk (the hot-path rule). Real audio ends a release's tail first. */
  appendAudio(pcm: Int16Array): void {
    if (this.phase !== 'live') return;
    this.tail.stop('audio');
    this.send(pcm);
  }

  /** OpenAI Translate takes no typed text (`textInput: false`). */
  appendText(): void {}

  /** A press: a release's tail still running ends at once (ruling 2). Nothing is sent: the endpoint has no turns. */
  beginTurn(): void {
    if (this.phase === 'live') this.tail.stop('press');
  }

  /** A release with speech: the tail (ruling 2). */
  endTurn(): void {
    this.release(false);
  }

  /** A release without speech: the same tail — what the press appended is already the model's input, and no clear exists (choice 7). */
  cancelTurn(): void {
    this.release(true);
  }

  /**
   * `session.close`, framed, then the close before its first `await`. Its
   * flush and the server's `session.closed` are not waited for: they land on
   * a socket already closed, so a tail at Stop is still dropped (parity;
   * Stage 2 session end, ruling 2 (iii)).
   */
  stop(): Promise<void> {
    if (this.phase === 'live' && this.socket.readyState === WS_OPEN) {
      this.socket.send(JSON.stringify(SESSION_CLOSE));
      this.frame('out', 'session.close');
    }
    this.shutDown();
    return Promise.resolve();
  }

  private onOpen(): void {
    if (this.phase !== 'opening') return;
    this.opened = true;
    const { config, context } = this.request;
    // Never the protocols: the second carries the key.
    this.frame('out', 'session.opened', {
      model: config.model, target: config.target, transcriptModel: config.transcriptModel, noiseReduction: config.noiseReduction,
      speaking: context.speech, manual: context.turns === 'manual',
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
      case 'session.created':
        this.created(e as unknown as RealtimeTranslationSessionCreatedEvent);
        return;
      case 'session.updated':
        this.updated(e as unknown as RealtimeTranslationSessionUpdatedEvent);
        return;
      case 'error':
        this.serverError((e as unknown as Partial<RealtimeErrorEvent>).error ?? {});
        return;
      case 'session.closed':
        this.serverClosed();
        return;
      case 'session.input_transcript.delta':
        this.inputDelta(e as unknown as RealtimeTranslationInputTranscriptDeltaEvent);
        return;
      case 'session.output_transcript.delta':
        this.outputDelta(e as unknown as RealtimeTranslationOutputTranscriptDeltaEvent);
        return;
      case 'session.output_audio.delta':
        this.audioDelta(e as unknown as RealtimeTranslationOutputAudioDeltaEvent);
        return;
      // Not in the SDK's union: the old client closed its items on them (choice 18).
      case 'session.input_transcript.done':
        this.done('source', e.type);
        return;
      case 'session.output_transcript.done':
      case 'session.output_audio.done':
        this.done('translation', e.type);
        return;
      default:
        this.frame('in', 'session.unknown', { type: e.type });
    }
  }

  /** The server's session: framed with its defaults and its expiry (survey §2.14 item 3), then the configuration goes up. */
  private created(e: RealtimeTranslationSessionCreatedEvent): void {
    const s = e.session;
    this.frame('in', 'session.created', { id: s?.id ?? null, model: s?.model ?? null, expiresAt: s?.expires_at ?? null, audio: s?.audio ?? null });
    if (this.phase !== 'opening') return;
    const update = sessionUpdate(this.request.config);
    this.socket.send(JSON.stringify(update));
    this.frame('out', 'session.update', update.session);
    this.phase = 'configuring';
  }

  /** The configuration confirmed: the start resolves (choice 1). */
  private updated(e: RealtimeTranslationSessionUpdatedEvent): void {
    this.frame('in', 'session.updated', { audio: e.session?.audio ?? null });
    if (this.phase !== 'configuring') return;
    this.phase = 'live';
    const settle = this.settle;
    this.settle = null;
    settle?.resolve();
  }

  /** Before the start, a refusal in OpenAI's words; mid-session a Logs line, kept for the close that may follow (ruling 3). */
  private serverError(error: Partial<RealtimeError>): void {
    this.frame('in', 'session.error', { type: error.type ?? null, code: error.code ?? null, message: error.message ?? null, param: error.param ?? null });
    const refusal = { code: errorCode(error), message: errorWords(error) };
    if (this.phase === 'live') this.lastError = { ...refusal, at: this.request.clock.now() };
    else this.refuse(new AdapterStartError(refusal.message, refusal.code));
  }

  /** The server ended the session: in a recent error's words, else as a close — its expiry, perhaps (ruling 13); the socket's close after it unheard. */
  private serverClosed(): void {
    this.frame('in', 'session.closed');
    if (this.phase === 'live') {
      // The server's close right after an error is that error's (ruling 3); otherwise an expiry, perhaps (ruling 13).
      const cause = this.recentError();
      this.end(cause ? { failed: cause } : { reason: 'session.closed' });
    }
    else this.refuse(new AdapterStartError('OpenAI closed the session before it started.', 'server'));
  }

  private inputDelta(e: RealtimeTranslationInputTranscriptDeltaEvent): void {
    if (this.phase !== 'live') return;
    // Every delta framed with its elapsed_ms (ruling 6): the live test reads the timeline from these.
    this.frame('in', e.type, { delta: e.delta, elapsedMs: elapsedMsOf(e) });
    if (typeof e.delta === 'string') this.segments.input(e.delta);
  }

  private outputDelta(e: RealtimeTranslationOutputTranscriptDeltaEvent): void {
    if (this.phase !== 'live') return;
    this.frame('in', e.type, { delta: e.delta, elapsedMs: elapsedMsOf(e) });
    if (typeof e.delta !== 'string' || !e.delta) return;
    this.segments.output(e.delta);
    this.tail.output();
  }

  private audioDelta(e: RealtimeTranslationOutputAudioDeltaEvent): void {
    if (this.phase !== 'live') return;
    // No base64 string where the audio should be: the same episode as audio that will not decode (choice 17), in fixed words that quote nothing of the frame.
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
    // A heartbeat: no segment, no timer, no frame (parity, `OpenAITranslateGAClient.ts:542-556`).
    if (isSilentFrame(pcm)) return;
    const rate = typeof e.sample_rate === 'number' ? e.sample_rate : OUTPUT_RATE;
    this.frame('in', e.type, { samples: pcm.length, rms: Math.round(computeRms(pcm) * 10_000) / 10_000, elapsedMs: elapsedMsOf(e), sampleRate: rate });
    if (rate !== OUTPUT_RATE) this.foreignRate(rate);
    // Played only on a leg that speaks, at the contract's rate; above the noise floor it holds the translation either way (choices 5, 16; translation cuts, choice 11).
    this.segments.audio(pcm, this.request.context.speech && !this.request.config.transcribeOnly && rate === OUTPUT_RATE);
    this.tail.output();
  }

  private done(side: Side, type: string): void {
    if (this.phase !== 'live') return;
    this.frame('in', type);
    this.segments.done(side);
  }

  /** Audio at a rate this app does not play is skipped; a speaking leg says so once (choice 16). */
  private foreignRate(rate: number): void {
    if (this.rateWarned || !this.request.context.speech || this.request.config.transcribeOnly) return;
    this.rateWarned = true;
    this.events.degraded({
      code: 'tts_degraded',
      message: `OpenAI sent its speech at ${rate} Hz, which this app does not play: it is skipped.`,
      reason: `audio_rate_${rate}`,
    });
  }

  /** A frame, or an audio delta, that will not read: a Logs line and `parse_error` on each latch's ok → failing transition only (choice 17). */
  private unreadable(latch: 'frame' | 'audio', error: unknown): void {
    if (latch === 'frame' ? !this.readable : !this.audioReadable) return;
    if (latch === 'frame') this.readable = false;
    else this.audioReadable = false;
    this.frame('in', 'session.unreadable', { message: describeCause(error) });
    if (this.phase === 'live') this.events.degraded({ code: 'parse_error', message: `A message from OpenAI could not be read: ${describeCause(error)}`, cause: error });
  }

  /**
   * The last mid-session error, when the close follows it within
   * `ERROR_WORDS_MS` (ruling 3; choice 9). A negative age — the wall clock
   * stepped backwards after the error — is not recent either: it must not
   * revive a stale error's words for a close it never caused (the same
   * `Date.now()` failure class the tail's beat counting was amended to
   * remove; "Found during execution", item 1).
   */
  private recentError(): { code: string; message: string } | null {
    const last = this.lastError;
    if (!last) return null;
    const now = this.request.clock.now();
    const age = now - last.at;
    if (age < 0 || age > ERROR_WORDS_MS) return null;
    return { code: last.code, message: last.message };
  }

  private release(cancelled: boolean): void {
    if (this.phase !== 'live' || this.request.context.turns !== 'manual') return;
    const padSamples = this.tail.start(this.sent, cancelled);
    this.frame('out', 'turn.tail', { padSamples, ...(cancelled ? { cancelled: true } : {}) });
  }

  private tailEnded(summary: TailSummary): void {
    this.frame('out', 'turn.tail_end', summary);
  }

  private send(pcm: Int16Array): void {
    if (this.socket.readyState !== WS_OPEN) return;
    this.socket.send(appendFrame(pcm));
    this.sent += pcm.length;
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
    // A close right after a mid-session error reads as that error — a key revoked, a quota spent (ruling 3; choice 9); any other as the lost connection (ruling 13).
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
  private end(how: { failed: { code: string; message: string } } | { reason: string }): void {
    if (this.phase !== 'live') return;
    this.shutDown();
    if ('failed' in how) this.events.failed(how.failed);
    else this.events.closed({ reason: how.reason });
  }

  /** Every way a leg ends: no timer left, the tail silent, the socket closed and no longer heard. */
  private shutDown(): void {
    this.phase = 'ended';
    this.tail.cancel();
    this.segments.stop();
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

export function createTranslateAdapter(deps: Partial<TranslateAdapterDeps> = {}): Adapter<TranslateConfig, TranslateCredentials> {
  const openSocket = deps.openSocket ?? nativeSocket;
  return {
    start(request, events) {
      // An aborted start opens nothing.
      if (request.signal.aborted) return Promise.reject(request.signal.reason ?? new Error('aborted'));
      try {
        return new TranslateLeg(request, events, openSocket).opening;
      } catch (error) {
        // A start rejects, never throws. In fixed words and with no cause: a browser that refuses the socket quotes the subprotocols, the key among them.
        return Promise.reject(new AdapterStartError(`The browser would not open the socket (${errorName(error)}).`, 'network'));
      }
    },
  };
}
