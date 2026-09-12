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
  }

  /** Register the header, open the socket, send session.start, wait for session.started. */
  private async openSession(config: OpenAILiveSessionConfig): Promise<void> {
    await this.registerUpgradeHeader();
    try {
      this.closedReceived = false;
      this.ws = new WebSocket(LIVE_WS_URL);
      this.setupWebSocketListeners(this.ws);
      const start = OpenAILiveClient.buildSessionStart(config, this.nextEventId('start'));
      this.ws.onopen = () => {
        this.ws?.send(JSON.stringify(start));
        this.logClientEvent('session.start', start);
      };
      await this.waitForSessionStarted();
    } catch (error) {
      this.teardownSocket();
      this.clearUpgradeHeader();
      throw error;
    }
    // Electron's rule was consumed by the upgrade; the extension's rule has
    // done its job. Clearing both is a no-op at worst.
    this.clearUpgradeHeader();
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
    if (this.connected) {
      this.connected = false;
      this.logClientEvent('session.closed', {
        status: 'disconnected', provider: 'openai_live', timestamp: Date.now(),
        reason: 'websocket_closed', code: event.code, detail: event.reason,
      });
      this.eventHandlers.onClose?.({ code: event.code, reason: event.reason });
    }
  }

  private waitForSessionStarted(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('WebSocket not initialized'));
        return;
      }
      let settled = false;
      const ws = this.ws;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Session start timeout'));
        }
      }, SESSION_START_TIMEOUT_MS);

      // Temporarily intercept frames for the handshake, then hand back to the
      // regular handlers installed by setupWebSocketListeners.
      const regularHandler = ws.onmessage;
      const regularError = ws.onerror;
      const regularClose = ws.onclose;
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'session.started' && !settled) {
            settled = true;
            clearTimeout(timeout);
            ws.onmessage = regularHandler;
            ws.onerror = regularError;
            ws.onclose = regularClose;
            this.sessionId = data.session?.id ?? null;
            this.expiresAt = data.session?.expires_at ?? null;
            if (regularHandler && typeof regularHandler === 'function') {
              regularHandler.call(ws, event);
            }
            resolve();
            return;
          }
          if (data.type === 'error' && !settled) {
            settled = true;
            clearTimeout(timeout);
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
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('WebSocket error during session start'));
        }
      };
      // A close racing the handshake must reject promptly rather than let the
      // caller wait out the full SESSION_START_TIMEOUT_MS for a misleading
      // 'Session start timeout'. The reject paths above and below don't
      // restore the regular handlers — the socket is torn down right after
      // by openSession's catch block (teardownSocket nulls all three anyway).
      ws.onclose = (event) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`WebSocket closed during session start (code ${event.code})`));
        }
      };
    });
  }

  /** Detach every socket handler and close it. Safe to call on an already-closed socket. */
  private teardownSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      try { ws.close(); } catch { /* already closed */ }
    }
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

  // ----- Server events (extended in later tasks) -----

  private handleServerEvent(event: any): void {
    this.eventHandlers.onRealtimeEvent?.({
      source: 'server',
      event: { type: event.type, data: event },
    });

    switch (event.type) {
      case 'session.started':
      case 'session.updated':
        break;

      case 'session.closed':
        if (this.closing) {
          this.settleClose();
        }
        break;

      case 'error': {
        const errorMessage = event.error?.message || event.error?.code || 'Unknown error';
        const errorItem: ConversationItem = {
          id: this.genItemId(),
          role: 'system',
          type: 'error',
          status: 'completed',
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
      // Effective clamped thresholds and the delta cursor for this session —
      // consumed by the item helpers a later task adds; logged here so the
      // fields are read, not just written, from the moment this task lands.
      userSilenceTimeoutMs: this.userSilenceTimeoutMs,
      assistantSilenceTimeoutMs: this.assistantSilenceTimeoutMs,
      deltaSequenceNumber: this.deltaSequenceNumber,
      timestamp: Date.now(),
    });
    this.eventHandlers.onOpen?.();
  }

  async disconnect(): Promise<void> {
    this.closing = true;
    const ws = this.ws;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'session.close' }));
      this.logClientEvent('session.close', { provider: 'openai_live', timestamp: Date.now() });
      await this.waitForClosed();
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
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
