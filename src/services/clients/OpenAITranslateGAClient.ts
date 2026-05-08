import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  OpenAITranslateSessionConfig,
  TranslateTargetLanguage,
  ApiKeyValidationResult,
  FilteredModel,
  ResponseConfig,
  isOpenAITranslateSessionConfig,
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';

// Later tasks will re-add these imports as they're needed:
//   - `OpenAIClient` (Task 10 — reusing the OpenAI model list fetch)
//   - default `i18n` instance from `../../locales` (Task 10 — error translation)
// They were intentionally omitted to satisfy `noUnusedLocals`.

const TRANSLATE_WS_URL = 'wss://api.openai.com/v1/realtime/translations';
const SILENCE_TIMEOUT_MS = 1500;

/** Shape of the `session` field inside `session.update` for translate. */
export interface TranslateSessionPayload {
  audio: {
    output: { language: TranslateTargetLanguage };
    input?: {
      transcription?: { model: string };
      noise_reduction?: { type: 'near_field' | 'far_field' };
    };
  };
}

export class OpenAITranslateGAClient implements IClient {
  private apiKey: string;
  private ws: WebSocket | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private connected: boolean = false;

  // Pairing state machine — see design spec §3 for rationale
  private currentPair: { userItemId: string; assistantItemId: string } | null = null;
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private audioChunks: Map<string, Int16Array[]> = new Map();
  private itemLookup: Map<string, ConversationItem> = new Map();
  private conversationItems: ConversationItem[] = [];
  private deltaSequenceNumber: number = 0;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Build the session.update payload sent right after WebSocket open.
   * Pure function — exposed as static so OpenAITranslateWebRTCClient can
   * also use it for its data-channel session.update.
   */
  static buildSessionUpdate(config: OpenAITranslateSessionConfig): { type: 'session.update'; session: TranslateSessionPayload } {
    const audioInput: NonNullable<TranslateSessionPayload['audio']['input']> = {};
    if (config.inputAudioTranscription?.model) {
      audioInput.transcription = { model: config.inputAudioTranscription.model };
    }
    if (config.inputAudioNoiseReduction?.type) {
      audioInput.noise_reduction = { type: config.inputAudioNoiseReduction.type };
    }

    const audio: TranslateSessionPayload['audio'] = {
      output: { language: config.targetLanguage },
    };
    if (Object.keys(audioInput).length > 0) {
      audio.input = audioInput;
    }

    return {
      type: 'session.update',
      session: { audio },
    };
  }

  // ----- Pairing state machine -----

  private genItemId(): string {
    return `translate_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private resetDeltaTimer(): void {
    if (this.deltaTimer) clearTimeout(this.deltaTimer);
    this.deltaTimer = setTimeout(() => {
      this.completeCurrentPair();
    }, SILENCE_TIMEOUT_MS);
  }

  private ensurePair(): { userItemId: string; assistantItemId: string } {
    if (this.currentPair) return this.currentPair;

    const userItemId = this.genItemId();
    const assistantItemId = this.genItemId();
    this.currentPair = { userItemId, assistantItemId };

    const createdAt = Date.now();

    const userItem: ConversationItem = {
      id: userItemId,
      role: 'user',
      type: 'message',
      status: 'in_progress',
      createdAt,
      formatted: { text: '', transcript: '' },
      content: [],
    };
    const assistantItem: ConversationItem = {
      id: assistantItemId,
      role: 'assistant',
      type: 'message',
      status: 'in_progress',
      createdAt,
      formatted: { text: '', transcript: '' },
      content: [],
    };

    this.conversationItems.push(userItem, assistantItem);
    this.itemLookup.set(userItemId, userItem);
    this.itemLookup.set(assistantItemId, assistantItem);

    this.eventHandlers.onConversationUpdated?.({ item: userItem });
    this.eventHandlers.onConversationUpdated?.({ item: assistantItem });

    return this.currentPair;
  }

  private completeCurrentPair(): void {
    if (!this.currentPair) return;

    const { userItemId, assistantItemId } = this.currentPair;
    const userItem = this.itemLookup.get(userItemId);
    const assistantItem = this.itemLookup.get(assistantItemId);

    if (userItem) {
      userItem.status = 'completed';
      if (userItem.formatted) userItem.formatted.text = userItem.formatted.transcript || '';
      this.eventHandlers.onConversationUpdated?.({ item: userItem });
    }

    if (assistantItem) {
      assistantItem.status = 'completed';
      const chunks = this.audioChunks.get(assistantItemId);
      if (chunks && chunks.length > 0 && assistantItem.formatted) {
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        const merged = new Int16Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        assistantItem.formatted.audio = merged;
        this.audioChunks.delete(assistantItemId);
      }
      if (assistantItem.formatted) assistantItem.formatted.text = assistantItem.formatted.transcript || '';
      this.eventHandlers.onConversationUpdated?.({ item: assistantItem });
    }

    this.currentPair = null;
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = null;
    }
  }

  private handleServerEvent(event: any): void {
    // Forward to logging handlers
    this.eventHandlers.onRealtimeEvent?.({
      source: 'server',
      event: { type: event.type, data: event },
    });

    switch (event.type) {
      case 'session.input_transcript.delta': {
        const pair = this.ensurePair();
        const userItem = this.itemLookup.get(pair.userItemId);
        if (userItem?.formatted) {
          userItem.formatted.transcript = (userItem.formatted.transcript || '') + (event.delta || '');
        }
        this.eventHandlers.onConversationUpdated?.({
          item: userItem!,
          delta: { transcript: event.delta },
        });
        this.resetDeltaTimer();
        break;
      }

      case 'session.output_transcript.delta': {
        const pair = this.ensurePair();
        const assistantItem = this.itemLookup.get(pair.assistantItemId);
        if (assistantItem?.formatted) {
          assistantItem.formatted.transcript = (assistantItem.formatted.transcript || '') + (event.delta || '');
        }
        this.eventHandlers.onConversationUpdated?.({
          item: assistantItem!,
          delta: { transcript: event.delta },
        });
        this.resetDeltaTimer();
        break;
      }

      case 'session.output_audio.delta': {
        const pair = this.ensurePair();
        const assistantItem = this.itemLookup.get(pair.assistantItemId);
        if (!assistantItem || !event.delta) break;

        const audioData = base64ToInt16Array(event.delta);
        const sequenceNumber = ++this.deltaSequenceNumber;

        if (!this.audioChunks.has(pair.assistantItemId)) {
          this.audioChunks.set(pair.assistantItemId, []);
        }
        this.audioChunks.get(pair.assistantItemId)!.push(audioData);

        this.eventHandlers.onConversationUpdated?.({
          item: assistantItem,
          delta: {
            audio: audioData,
            sequenceNumber,
            timestamp: Date.now(),
          },
        });
        this.resetDeltaTimer();
        break;
      }

      case 'session.input_transcript.done':
      case 'session.output_transcript.done':
      case 'session.output_audio.done':
        // Any of these indicate end of utterance.
        this.completeCurrentPair();
        break;

      case 'session.created':
      case 'session.updated':
        // No conversation impact; already forwarded via onRealtimeEvent above.
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
        // Unhandled event type — already logged via onRealtimeEvent
        break;
    }
  }

  // IClient methods
  async connect(config: SessionConfig): Promise<void> {
    if (!isOpenAITranslateSessionConfig(config)) {
      throw new Error('OpenAITranslateGAClient requires translate session config');
    }

    // Reset state
    this.deltaSequenceNumber = 0;
    this.itemLookup.clear();
    this.conversationItems = [];
    this.audioChunks.clear();
    this.currentPair = null;

    const url = `${TRANSLATE_WS_URL}?model=${encodeURIComponent(config.model)}`;
    // The browser WebSocket constructor cannot set Authorization headers.
    // OpenAI accepts auth via the Sec-WebSocket-Protocol subprotocol with the
    // `openai-insecure-api-key.${apiKey}` token (same pattern used by the
    // openai-realtime-api community library and existing OpenAIClient).
    this.ws = new WebSocket(url, [
      'realtime',
      `openai-insecure-api-key.${this.apiKey}`,
      'openai-beta.realtime-v1',
    ]);

    this.setupWebSocketListeners();
    await this.waitForSessionCreated();

    // Send session.update
    const updatePayload = OpenAITranslateGAClient.buildSessionUpdate(config);
    this.ws!.send(JSON.stringify(updatePayload));
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: { type: 'session.update', data: updatePayload },
    });

    this.connected = true;
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'session.opened',
        data: {
          status: 'connected',
          provider: 'openai_translate',
          model: config.model,
          timestamp: Date.now(),
        },
      },
    });
    this.eventHandlers.onOpen?.();
  }

  private setupWebSocketListeners(): void {
    if (!this.ws) return;
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleServerEvent(data);
      } catch (err) {
        console.error('[OpenAITranslateGAClient] Failed to parse server message:', err);
      }
    };
    this.ws.onerror = (event) => {
      this.eventHandlers.onError?.(event);
    };
    this.ws.onclose = () => {
      if (this.connected) {
        this.connected = false;
        this.eventHandlers.onRealtimeEvent?.({
          source: 'client',
          event: {
            type: 'session.closed',
            data: { status: 'disconnected', provider: 'openai_translate', timestamp: Date.now(), reason: 'websocket_closed' },
          },
        });
        this.eventHandlers.onClose?.({});
      }
    };
  }

  private waitForSessionCreated(): Promise<void> {
    const SESSION_TIMEOUT = 30000;
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
          reject(new Error('Session creation timeout'));
        }
      }, SESSION_TIMEOUT);

      // Override onmessage temporarily to look for session.created /
      // forward errors through reject. Once resolved, hand control back
      // to the regular handler installed by setupWebSocketListeners.
      const regularHandler = ws.onmessage;
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'session.created' && !settled) {
            settled = true;
            clearTimeout(timeout);
            ws.onmessage = regularHandler;
            // Replay this event through the regular handler so it gets logged
            if (regularHandler && typeof regularHandler === 'function') {
              regularHandler.call(ws, event);
            }
            resolve();
            return;
          }
          if (data.type === 'error' && !settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error(data.error?.message || 'Session creation failed'));
            return;
          }
        } catch {
          // ignore parse errors during handshake
        }
        // Forward other messages to the regular handler so logs aren't lost
        if (regularHandler && typeof regularHandler === 'function') {
          regularHandler.call(ws, event);
        }
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('WebSocket error during session creation'));
        }
      };
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.completeCurrentPair();
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === 1;
  }

  updateSession(config: Partial<SessionConfig>): void {
    if (!this.ws || !isOpenAITranslateSessionConfig(config as SessionConfig)) return;
    const updatePayload = OpenAITranslateGAClient.buildSessionUpdate(config as OpenAITranslateSessionConfig);
    this.ws.send(JSON.stringify(updatePayload));
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: { type: 'session.update', data: updatePayload },
    });
  }

  reset(): void {
    // Cancel the silence timer and finalize any in-flight pair, then drop
    // accumulated state so the client is fresh for the next session.
    if (this.deltaTimer) {
      clearTimeout(this.deltaTimer);
      this.deltaTimer = null;
    }
    this.currentPair = null;
    this.conversationItems = [];
    this.itemLookup.clear();
    this.audioChunks.clear();
    this.deltaSequenceNumber = 0;
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    const base64 = int16ArrayToBase64(audioData);
    this.ws.send(JSON.stringify({
      type: 'session.input_audio_buffer.append',
      audio: base64,
    }));
  }

  appendInputText(_text: string): void { /* no-op: text input not supported by translate */ }
  createResponse(_config?: ResponseConfig): void { /* no-op: continuous streaming, no response lifecycle */ }
  cancelResponse(_trackId?: string, _offset?: number): void { /* no-op for Phase 1 */ }
  getConversationItems(): ConversationItem[] { return [...this.conversationItems]; }
  clearConversationItems(): void {
    this.conversationItems = [];
    this.itemLookup.clear();
    this.audioChunks.clear();
  }
  setEventHandlers(handlers: ClientEventHandlers): void { this.eventHandlers = { ...handlers }; }
  getProvider(): ProviderType { return Provider.OPENAI_TRANSLATE; }
}

function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function int16ArrayToBase64(data: Int16Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Re-exports kept for symmetry with sibling clients; see imports comment above.
export type { ApiKeyValidationResult, FilteredModel };
// Internal constants exported for use by later-task helpers / WebRTC client.
export { TRANSLATE_WS_URL, SILENCE_TIMEOUT_MS };
