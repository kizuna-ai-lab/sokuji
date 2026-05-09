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
import { OpenAIClient } from './OpenAIClient';
import i18n from '../../locales';

const TRANSLATE_WS_URL = 'wss://api.openai.com/v1/realtime/translations';
/** Default silence threshold for both user (input) and assistant (output) timers. */
const SILENCE_TIMEOUT_MS = 1000;
const SILENCE_TIMEOUT_MIN_MS = 100;
const SILENCE_TIMEOUT_MAX_MS = 3000;
/** 200 ms @ 24 kHz = 4800 samples — the API's heartbeat frame size. Kept for
 *  reference / tests; runtime detection now uses {@link isSilenceFrame} so we
 *  don't break if the API ever changes the heartbeat duration. */
const HEARTBEAT_SAMPLES = 4800;
/** PCM16 sample rate of the translate API audio stream. */
const SAMPLE_RATE = 24000;

/** Compute RMS amplitude of a PCM16 frame, normalized to the [0, 1] range
 *  by dividing by the Int16 max (32768). Returns 0 for an empty frame.
 *
 *  Empirically (commit 98149d35): heartbeat frames have rms === 0, content
 *  frames have rms ≈ 0.04–0.08. */
export function computeRms(audio: Int16Array): number {
  if (audio.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < audio.length; i++) {
    sumSq += audio[i] * audio[i];
  }
  return Math.sqrt(sumSq / audio.length) / 32768;
}

/** Heartbeat / silence detection. True iff every sample is exactly zero.
 *  Implemented with an early-exit loop (returns on the first non-zero
 *  sample), so content frames typically cost O(1). Equivalent to
 *  `computeRms(audio) === 0` but cheaper on the hot path. */
export function isSilenceFrame(audio: Int16Array): boolean {
  let sumSq = 0;
  for (let i = 0; i < audio.length; i++) {
    const s = audio[i];
    sumSq += s * s;
    if (sumSq !== 0) return false;
  }
  return true;
}

function clampSilenceTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SILENCE_TIMEOUT_MS;
  return Math.max(SILENCE_TIMEOUT_MIN_MS, Math.min(SILENCE_TIMEOUT_MAX_MS, value));
}

/** Shape of the `session` field inside `session.update` for translate.
 *  Per OpenAI cookbook, `output` only accepts `language`; `output_transcript`
 *  events emit by default with no opt-in. */
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

  // Independent state machines for user (input) and assistant (output) sides.
  // Source-language pauses and translation rendering have different natural
  // boundaries (translation often spans multiple input sentences and lags
  // behind), so we segment each side on its own timer rather than coupling
  // them into a pair. See design notes 2026-05-08.
  private currentUserItemId: string | null = null;
  private currentAssistantItemId: string | null = null;
  private userSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  private assistantSilenceTimer: ReturnType<typeof setTimeout> | null = null;
  private userSilenceTimeoutMs: number = SILENCE_TIMEOUT_MS;
  private assistantSilenceTimeoutMs: number = SILENCE_TIMEOUT_MS;
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

  /**
   * Validate the API key and discover available translate models.
   * Reuses OpenAIClient's shared model fetch helper, then filters to
   * gpt-realtime-translate family.
   */
  static async validateApiKeyAndFetchModels(apiKey: string, apiHost?: string): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    const result = await OpenAIClient.fetchOpenAIModelsList(apiKey, apiHost);
    if (result.error) return { validation: result.error, models: [] };

    const filtered = result.models
      .filter((m) => OpenAIClient.isTranslateRealtimeModel(m.id))
      .map((m) => ({ id: m.id, type: 'realtime' as const, created: m.created }))
      .sort((a, b) => b.created - a.created);

    if (filtered.length === 0) {
      return {
        validation: {
          valid: false,
          message: i18n.t('settings.translateModelNotAvailable'),
          validating: false,
          hasRealtimeModel: false,
        },
        models: [],
      };
    }

    return {
      validation: {
        valid: true,
        message: i18n.t('settings.translateModelAvailable'),
        validating: false,
        hasRealtimeModel: true,
      },
      models: filtered,
    };
  }

  // ----- Pairing state machine -----

  private genItemId(): string {
    return `translate_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
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
      if (item.formatted) item.formatted.text = item.formatted.transcript || '';
      this.eventHandlers.onConversationUpdated?.({ item });
    }
    this.currentAssistantItemId = null;
    if (this.assistantSilenceTimer) {
      clearTimeout(this.assistantSilenceTimer);
      this.assistantSilenceTimer = null;
    }
  }

  private handleServerEvent(event: any): void {
    // Pre-decode + measure RMS for output audio so the log shows the
    // amplitude of every frame (heartbeat → 0, content → ~0.04–0.08), and
    // so the case branch below can reuse the decoded buffer without
    // base64-decoding twice.
    let decodedAudio: Int16Array | null = null;
    let audioRms: number | null = null;
    if (event.type === 'session.output_audio.delta' && event.delta) {
      decodedAudio = base64ToInt16Array(event.delta);
      audioRms = computeRms(decodedAudio);
      event.rms = audioRms;
    }

    // Forward to logging handlers, except for pure-silence audio frames
    // (rms === 0) which used to dominate the log with no information.
    // The audio handling switch below still runs for those frames so the
    // silence filter / silence-timer logic is unaffected.
    const isSilentAudioFrame =
      event.type === 'session.output_audio.delta' && audioRms === 0;
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
        const audioData = decodedAudio;

        // The translate API multiplexes two streams over the same socket:
        //   - Zero-amplitude heartbeat frames (historically 200 ms / 4800
        //     samples) that keep the WebSocket alive between/around
        //     utterances.
        //   - Content frames carrying the translated audio.
        // We detect heartbeats by RMS === 0 instead of frame length so we
        // survive any future change to the heartbeat duration. Real speech
        // is rms 0.04–0.08 (commit 98149d35), so the zero check has no
        // false positives on content — even quiet intra-utterance pauses
        // are bundled inside content frames that contain non-zero samples.
        if (audioRms === 0) break;

        // Auto-create the assistant item on the first content frame if
        // session.output_transcript.delta hasn't opened one (e.g. when the
        // API is configured without output transcription, or temporarily
        // stops emitting it). Heartbeat-only streams won't reach here, so
        // this can't spawn phantom items from session-start prelude.
        const assistantItemId = this.currentAssistantItemId ?? this.ensureAssistantItem();
        const assistantItem = this.itemLookup.get(assistantItemId);
        if (!assistantItem) break;

        const sequenceNumber = ++this.deltaSequenceNumber;

        if (!this.audioChunks.has(assistantItemId)) {
          this.audioChunks.set(assistantItemId, []);
        }
        const chunks = this.audioChunks.get(assistantItemId)!;
        chunks.push(audioData);

        // Karaoke segment: anchor current transcript end to cumulative audio
        // time. The translate API delivers transcript and audio as two
        // independent streams (transcript usually leads audio); without an
        // explicit alignment we previously fell back to
        // floor(textLength * progressRatio), which causes the highlight to
        // creep char-by-char and visibly stall at the tail while ratio
        // climbs to 1.0. Recording (textEnd, audioEnd) per chunk lets the
        // segment-based path of getHighlightedChars step the highlight in
        // chunk-aligned units that match the played audio. (issue #216)
        if (assistantItem.formatted) {
          let cumSamples = 0;
          for (const c of chunks) cumSamples += c.length;
          const textLen = assistantItem.formatted.transcript?.length ?? 0;
          if (!assistantItem.formatted.audioSegments) {
            assistantItem.formatted.audioSegments = [];
          }
          assistantItem.formatted.audioSegments.push({
            textEnd: textLen,
            audioEnd: cumSamples / SAMPLE_RATE,
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
        // Content audio is real assistant activity — keep the assistant
        // item open until TTS rendering also winds down, independent of
        // whether more transcripts are still arriving.
        this.resetAssistantSilenceTimer();
        break;
      }

      case 'session.input_transcript.done':
        this.completeUserItem();
        break;
      case 'session.output_transcript.done':
      case 'session.output_audio.done':
        this.completeAssistantItem();
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
    this.currentUserItemId = null;
    this.currentAssistantItemId = null;
    this.userSilenceTimeoutMs = clampSilenceTimeout(config.userSilenceDurationMs);
    this.assistantSilenceTimeoutMs = clampSilenceTimeout(config.assistantSilenceDurationMs);

    const url = `${TRANSLATE_WS_URL}?model=${encodeURIComponent(config.model)}`;
    // The browser WebSocket constructor cannot set Authorization headers.
    // OpenAI accepts auth via the Sec-WebSocket-Protocol subprotocol with the
    // `openai-insecure-api-key.${apiKey}` token. We deliberately omit the
    // `openai-beta.realtime-v1` subprotocol — translate is GA-only, and
    // including the beta tag triggers a server-side rejection
    // ("Translation sessions are only available on the GA API.").
    this.ws = new WebSocket(url, [
      'realtime',
      `openai-insecure-api-key.${this.apiKey}`,
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
    // Finalise any in-flight items so partial transcripts/audio aren't lost
    // when the user ends the session mid-utterance.
    this.completeUserItem();
    this.completeAssistantItem();
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === 1;
  }

  updateSession(config: Partial<SessionConfig>): void {
    if (!this.ws || !isOpenAITranslateSessionConfig(config as SessionConfig)) return;
    const tConfig = config as OpenAITranslateSessionConfig;
    if (tConfig.userSilenceDurationMs !== undefined) {
      this.userSilenceTimeoutMs = clampSilenceTimeout(tConfig.userSilenceDurationMs);
    }
    if (tConfig.assistantSilenceDurationMs !== undefined) {
      this.assistantSilenceTimeoutMs = clampSilenceTimeout(tConfig.assistantSilenceDurationMs);
    }
    const updatePayload = OpenAITranslateGAClient.buildSessionUpdate(tConfig);
    this.ws.send(JSON.stringify(updatePayload));
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: { type: 'session.update', data: updatePayload },
    });
  }

  reset(): void {
    // Cancel both silence timers and drop accumulated state so the client
    // is fresh for the next session.
    if (this.userSilenceTimer) {
      clearTimeout(this.userSilenceTimer);
      this.userSilenceTimer = null;
    }
    if (this.assistantSilenceTimer) {
      clearTimeout(this.assistantSilenceTimer);
      this.assistantSilenceTimer = null;
    }
    this.currentUserItemId = null;
    this.currentAssistantItemId = null;
    this.conversationItems = [];
    this.itemLookup.clear();
    this.audioChunks.clear();
    this.deltaSequenceNumber = 0;
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    const base64 = int16ArrayToBase64(audioData);
    const payload = {
      type: 'session.input_audio_buffer.append' as const,
      audio: base64,
    };
    this.ws.send(JSON.stringify(payload));
    // Forward to log infrastructure so the event timeline shows outgoing
    // audio buffer appends. Base64 payload is redacted by sanitizeEvent
    // (the `audio` key is in AUDIO_FIELD_NAMES). The `rms` annotation is
    // log-only — we send the raw payload above without it, so the wire
    // format stays exactly what the API expects. We skip the log forward
    // for fully-silent frames (rms === 0) because they overwhelmingly
    // dominate the timeline during pre-VAD silence and tell us nothing
    // that the next non-silent frame doesn't already imply. The wire
    // send still happens above — server-side VAD continues to receive
    // silence as expected.
    const rms = computeRms(audioData);
    if (rms === 0) return;
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: payload.type,
        data: { ...payload, rms },
      },
    });
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
export {
  TRANSLATE_WS_URL,
  SILENCE_TIMEOUT_MS,
  SILENCE_TIMEOUT_MIN_MS,
  SILENCE_TIMEOUT_MAX_MS,
  HEARTBEAT_SAMPLES,
};
