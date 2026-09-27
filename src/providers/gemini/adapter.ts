/**
 * Gemini on the new contract (spec: "L0 — the client contract"), ported
 * from `GeminiClient` (`src/services/clients/GeminiClient.ts`, still
 * compiled and unreachable) without its SDK session, its items or its
 * display bookkeeping: one leg, one Live connection over `wire.ts`, the
 * server's content through `GeminiTurns` to segments. A lost connection is
 * resumed with the server's handle, or opened fresh when it issued none
 * (ruling 3). A start resolves once the server answers the setup, so a
 * refused key or model rejects it in words and within a bound (choice 12).
 * Every timer reads the request's clock, and nothing is said but through
 * events (CLAUDE.md, "Inside an IClient session").
 */
import type { Part } from '@google/genai';
import {
  AdapterStartError,
  SAMPLE_RATE,
  type Adapter,
  type AdapterEvents,
  type AdapterSession,
  type StartRequest,
} from '../../lib/contract/adapter';
import { framePayload } from '../../lib/contract/framePayload';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { GeminiConfig } from './config';
import type { GeminiCredentials } from './settings';
import { nativeSocket, WS_OPEN, type OpenSocket } from './socket';
import { GeminiTurns } from './turns';
import {
  ACTIVITY_END,
  ACTIVITY_START,
  audioFrame,
  base64ToPcm,
  closeFailureCode,
  decodeServerMessage,
  liveUrl,
  pcmRate,
  setupFrame,
  textFrame,
  type GeminiServerMessage,
} from './wire';

/** A connection whose setup is not answered within this is refused: the old connects could hang (survey §1.16.1). */
export const SETUP_TIMEOUT_MS = 15_000;
/** The old ladder (`GeminiClient.ts:1458-1583`): at once, after 2 s, after 3 s. */
export const RECONNECT_DELAYS_MS: readonly number[] = [0, 2_000, 3_000];

export interface GeminiAdapterDeps {
  /** `new WebSocket(url)` in the app; a `FakeSocket` factory in tests. */
  openSocket: OpenSocket;
}

type GeminiRequest = StartRequest<GeminiConfig, GeminiCredentials>;
type ServerContent = NonNullable<GeminiServerMessage['serverContent']>;
type Transcription = NonNullable<ServerContent['inputTranscription']>;

/** Hears nothing more from a socket the session has moved on from. */
function detach(ws: WebSocket): void {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
}

/** A transcription as the Logs show it; its language is framed, never forwarded (choice 19). */
function transcriptionFrame(t: Transcription): Record<string, unknown> {
  return {
    text: t.text,
    ...(t.finished !== undefined ? { finished: t.finished } : {}),
    ...(t.languageCode ? { languageCode: t.languageCode } : {}),
  };
}

class GeminiSession {
  private ended = false;
  /** The connection in use: set up, and heard. Null before the setup is answered, and while a reconnect is under way. */
  private socket: WebSocket | null = null;
  /** Manual turns: a press is held. */
  private turnOpen = false;
  /** The last frame parsed: `server.unreadable` is said on the ok → failing transition only (as Soniox's `stt.unreadable`). */
  private readable = true;
  /**
   * The last model audio part decoded: its own episode, since every frame that parses re-arms `readable`. The
   * hot-path rule says a failure's ok → failing transition, never each occurrence, and audio parts come several
   * times a second.
   */
  private partsReadable = true;
  /** A foreign output rate is said once per session (choice 18). */
  private rateWarned = false;
  /** The last resumable handle the server issued: single-use (ruling 3). */
  private handle: string | null = null;
  /** A reconnect is under way: a second cause is the same reconnect. */
  private reconnecting = false;
  /** Every pending connection attempt and every backoff of the ladder, so a stop ends them at once. */
  private readonly cancels = new Set<() => void>();
  private readonly turns: GeminiTurns;

  constructor(private readonly request: GeminiRequest, private readonly events: AdapterEvents, private readonly openSocket: OpenSocket) {
    this.turns = new GeminiTurns({
      kind: request.config.kind,
      speech: request.context.speech,
      clock: request.clock,
      silence: request.config.silence,
      sink: events,
    });
  }

  /** Resolves once the server answers the setup; rejects, leaving nothing open, when it refuses, drops, does not answer in time, or the signal aborts. */
  async open(signal: AbortSignal): Promise<void> {
    try {
      await this.connect(null, signal);
    } catch (error) {
      this.shutdown();
      throw error;
    }
  }

  api(): AdapterSession {
    return {
      info: { transport: 'websocket' },
      // No frame per chunk (the hot-path rule). Audio while no connection is set up is dropped (parity).
      appendAudio: (pcm) => this.live()?.send(audioFrame(pcm)),
      appendText: (text) => this.appendText(text),
      beginTurn: () => this.beginTurn(),
      endTurn: () => this.endTurn(false),
      cancelTurn: () => this.endTurn(true),
      stop: () => {
        this.shutdown();
        return Promise.resolve();
      },
    };
  }

  /**
   * One connection: the socket, the setup, its answer. Resolves with the
   * connection adopted; rejects when the server closes it first, when
   * `SETUP_TIMEOUT_MS` passes, when the signal aborts or the session stops.
   */
  private connect(handle: string | null, signal: AbortSignal | null): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const { config, context, credentials, clock } = this.request;
      // Per socket: a new connection starts readable, whatever episode the one before it was in (as Soniox's resumed socket).
      this.readable = true;
      this.partsReadable = true;
      const ws = this.openSocket(liveUrl(credentials.apiKey));
      // Binary frames as ArrayBuffers, decoded at once and in order (survey §1.16.4).
      ws.binaryType = 'arraybuffer';
      let opened = false;
      let settled = false;
      const settle = (error?: unknown) => {
        if (settled) return;
        settled = true;
        cancelTimeout();
        this.cancels.delete(onStop);
        signal?.removeEventListener('abort', onAbort);
        if (error === undefined) {
          resolve();
          return;
        }
        detach(ws);
        ws.close();
        reject(error);
      };
      const onAbort = () => settle(signal?.reason ?? new Error('aborted'));
      const onStop = () => settle(new Error('The session stopped.'));
      const cancelTimeout = clock.setTimeout(() => {
        const words = `Gemini did not answer the setup within ${SETUP_TIMEOUT_MS / 1000} s.`;
        settle(new AdapterStartError(words, opened ? 'server' : 'network', { detail: words }));
      }, SETUP_TIMEOUT_MS);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.cancels.add(onStop);

      ws.onopen = () => {
        opened = true;
        this.frame('out', 'session.opened', { model: config.model, kind: config.kind, speaking: context.speech, manual: config.activity.manual, resumed: handle !== null });
        ws.send(JSON.stringify(setupFrame(config, handle)));
      };
      ws.onmessage = (event: MessageEvent) => {
        let message: GeminiServerMessage;
        try {
          message = decodeServerMessage(event.data);
        } catch (error) {
          this.unreadable(error);
          return;
        }
        this.readable = true;
        if (!settled) {
          // Nothing but the setup's answer is expected before it.
          if (!message.setupComplete) return;
          this.frame('in', 'server.setup_complete', message.setupComplete);
          this.socket = ws;
          settle();
          return;
        }
        if (ws === this.socket) this.onMessage(message);
      };
      // An error event carries nothing, and a close follows it: a Logs line, never a failure (survey §1.16.7).
      ws.onerror = () => this.frame('in', 'session.error');
      ws.onclose = (event: CloseEvent) => {
        if (!settled) {
          const words = `[Gemini ${event.code}] ${event.reason || 'the connection closed before the setup was answered'}`;
          settle(new AdapterStartError(words, closeFailureCode(event.code, event.reason), { detail: words }));
          return;
        }
        if (ws === this.socket) this.lost(event.code, event.reason);
      };
    });
  }

  /** The connection when it is set up; null otherwise. */
  private live(): WebSocket | null {
    const ws = this.socket;
    return !this.ended && ws !== null && ws.readyState === WS_OPEN ? ws : null;
  }

  private onMessage(m: GeminiServerMessage): void {
    if (this.ended) return;
    if (m.usageMetadata) this.frame('in', 'server.usage_metadata', m.usageMetadata);
    // No tool is declared, so none is expected: a call is logged and left unanswered (parity).
    if (m.toolCall) this.frame('in', 'server.tool_call');
    if (m.toolCallCancellation) this.frame('in', 'server.tool_call_cancellation');
    const update = m.sessionResumptionUpdate;
    if (update) {
      // Only a resumable update carries a handle worth keeping; `resumable` is false while the model generates.
      if (update.resumable && update.newHandle) this.handle = update.newHandle;
      this.frame('in', 'server.session_resumption_update', { resumable: update.resumable === true, hasHandle: Boolean(update.newHandle) });
    }
    if (m.serverContent) this.onContent(m.serverContent);
    if (m.goAway) {
      this.frame('in', 'server.go_away', m.goAway.timeLeft ? { timeLeft: m.goAway.timeLeft } : {});
      this.reconnect({ cause: 'go_away' });
    }
  }

  /** The content first, then its closure: a `turnComplete` may ride with its turn's last content (choice 15). */
  private onContent(c: ServerContent): void {
    if (c.groundingMetadata) this.frame('in', 'server_content.grounding_metadata');
    const input = c.inputTranscription;
    if (input?.text) {
      this.frame('in', 'server_content.input_transcription', transcriptionFrame(input));
      this.turns.input(input.text);
    }
    const output = c.outputTranscription;
    if (output?.text) {
      this.frame('in', 'server_content.output_transcription', transcriptionFrame(output));
      this.turns.output(output.text);
    }
    if (c.modelTurn?.parts) this.onModelTurn(c.modelTurn.parts);
    if (c.generationComplete) this.frame('in', 'server_content.generation_complete');
    if (c.interrupted) {
      this.frame('in', 'server_content.interrupted');
      this.turns.interrupted();
    }
    if (c.turnComplete) {
      this.frame('in', 'server_content.turn_complete', c.turnCompleteReason ? { reason: c.turnCompleteReason } : {});
      this.turns.turnComplete();
    }
  }

  private onModelTurn(parts: readonly Part[]): void {
    let audioBytes = 0;
    let mimeType: string | undefined;
    let text = '';
    const playable: Int16Array[] = [];
    for (const part of parts) {
      const inline = part.inlineData;
      // Only pcm is speech; any other inline data is not this app's to decode, play or count (parity, `GeminiClient.ts:1273-1275`).
      if (inline?.data && inline.mimeType?.startsWith('audio/pcm')) {
        mimeType = inline.mimeType;
        let pcm: Int16Array;
        try {
          pcm = base64ToPcm(inline.data);
        } catch (error) {
          // Thrown inside the socket's callback it would escape it: said as unreadable, the part skipped, the rest of the message still handled.
          this.undecodable(error);
          continue;
        }
        this.partsReadable = true;
        audioBytes += pcm.byteLength;
        const rate = pcmRate(mimeType);
        if (rate === SAMPLE_RATE) playable.push(pcm);
        else this.foreignRate(rate);
      } else if (part.text && !part.thought) {
        // A thought is the model's reasoning, never its answer (survey §1.16.14).
        text += part.text;
      }
    }
    this.frame('in', 'server_content.model_turn', { audioBytes, ...(mimeType ? { mimeType } : {}), ...(text ? { text } : {}) });
    for (const pcm of playable) this.turns.audio(pcm);
    if (text) this.turns.modelText(text);
  }

  /** Audio at a rate this app does not play is skipped; a speaking leg says so once (choice 18). */
  private foreignRate(rate: number): void {
    if (this.rateWarned || !this.request.context.speech) return;
    this.rateWarned = true;
    this.events.degraded({
      code: 'tts_degraded',
      message: `Gemini sent its speech at ${rate} Hz, which this app does not play: it is skipped.`,
      reason: `audio_rate_${rate}`,
    });
  }

  /** A frame that will not parse: a Logs line on the ok → failing transition, never a notice. */
  private unreadable(error: unknown): void {
    if (!this.readable) return;
    this.readable = false;
    this.frame('in', 'server.unreadable', { message: describeCause(error) });
  }

  /** A model audio part that will not decode: the same Logs line, on its own ok → failing transition, until a part decodes again. */
  private undecodable(error: unknown): void {
    if (!this.partsReadable) return;
    this.partsReadable = false;
    this.frame('in', 'server.unreadable', { message: describeCause(error) });
  }

  private beginTurn(): void {
    if (this.ended || !this.request.config.activity.manual || this.turnOpen) return;
    this.turnOpen = true;
    this.turns.beginTurn();
    const ws = this.live();
    if (!ws) return;
    ws.send(ACTIVITY_START);
    this.frame('out', 'realtime_input.activity_start');
  }

  /**
   * A release: `activityEnd`, and the press's answer is owed from here, before its first output streams. A cancel
   * instead has `GeminiTurns` drop the cancelled press's own answer — never the one owed or still streaming, and
   * nothing on Live Translate (ruling 8, choice 16).
   */
  private endTurn(cancelled: boolean): void {
    if (this.ended || !this.request.config.activity.manual || !this.turnOpen) return;
    this.turnOpen = false;
    if (cancelled) this.turns.cancelTurn();
    else this.turns.endTurn();
    const ws = this.live();
    if (!ws) return;
    ws.send(ACTIVITY_END);
    this.frame('out', 'realtime_input.activity_end', cancelled ? { cancelled: true } : undefined);
  }

  /** Typed text (choice 17): its own source segment, then `realtimeInput.text`; wrapped in activity marks under manual turns with no press held. */
  private appendText(raw: string): void {
    const text = raw.trim();
    const ws = this.live();
    if (!text || !ws) return;
    this.turns.typed(text);
    const wrap = this.request.config.activity.manual && !this.turnOpen;
    if (wrap) {
      ws.send(ACTIVITY_START);
      this.frame('out', 'realtime_input.activity_start');
    }
    ws.send(textFrame(text));
    this.frame('out', 'realtime_input.text', { length: text.length });
    if (wrap) {
      ws.send(ACTIVITY_END);
      this.frame('out', 'realtime_input.activity_end');
    }
  }

  /** An unexpected close after the setup: every one tries the ladder (ruling 3, parity). */
  private lost(code: number, reason: string): void {
    this.reconnect({ cause: 'close', code, reason });
  }

  /**
   * Break before make (parity, `GeminiClient.ts:1489-1495`): the old socket
   * closes, what a dialogue turn opened closes as it stands, then the
   * attempts. Audio sent in the gap is dropped (`appendAudio` needs a
   * connection).
   */
  private reconnect(why: { cause: 'close' | 'go_away'; code?: number; reason?: string }): void {
    if (this.ended || this.reconnecting) return;
    this.reconnecting = true;
    const old = this.socket;
    this.socket = null;
    if (old) {
      detach(old);
      old.close(1000);
    }
    this.frame('in', 'session.reconnecting', {
      cause: why.cause,
      ...(why.code !== undefined ? { code: why.code } : {}),
      ...(why.reason ? { reason: why.reason } : {}),
      hasHandle: this.handle !== null,
    });
    this.turns.connectionLost();
    this.events.reconnecting();
    void this.ladder();
  }

  /** Three attempts, each bounded by `SETUP_TIMEOUT_MS`: the handle when one is held, else a fresh session (ruling 3). */
  private async ladder(): Promise<void> {
    for (let attempt = 1; attempt <= RECONNECT_DELAYS_MS.length; attempt++) {
      const delay = RECONNECT_DELAYS_MS[attempt - 1];
      // At once is at once: no zero timer, which a virtual clock fires only when advanced.
      if (delay > 0) await this.wait(delay);
      if (this.ended) return;
      const handle = this.handle;
      try {
        await this.connect(handle, null);
      } catch (error) {
        if (this.ended) return;
        // A failed resume keeps its handle for the next attempt (parity).
        this.frame('in', 'session.reconnect_failed', { attempt, maxRetries: RECONNECT_DELAYS_MS.length, message: describeCause(error) });
        continue;
      }
      if (this.ended) return;
      // Single-use: dropped, unless the new session has already issued another.
      if (handle !== null && this.handle === handle) this.handle = null;
      this.reconnecting = false;
      // A press held across the gap starts again on the new connection (choice 14).
      const ws = this.live();
      if (this.turnOpen && ws) {
        ws.send(ACTIVITY_START);
        this.frame('out', 'realtime_input.activity_start');
      }
      this.events.reconnected();
      return;
    }
    this.frame('in', 'session.connection_lost', { attempts: RECONNECT_DELAYS_MS.length });
    this.fail('connection_lost', 'The Gemini connection was lost and could not be restored.');
  }

  /** Resolves after `ms` on the request's clock, or at once when the session ends. */
  private wait(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const cancelTimer = this.request.clock.setTimeout(() => {
        this.cancels.delete(onStop);
        resolve();
      }, ms);
      const onStop = () => {
        cancelTimer();
        resolve();
      };
      this.cancels.add(onStop);
    });
  }

  private fail(code: string, message: string): void {
    if (this.ended) return;
    this.events.failed({ code, message });
    this.shutdown();
  }

  /** Closes the socket before it returns (the `stop()` rule), ends every attempt and wait; idempotent. */
  private shutdown(): void {
    if (this.ended) return;
    this.ended = true;
    for (const cancel of [...this.cancels]) cancel();
    this.cancels.clear();
    this.turns.stop();
    const ws = this.socket;
    this.socket = null;
    if (ws) {
      detach(ws);
      ws.close(1000);
    }
  }

  private frame(direction: 'in' | 'out', type: string, payload?: unknown): void {
    if (!this.ended) this.events.frame({ direction, type, ...(payload === undefined ? {} : { payload: framePayload(payload) }) });
  }
}

export function createGeminiAdapter(deps: Partial<GeminiAdapterDeps> = {}): Adapter<GeminiConfig, GeminiCredentials> {
  const openSocket = deps.openSocket ?? nativeSocket;
  return {
    async start(request, events) {
      if (request.signal.aborted) throw request.signal.reason ?? new Error('aborted');
      const session = new GeminiSession(request, events, openSocket);
      await session.open(request.signal);
      return session.api();
    },
  };
}
