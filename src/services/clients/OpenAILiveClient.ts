/**
 * OpenAILiveClient
 *
 * gpt-live-1 over the Live API's primary WebSocket, driven as a simultaneous
 * interpreter by the session instructions. A sibling of OpenAITranslateGAClient:
 * the same continuous no-turn-loop shape (transcript deltas on both sides,
 * real-time paced output audio, silence-timer segmentation) with a Live connect
 * head — the endpoint takes an `Authorization` header on the upgrade, which a
 * browser WebSocket cannot set, so the header is injected by the platform
 * (Electron `ws-headers-set`, extension declarativeNetRequest) before the socket
 * opens — and a `session.start` first frame instead of `session.update`.
 *
 * Design: docs/superpowers/specs/2026-09-12-openai-live-provider-design.md
 */
import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  OpenAILiveSessionConfig,
  ApiKeyValidationResult,
  FilteredModel,
  ResponseConfig,
  isOpenAILiveSessionConfig,
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { OpenAIClient } from './OpenAIClient';
import { computeRms } from './OpenAITranslateGAClient';
import { isElectron, isExtension } from '../../utils/environment';
import i18n from '../../locales';
import type { ClientDiagnosticCode } from '../../lib/diagnostics/clientDiagnostics';
import { describeCause } from '../../lib/diagnostics/describeCause';
import type { EventData } from '../../stores/logStore';

export const LIVE_WS_URL = 'wss://api.openai.com/v1/live/sessions';
export const LIVE_HOST = 'api.openai.com';
export const LIVE_MODEL = 'gpt-live-1';
const DEFAULT_VOICE = 'marin';
/** PCM16 sample rate on both directions of the socket. */
const SAMPLE_RATE = 24000;
const SILENCE_TIMEOUT_MS = 1000;
const SILENCE_TIMEOUT_MIN_MS = 100;
const SILENCE_TIMEOUT_MAX_MS = 3000;
const SESSION_START_TIMEOUT_MS = 30000;
/** How long disconnect() waits for session.closed before closing the socket anyway. */
const CLOSE_TIMEOUT_MS = 5000;
/** A second unexpected end inside this window after a reconnect means give up. */
const RECONNECT_GRACE_MS = 60_000;
/** Longest one leg may hold the upgrade gate without its socket settling (a black-holed TCP connect). */
const UPGRADE_GATE_CAP_MS = 15_000;

// One upgrade at a time per process. Electron's `ws-headers-set` rule is per
// host and one-shot; the extension's DNR rule is per host and cleared by
// whichever leg starts first. Two legs of a Both session reconnecting after
// the same network blip would otherwise register concurrently and send one
// upgrade without its header (401 → giveUp → the whole session torn down).
// Held from registerUpgradeHeader() until the socket's open/error/close.
let upgradeGate: Promise<void> = Promise.resolve();

async function acquireUpgradeGate(): Promise<() => void> {
  const prev = upgradeGate;
  let release!: () => void;
  upgradeGate = new Promise<void>((r) => { release = r; });
  await prev;
  return release;
}

export interface LiveSessionStart {
  type: 'session.start';
  event_id: string;
  session: {
    model: string;
    instructions: string;
    audio: { format: { type: 'audio/pcm'; rate: 24000 }; output: { voice: string } };
    delegation: { type: 'client' };
  };
}

function clampSilenceTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SILENCE_TIMEOUT_MS;
  return Math.max(SILENCE_TIMEOUT_MIN_MS, Math.min(SILENCE_TIMEOUT_MAX_MS, value));
}

export class OpenAILiveClient implements IClient {
  private apiKey: string;
  private ws: WebSocket | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private config: OpenAILiveSessionConfig | null = null;
  private connected: boolean = false;
  /** Set while disconnect() runs so a server-initiated close is not mistaken for an outage. */
  private closing: boolean = false;
  private closedReceived: boolean = false;
  private closeResolver: (() => void) | null = null;
  private headerPlatform: 'electron' | 'extension' | null = null;
  private sessionId: string | null = null;
  private expiresAt: number | null = null;
  private eventCounter: number = 0;

  // Stall watchdog: Live reports cumulative session seconds every ~15 s. Two
  // consecutive reports with the same count while we were sending voiced audio
  // is the signature of the upstream stall seen on 2026-09-12 (transcripts and
  // the counter froze, the socket died ~20 s later with 1006 and no
  // session.closed).
  private usageSeconds: number | null = null;
  private voicedInputSinceUsage: boolean = false;
  private reconnecting: boolean = false;
  private reconnectedAt: number | null = null;
  /** Bumped by connect()/disconnect() so a reconnect in flight can tell it has been superseded. */
  private generation: number = 0;
  /**
   * The 30 s session.start timer of the handshake pending on `this.ws`, or null
   * when none is. Cleared on every settle path so it can never fire against a
   * socket that has since been torn down or replaced.
   */
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  /** Latches once a frame has failed to parse; cleared by the next frame that parses. */
  private parseFailed: boolean = false;

  // Independent state machines for the user (input) and assistant (output)
  // sides, as in OpenAITranslateGAClient: the translation lags the source and
  // spans its sentence boundaries, so each side closes on its own timer.
  private currentUserItemId: string | null = null;
  private currentAssistantItemId: string | null = null;
  private userSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  private assistantSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  private userSilenceTimeoutMs: number = SILENCE_TIMEOUT_MS;
  private assistantSilenceTimeoutMs: number = SILENCE_TIMEOUT_MS;
  private audioChunks: Map<string, Int16Array[]> = new Map();
  private keepReplayAudio: boolean = false;
  private audioCumSamples: Map<string, number> = new Map();
  private itemLookup: Map<string, ConversationItem> = new Map();
  private conversationItems: ConversationItem[] = [];
  private deltaSequenceNumber: number = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // ----- Static helpers -----

  /** The first frame on the primary WebSocket. Pure, so tests pin the wire shape. */
  static buildSessionStart(config: OpenAILiveSessionConfig, eventId: string): LiveSessionStart {
    return {
      type: 'session.start',
      event_id: eventId,
      session: {
        model: config.model || LIVE_MODEL,
        instructions: config.instructions ?? '',
        audio: {
          format: { type: 'audio/pcm', rate: 24000 },
          output: { voice: config.voice || DEFAULT_VOICE },
        },
        delegation: { type: 'client' },
      },
    };
  }

  /** `gpt-live-1` and any dated `gpt-live-…` snapshot; never the transcription model. */
  static isLiveModel(id: string): boolean {
    const name = id.toLowerCase();
    if (name.startsWith('gpt-live-transcribe')) return false;
    return name === LIVE_MODEL || name.startsWith('gpt-live-');
  }

  static async validateApiKeyAndFetchModels(apiKey: string): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    const result = await OpenAIClient.fetchOpenAIModelsList(apiKey);
    if (result.error) return { validation: result.error, models: [] };

    const filtered = result.models
      .filter((m) => OpenAILiveClient.isLiveModel(m.id))
      .map((m) => ({ id: m.id, type: 'realtime' as const, created: m.created }))
      .sort((a, b) => b.created - a.created);

    if (filtered.length === 0) {
      return {
        validation: {
          valid: false,
          message: i18n.t('settings.realtimeModelNotAvailable'),
          validating: false,
          hasRealtimeModel: false,
        },
        models: [],
      };
    }
    return {
      validation: {
        valid: true,
        message: i18n.t('settings.realtimeModelAvailable'),
        validating: false,
        hasRealtimeModel: true,
      },
      models: filtered,
    };
  }

  // ----- Diagnostics -----

  private diagnose(code: ClientDiagnosticCode, message: string, cause?: unknown): void {
    this.eventHandlers.onDiagnostic?.({ code, message, cause });
  }

  private nextEventId(prefix: string): string {
    this.eventCounter += 1;
    return `${prefix}_${this.eventCounter}`;
  }

  private logClientEvent(type: EventData['type'], data: unknown): void {
    this.eventHandlers.onRealtimeEvent?.({ source: 'client', event: { type, data } });
  }

  // ----- Upgrade header injection -----

  /**
   * The Live endpoint authenticates the WebSocket upgrade with an Authorization
   * header only (the `openai-insecure-api-key.` subprotocol the Realtime endpoint
   * accepts is ignored here — verified 2026-09-12). Browsers cannot set upgrade
   * headers, so each platform injects it: Electron's main process consumes a
   * one-shot rule on the next upgrade to this host; the extension's background
   * adds a declarativeNetRequest rule scoped to /v1/live/.
   */
  private async registerUpgradeHeader(): Promise<void> {
    if (isElectron() && window.electron?.invoke) {
      const result = await window.electron.invoke('ws-headers-set', {
        host: LIVE_HOST,
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!result?.success) {
        throw new Error(`Failed to register WS headers: ${result?.error}`);
      }
      this.headerPlatform = 'electron';
      return;
    }
    if (isExtension()) {
      const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        chrome!.runtime.sendMessage(
          { type: 'OPENAI_LIVE_SET_HEADERS', apiKey: this.apiKey },
          (response: { success: boolean; error?: string }) => {
            if (chrome!.runtime.lastError) {
              resolve({ success: false, error: chrome!.runtime.lastError.message });
            } else {
              resolve(response || { success: false, error: 'No response from background' });
            }
          },
        );
      });
      if (!result.success) {
        throw new Error(`Failed to set DNR headers: ${result.error}`);
      }
      this.headerPlatform = 'extension';
      return;
    }
    throw new Error('OpenAI Live needs the desktop app or the browser extension');
  }

  private clearUpgradeHeader(): void {
    const platform = this.headerPlatform;
    this.headerPlatform = null;
    if (platform === 'electron') {
      window.electron.invoke('ws-headers-clear', { host: LIVE_HOST }).catch(() => {});
    } else if (platform === 'extension') {
      try {
        chrome!.runtime.sendMessage({ type: 'OPENAI_LIVE_CLEAR_HEADERS' });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // ----- Session lifecycle -----

  private resetSessionState(): void {
    if (this.userSilenceTimer) clearTimeout(this.userSilenceTimer);
    if (this.assistantSilenceTimer) clearTimeout(this.assistantSilenceTimer);
    this.userSilenceTimer = null;
    this.assistantSilenceTimer = null;
    this.currentUserItemId = null;
    this.currentAssistantItemId = null;
    this.itemLookup.clear();
    this.conversationItems = [];
    this.audioChunks.clear();
    this.audioCumSamples.clear();
    this.deltaSequenceNumber = 0;
    this.closedReceived = false;
    this.closeResolver = null;
    this.sessionId = null;
    this.expiresAt = null;
    this.usageSeconds = null;
    this.voicedInputSinceUsage = false;
    this.reconnecting = false;
    this.reconnectedAt = null;
  }

  /**
   * Register the header, open the socket, send session.start, wait for
   * session.started. Owns only the socket it creates: by the time a slow
   * handshake settles, disconnect()/connect() may have replaced `this.ws`, and
   * a stale failure must not tear the newer session down.
   */
  private async openSession(config: OpenAILiveSessionConfig): Promise<WebSocket> {
    const generation = this.generation;
    const releaseGate = await acquireUpgradeGate();
    let gateHeld = true;
    let gateTimer: ReturnType<typeof setTimeout> | null = null;
    const releaseUpgradeGate = () => {
      if (!gateHeld) return;
      gateHeld = false;
      if (gateTimer) {
        clearTimeout(gateTimer);
        gateTimer = null;
      }
      releaseGate();
    };
    // A coroutine that was queued at the gate while the user pressed Stop (or
    // Stop then Start) must never register a header or open a socket: it
    // would bill a session nobody wants and hold the gate against the real one.
    if (generation !== this.generation) {
      releaseUpgradeGate();
      throw new Error('session superseded during reconnect');
    }
    let ws: WebSocket | null = null;
    try {
      await this.registerUpgradeHeader();
      this.closedReceived = false;
      const socket = new WebSocket(LIVE_WS_URL);
      ws = socket;
      this.ws = socket;
      this.setupWebSocketListeners(socket);
      const start = OpenAILiveClient.buildSessionStart(config, this.nextEventId('start'));
      socket.onopen = () => {
        releaseUpgradeGate();
        socket.send(JSON.stringify(start));
        this.logClientEvent('session.start', start);
      };
      gateTimer = setTimeout(releaseUpgradeGate, UPGRADE_GATE_CAP_MS);
      await this.waitForSessionStarted(socket, generation);
      // Electron's rule was consumed by the upgrade; the extension's rule has
      // done its job. Clearing both is a no-op at worst — but only for the
      // generation that registered: a stale coroutine's late session.started
      // must not strip a newer session's not-yet-consumed rule.
      if (generation === this.generation) this.clearUpgradeHeader();
      return socket;
    } catch (error) {
      if (ws) {
        ws.onopen = null;
        ws.onclose = null;
        ws.onmessage = null;
        ws.onerror = null;
        try { ws.close(); } catch { /* already closed */ }
        if (this.ws === ws) this.ws = null;
      }
      // A stale clear on Electron would delete the newer session's
      // not-yet-consumed rule; only the generation that registered may clear.
      if (generation === this.generation) this.clearUpgradeHeader();
      throw error;
    } finally {
      // Settled on every path: session.started implies open fired; a rejected
      // handshake implies error, close, or the 30 s timeout (longer than the
      // gate cap). Idempotent, so the early release from onopen is unaffected.
      releaseUpgradeGate();
    }
  }

  private setupWebSocketListeners(ws: WebSocket): void {
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.parseFailed = false;
        this.handleServerEvent(data);
      } catch (err) {
        if (!this.parseFailed) {
          this.parseFailed = true;
          this.diagnose('parse_error', `server message could not be parsed: ${describeCause(err)}`, err);
        }
      }
    };
    ws.onerror = (event) => {
      this.eventHandlers.onError?.(event);
    };
    ws.onclose = (event) => {
      this.handleSocketClosed(ws, event);
    };
  }

  private handleSocketClosed(ws: WebSocket, event: { code: number; reason: string }): void {
    if (this.ws !== null && this.ws !== ws) return; // a socket we already replaced
    if (this.closing) {
      this.settleClose();
      return;
    }
    if (this.connected && !this.closedReceived) {
      void this.handleUnexpectedEnd(`websocket_closed_${event.code}`, { code: event.code, reason: event.reason });
    }
  }

  private waitForSessionStarted(ws: WebSocket, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      // Every settle path goes through here, so `this.handshakeTimer` is
      // non-null exactly while a handshake is pending — that is what lets
      // teardownSocket() settle it. The identity check keeps a stale
      // handshake from releasing a newer one's slot.
      const settle = () => {
        settled = true;
        if (timer) clearTimeout(timer);
        if (this.handshakeTimer === timer) this.handshakeTimer = null;
      };
      timer = setTimeout(() => {
        if (settled) return;
        settle();
        reject(new Error('Session start timeout'));
      }, SESSION_START_TIMEOUT_MS);
      this.handshakeTimer = timer;

      // Temporarily intercept frames for the handshake, then hand back to the
      // regular handlers installed by setupWebSocketListeners.
      const regularHandler = ws.onmessage;
      const regularError = ws.onerror;
      const regularClose = ws.onclose;
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'session.started' && !settled) {
            settle();
            ws.onmessage = regularHandler;
            ws.onerror = regularError;
            ws.onclose = regularClose;
            // A handshake that outlived its generation (disconnect() waited
            // out a close handshake while this one was still pending) must
            // not overwrite the identity of the session that follows.
            if (generation === this.generation) {
              this.sessionId = data.session?.id ?? null;
              this.expiresAt = data.session?.expires_at ?? null;
            }
            if (regularHandler && typeof regularHandler === 'function') {
              regularHandler.call(ws, event);
            }
            resolve();
            return;
          }
          if (data.type === 'error' && !settled) {
            settle();
            reject(new Error(data.error?.message || 'Session start failed'));
            return;
          }
        } catch {
          // ignore parse errors during handshake
        }
        if (regularHandler && typeof regularHandler === 'function') {
          regularHandler.call(ws, event);
        }
      };
      ws.onerror = () => {
        if (settled) return;
        settle();
        reject(new Error('WebSocket error during session start'));
      };
      // A close racing the handshake must reject promptly rather than let the
      // caller wait out the full SESSION_START_TIMEOUT_MS for a misleading
      // 'Session start timeout'. teardownSocket() also drives this handler
      // (code 1006, 'torn down') to settle a pending handshake before it nulls
      // the handlers. The reject paths above and below don't restore the
      // regular handlers — openSession's catch detaches and closes the socket
      // right after.
      ws.onclose = (event) => {
        if (settled) return;
        settle();
        reject(new Error(`WebSocket closed during session start (code ${event.code})`));
      };
    });
  }

  /**
   * Detach every socket handler and close it. Safe to call on an already-closed
   * socket. A handshake still pending on the socket is settled first, through
   * its own close handler, so the coroutine awaiting it wakes, sees the
   * generation change, and returns without touching whatever `this.ws` is by
   * then — and its 30 s timer is gone before the socket is.
   */
  private teardownSocket(): void {
    const ws = this.ws;
    const handshakePending = this.handshakeTimer !== null;
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    if (!ws) return;
    if (handshakePending) {
      ws.onclose?.call(ws, { code: 1006, reason: 'torn down' } as CloseEvent);
    }
    ws.onopen = null;
    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
    try { ws.close(); } catch { /* already closed */ }
    if (this.ws === ws) this.ws = null;
  }

  private settleClose(): void {
    this.closedReceived = true;
    const resolver = this.closeResolver;
    this.closeResolver = null;
    resolver?.();
  }

  private waitForClosed(): Promise<void> {
    return new Promise((resolve) => {
      if (this.closedReceived) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        if (this.closeResolver) {
          this.closeResolver = null;
          this.logClientEvent('session.close_timeout', { provider: 'openai_live', waitedMs: CLOSE_TIMEOUT_MS });
          resolve();
        }
      }, CLOSE_TIMEOUT_MS);
      this.closeResolver = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  }

  // ----- Outage handling -----

  /**
   * One silent reconnect per outage, then the notice. Instructions are the
   * whole context an interpreter needs, so a fresh session loses nothing but
   * the audio that arrives during the gap (dropped, not buffered).
   */
  private async handleUnexpectedEnd(cause: string, detail?: unknown): Promise<void> {
    // `connected` turns true only after session.started, so a session.closed
    // or stall signal that lands during the initial handshake is ignored
    // (spec §1.5: "while connected and after session.started").
    if (!this.connected || this.closing || this.reconnecting || !this.config) return;
    this.completeUserItem();
    this.completeAssistantItem();
    this.logClientEvent('session.connection_lost', { provider: 'openai_live', cause, detail, timestamp: Date.now() });

    const recentlyReconnected = this.reconnectedAt !== null && Date.now() - this.reconnectedAt < RECONNECT_GRACE_MS;
    if (recentlyReconnected) {
      this.giveUp(cause);
      return;
    }

    this.reconnecting = true;
    this.teardownSocket();
    this.logClientEvent('session.reconnecting', { provider: 'openai_live', cause, timestamp: Date.now() });
    this.eventHandlers.onReconnecting?.();
    const generation = this.generation;
    try {
      const ws = await this.openSession(this.config);
      if (generation !== this.generation || this.closing) {
        // The session was disconnected (or restarted) while we were
        // reconnecting: close the socket this reconnect opened and leave
        // everything else — connect()/disconnect() already own the rest of
        // the state — alone. No onReconnected.
        this.reconnecting = false;
        ws.onclose = null;
        ws.onmessage = null;
        ws.onerror = null;
        try { ws.close(); } catch { /* already closed */ }
        if (this.ws === ws) this.ws = null;
        return;
      }
      this.reconnecting = false;
      this.reconnectedAt = Date.now();
      this.usageSeconds = null;
      this.voicedInputSinceUsage = false;
      this.connected = true;
      this.logClientEvent('session.reconnected', { provider: 'openai_live', sessionId: this.sessionId, timestamp: Date.now() });
      this.eventHandlers.onReconnected?.();
    } catch (error) {
      if (generation !== this.generation || this.closing) {
        // A user-initiated disconnect during the failed reconnect attempt
        // must not raise the notice, onError, or onClose.
        this.reconnecting = false;
        return;
      }
      this.reconnecting = false;
      this.giveUp(cause, error);
    }
  }

  private giveUp(cause: string, error?: unknown): void {
    this.teardownSocket();
    this.connected = false;
    const text = i18n.t('mainPanel.openaiLiveConnectionLost');
    const item: ConversationItem = {
      id: this.genItemId(),
      role: 'system',
      type: 'error',
      status: 'completed',
      createdAt: Date.now(),
      formatted: { text },
      content: [{ type: 'text', text }],
    };
    this.conversationItems.push(item);
    this.itemLookup.set(item.id, item);
    this.eventHandlers.onConversationUpdated?.({ item });
    this.eventHandlers.onError?.(error ?? new Error(`OpenAI Live session ended: ${cause}`));
    this.eventHandlers.onClose?.({ reason: cause });
  }

  // ----- Server events -----

  private handleServerEvent(event: any): void {
    // Decode + measure output audio once so the log carries the frame's RMS and
    // the case below reuses the buffer. Live streams zero-amplitude frames
    // continuously between utterances (like the translate API's heartbeat);
    // those are noise for the timeline and for the conversation.
    let decodedAudio: Int16Array | null = null;
    let audioRms: number | null = null;
    if (event.type === 'session.output_audio.delta' && event.delta) {
      decodedAudio = base64ToInt16Array(event.delta);
      audioRms = computeRms(decodedAudio);
      event.rms = audioRms;
    }
    const isSilentAudioFrame = event.type === 'session.output_audio.delta' && audioRms === 0;
    if (!isSilentAudioFrame) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: event.type, data: event },
      });
    }

    switch (event.type) {
      case 'session.input_transcript.delta': {
        const userItemId = this.ensureUserItem();
        const userItem = this.itemLookup.get(userItemId);
        if (userItem?.formatted) {
          userItem.formatted.transcript = (userItem.formatted.transcript || '') + (event.delta || '');
        }
        this.eventHandlers.onConversationUpdated?.({
          item: userItem!,
          delta: { transcript: event.delta },
        });
        this.resetUserSilenceTimer();
        break;
      }

      case 'session.output_transcript.delta': {
        const assistantItemId = this.ensureAssistantItem();
        const assistantItem = this.itemLookup.get(assistantItemId);
        if (assistantItem?.formatted) {
          assistantItem.formatted.transcript = (assistantItem.formatted.transcript || '') + (event.delta || '');
        }
        this.eventHandlers.onConversationUpdated?.({
          item: assistantItem!,
          delta: { transcript: event.delta },
        });
        this.resetAssistantSilenceTimer();
        break;
      }

      case 'session.output_audio.delta': {
        if (!event.delta || !decodedAudio) break;
        if (audioRms === 0) break;
        const audioData = decodedAudio;

        const assistantItemId = this.currentAssistantItemId ?? this.ensureAssistantItem();
        const assistantItem = this.itemLookup.get(assistantItemId);
        if (!assistantItem) break;

        const sequenceNumber = ++this.deltaSequenceNumber;

        // Full-audio retention is the one thing that grows with session length;
        // karaoke timing below stays populated either way.
        if (this.keepReplayAudio) {
          if (!this.audioChunks.has(assistantItemId)) {
            this.audioChunks.set(assistantItemId, []);
          }
          this.audioChunks.get(assistantItemId)!.push(audioData);
        }
        const prevCumSamples = this.audioCumSamples.get(assistantItemId) ?? 0;
        const newCumSamples = prevCumSamples + audioData.length;
        this.audioCumSamples.set(assistantItemId, newCumSamples);

        // Anchor the current transcript end to cumulative audio time so the
        // highlight steps in chunk-aligned units (see OpenAITranslateGAClient,
        // issue #216). Transcript and audio are independent streams here too.
        if (assistantItem.formatted) {
          const textLen = assistantItem.formatted.transcript?.length ?? 0;
          if (!assistantItem.formatted.audioSegments) {
            assistantItem.formatted.audioSegments = [];
          }
          assistantItem.formatted.audioSegments.push({
            textEnd: textLen,
            audioEnd: newCumSamples / SAMPLE_RATE,
          });
          assistantItem.formatted.audioTextEnd = textLen;
        }

        this.eventHandlers.onConversationUpdated?.({
          item: assistantItem,
          delta: {
            audio: audioData,
            sequenceNumber,
            timestamp: Date.now(),
          },
        });
        // Voiced audio is real assistant activity — keep the item open until
        // playback-side rendering also winds down.
        this.resetAssistantSilenceTimer();
        break;
      }

      case 'session.usage.updated': {
        const seconds = event.usage?.seconds;
        if (typeof seconds === 'number') {
          const frozen = this.usageSeconds !== null && seconds === this.usageSeconds && this.voicedInputSinceUsage;
          this.usageSeconds = seconds;
          this.voicedInputSinceUsage = false;
          if (frozen) {
            void this.handleUnexpectedEnd('stalled', { seconds });
          }
        }
        break;
      }

      case 'session.delegation.created':
      case 'session.instructions.appended':
      case 'session.thinking.appended':
      case 'session.commentary.appended':
      case 'session.input_audio.muted':
      case 'session.input_audio.unmuted':
      case 'session.started':
      case 'session.updated':
      case 'info':
        // No conversation impact; already forwarded via onRealtimeEvent above.
        break;

      case 'session.closed':
        if (this.closing) {
          this.settleClose();
        } else if (this.connected) {
          this.closedReceived = true;
          void this.handleUnexpectedEnd(`session_closed_${event.reason ?? 'unknown'}`, { reason: event.reason, usage: event.usage });
        }
        // Before session.started it is already on the realtime log (forwarded
        // above) and nothing else: latching closedReceived here would make
        // handleSocketClosed swallow the next abnormal close of the session
        // that follows.
        break;

      case 'error': {
        const errorMessage = event.error?.message || event.error?.code || 'Unknown error';
        const errorItem: ConversationItem = {
          id: this.genItemId(),
          role: 'system',
          type: 'error',
          status: 'completed',
          createdAt: Date.now(),
          formatted: { text: `[${event.error?.type || 'error'}] ${errorMessage}` },
          content: [{ type: 'text', text: errorMessage }],
        };
        this.eventHandlers.onConversationUpdated?.({ item: errorItem });
        this.eventHandlers.onError?.(event.error || event);
        break;
      }

      default:
        // Unhandled event type — already logged via onRealtimeEvent above
        break;
    }
  }

  // ----- Item helpers (same shape as OpenAITranslateGAClient) -----

  private genItemId(): string {
    return `live_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private resetUserSilenceTimer(): void {
    if (this.userSilenceTimer) clearTimeout(this.userSilenceTimer);
    this.userSilenceTimer = setTimeout(() => {
      this.completeUserItem();
    }, this.userSilenceTimeoutMs);
  }

  private resetAssistantSilenceTimer(): void {
    if (this.assistantSilenceTimer) clearTimeout(this.assistantSilenceTimer);
    this.assistantSilenceTimer = setTimeout(() => {
      this.completeAssistantItem();
    }, this.assistantSilenceTimeoutMs);
  }

  private ensureUserItem(): string {
    if (this.currentUserItemId) return this.currentUserItemId;
    const id = this.genItemId();
    this.currentUserItemId = id;
    const item: ConversationItem = {
      id,
      role: 'user',
      type: 'message',
      status: 'in_progress',
      createdAt: Date.now(),
      formatted: { text: '', transcript: '' },
      content: [],
    };
    this.conversationItems.push(item);
    this.itemLookup.set(id, item);
    this.eventHandlers.onConversationUpdated?.({ item });
    return id;
  }

  private ensureAssistantItem(): string {
    if (this.currentAssistantItemId) return this.currentAssistantItemId;
    const id = this.genItemId();
    this.currentAssistantItemId = id;
    const item: ConversationItem = {
      id,
      role: 'assistant',
      type: 'message',
      status: 'in_progress',
      createdAt: Date.now(),
      formatted: { text: '', transcript: '' },
      content: [],
    };
    this.conversationItems.push(item);
    this.itemLookup.set(id, item);
    this.eventHandlers.onConversationUpdated?.({ item });
    return id;
  }

  private completeUserItem(): void {
    if (!this.currentUserItemId) return;
    const item = this.itemLookup.get(this.currentUserItemId);
    if (item) {
      item.status = 'completed';
      if (item.formatted) item.formatted.text = item.formatted.transcript || '';
      this.eventHandlers.onConversationUpdated?.({ item });
    }
    this.currentUserItemId = null;
    if (this.userSilenceTimer) {
      clearTimeout(this.userSilenceTimer);
      this.userSilenceTimer = null;
    }
  }

  private completeAssistantItem(): void {
    if (!this.currentAssistantItemId) return;
    const itemId = this.currentAssistantItemId;
    const item = this.itemLookup.get(itemId);
    if (item) {
      item.status = 'completed';
      if (this.keepReplayAudio) {
        const chunks = this.audioChunks.get(itemId);
        if (chunks && chunks.length > 0 && item.formatted) {
          const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
          const merged = new Int16Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
          item.formatted.audio = merged;
          this.audioChunks.delete(itemId);
        }
      }
      this.audioCumSamples.delete(itemId);
      if (item.formatted) item.formatted.text = item.formatted.transcript || '';
      this.eventHandlers.onConversationUpdated?.({ item });
    }
    this.currentAssistantItemId = null;
    if (this.assistantSilenceTimer) {
      clearTimeout(this.assistantSilenceTimer);
      this.assistantSilenceTimer = null;
    }
  }

  // ----- IClient -----

  async connect(config: SessionConfig): Promise<void> {
    this.generation += 1;
    if (!isOpenAILiveSessionConfig(config)) {
      throw new Error('OpenAILiveClient requires an openai_live session config');
    }
    this.config = config;
    this.resetSessionState();
    this.keepReplayAudio = config.keepReplayAudio ?? false;
    this.userSilenceTimeoutMs = clampSilenceTimeout(config.userSilenceDurationMs);
    this.assistantSilenceTimeoutMs = clampSilenceTimeout(config.assistantSilenceDurationMs);

    await this.openSession(config);

    this.connected = true;
    this.logClientEvent('session.opened', {
      status: 'connected',
      provider: 'openai_live',
      model: this.config?.model,
      sessionId: this.sessionId,
      expiresAt: this.expiresAt,
      // Effective clamped thresholds for this session.
      userSilenceTimeoutMs: this.userSilenceTimeoutMs,
      assistantSilenceTimeoutMs: this.assistantSilenceTimeoutMs,
      timestamp: Date.now(),
    });
    this.eventHandlers.onOpen?.();
  }

  async disconnect(): Promise<void> {
    this.generation += 1;
    this.closing = true;
    if (this.reconnecting) {
      // A reconnect in flight: settle the handshake pending on its socket (if
      // it has one yet) so it wakes now; either way it sees the generation
      // change after its await and closes whatever it opened.
      this.teardownSocket();
    }
    const ws = this.ws;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'session.close' }));
      this.logClientEvent('session.close', { provider: 'openai_live', timestamp: Date.now() });
      await this.waitForClosed();
    }
    // Detach before closing: a close handshake the server never answers makes
    // the browser fail the connection, and that late `error` must not become
    // an onError bubble after a clean Stop.
    this.teardownSocket();
    this.connected = false;
    this.closing = false;
    this.clearUpgradeHeader();
    // Finalise in-flight items so partial transcripts/audio aren't lost.
    this.completeUserItem();
    this.completeAssistantItem();
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === 1;
  }

  /** Every startup field is immutable on the wire; only the local thresholds move. */
  updateSession(config: Partial<SessionConfig>): void {
    const live = config as Partial<OpenAILiveSessionConfig>;
    if (live.userSilenceDurationMs !== undefined) {
      this.userSilenceTimeoutMs = clampSilenceTimeout(live.userSilenceDurationMs);
    }
    if (live.assistantSilenceDurationMs !== undefined) {
      this.assistantSilenceTimeoutMs = clampSilenceTimeout(live.assistantSilenceDurationMs);
    }
  }

  reset(): void {
    this.resetSessionState();
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    const payload = {
      type: 'session.input_audio.append' as const,
      audio: int16ArrayToBase64(audioData),
    };
    this.ws.send(JSON.stringify(payload));
    // Log only voiced frames: pre-speech silence would drown the timeline and
    // says nothing the next voiced frame doesn't. The wire send happened above.
    const rms = computeRms(audioData);
    if (rms === 0) return;
    this.voicedInputSinceUsage = true;
    this.logClientEvent(payload.type, { ...payload, rms });
  }

  appendInputText(_text: string): void { /* no-op: Live has no text input in this design */ }
  createResponse(_config?: ResponseConfig): void { /* no-op: continuous stream, no turn loop */ }
  cancelResponse(_trackId?: string, _offset?: number): void { /* no-op */ }
  getConversationItems(): ConversationItem[] { return [...this.conversationItems]; }
  clearConversationItems(): void {
    this.conversationItems = [];
    this.itemLookup.clear();
    this.audioChunks.clear();
    this.audioCumSamples.clear();
  }
  setEventHandlers(handlers: ClientEventHandlers): void { this.eventHandlers = { ...handlers }; }
  getProvider(): ProviderType { return Provider.OPENAI_LIVE; }
}

export function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

export function int16ArrayToBase64(data: Int16Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export { SAMPLE_RATE as LIVE_SAMPLE_RATE, SILENCE_TIMEOUT_MS, SILENCE_TIMEOUT_MIN_MS, SILENCE_TIMEOUT_MAX_MS };
