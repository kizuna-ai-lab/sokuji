/**
 * Volcengine AST 2.0 Client - Speech-to-Speech (s2s) Translation
 *
 * Uses protobuf binary over WebSocket with simple HTTP header auth.
 * Endpoint: wss://openspeech.bytedance.com/api/v4/ast/v2/translate
 *
 * Platform-specific WebSocket strategies:
 *   - Electron: IPC proxy — main process creates WebSocket with custom headers via Node.js `ws`.
 *   - Extension: declarativeNetRequest — background service worker injects auth headers into
 *     the WebSocket upgrade request, then the side panel opens a plain browser WebSocket.
 *   - Web: fallback — plain WebSocket without auth headers (not expected to work).
 *
 * Protocol flow:
 *   1. Connect WebSocket with auth headers
 *   2. Send StartSession (event=100) with audio config and language pair
 *   3. Wait for SessionStarted (event=150)
 *   4. Send TaskRequest (event=200) with audio binary_data chunks
 *   5. Receive events: SourceSubtitle (650-652), TranslationSubtitle (653-655), TTSResponse (352)
 *   6. Send FinishSession (event=102)
 */

import { v4 as uuidv4 } from 'uuid';
import {
  IClient,
  ConversationItem,
  SessionConfig,
  VolcengineAST2SessionConfig,
  isVolcengineAST2SessionConfig,
  ClientEventHandlers,
  ResponseConfig,
  ApiKeyValidationResult,
  FilteredModel,
} from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import { isElectron, isExtension } from '../../utils/environment';
// @ts-ignore - generated proto file
import { data } from './volcengine-ast2/ast2-proto.js';

const TranslateRequest = data.speech.ast.TranslateRequest;
const TranslateResponse = data.speech.ast.TranslateResponse;
const EventType = data.speech.event.Type;

const WS_ENDPOINT = 'wss://openspeech.bytedance.com/api/v4/ast/v2/translate';

// Output audio sample rate from server
const OUTPUT_SAMPLE_RATE = 16000;

export class VolcengineAST2Client implements IClient {
  private appId: string;
  private accessToken: string;
  private resourceId: string;
  private isConnectedState = false;
  private useIpc = false; // true when running in Electron with IPC proxy
  private websocket: WebSocket | null = null; // only used in non-Electron fallback
  private eventHandlers: ClientEventHandlers = {};
  private conversationItems: ConversationItem[] = [];
  private currentConfig: VolcengineAST2SessionConfig | null = null;
  private sessionId: string = '';
  private connectionId: string = '';
  private sequence: number = 0;
  private itemCounter: number = 0;
  private sessionStartedResolve: (() => void) | null = null;
  private sessionStartedReject: ((error: Error) => void) | null = null;

  // Track current subtitle items for incremental updates
  private currentSourceItemId: string | null = null;
  private currentTranslationItemId: string | null = null;

  // TTS audio accumulation — server sends Ogg Opus chunks that must be
  // concatenated per sentence before decoding
  private ttsChunks: Uint8Array[] = [];
  private decodeContext: AudioContext | null = null;

  constructor(appId: string, accessToken: string, resourceId: string = 'volc.bigasr.sauc.duration') {
    this.appId = appId;
    this.accessToken = accessToken;
    this.resourceId = resourceId;
  }

  private generateItemId(prefix: string): string {
    return `volcengine_ast2_${prefix}_${++this.itemCounter}`;
  }

  // ─── Send binary data to the WebSocket (IPC or browser) ────────────
  private sendData(data: Uint8Array): void {
    if (this.useIpc) {
      // Fire-and-forget send via IPC — errors are logged by main process
      window.electron.invoke('volcengine-ast2-send', data);
    } else if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(data);
    }
  }

  async connect(config: SessionConfig): Promise<void> {
    if (!isVolcengineAST2SessionConfig(config)) {
      throw new Error('[VolcengineAST2Client] Invalid session config');
    }

    this.currentConfig = config;
    this.sessionId = uuidv4();
    this.connectionId = uuidv4();
    this.sequence = 0;
    this.itemCounter = 0;
    this.currentSourceItemId = null;
    this.currentTranslationItemId = null;

    if (isElectron() && window.electron?.invoke) {
      return this.connectViaIpc();
    }
    if (isExtension()) {
      return this.connectViaExtensionDNR();
    }
    return this.connectViaBrowserWebSocket();
  }

  // ─── Electron IPC path ──────────────────────────────────────────────
  private async connectViaIpc(): Promise<void> {
    this.useIpc = true;

    return new Promise(async (resolve, reject) => {
      try {
        // Register IPC listeners BEFORE connecting so we don't miss early messages
        window.electron.receive('volcengine-ast2-message', (data: Buffer | Uint8Array) => {
          // Data arrives as Buffer from main process — convert to ArrayBuffer
          const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
          this.handleMessage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        });

        window.electron.receive('volcengine-ast2-error', (errMsg: string) => {
          console.error('[VolcengineAST2Client] IPC WebSocket error:', errMsg);
          this.eventHandlers.onError?.(new Error(errMsg));
        });

        window.electron.receive('volcengine-ast2-close', (evt: { code: number; reason: string }) => {
          console.log('[VolcengineAST2Client] IPC WebSocket closed:', evt.code, evt.reason);
          this.isConnectedState = false;

          this.eventHandlers.onRealtimeEvent?.({
            source: 'client',
            event: {
              type: 'session.closed',
              data: {
                status: 'disconnected',
                provider: 'volcengine_ast2',
                timestamp: Date.now(),
                code: evt.code,
                reason: evt.reason,
              }
            }
          });

          this.eventHandlers.onClose?.(evt);
        });

        // Ask main process to create the WebSocket with custom headers
        const result = await window.electron.invoke('volcengine-ast2-connect', {
          appId: this.appId,
          accessToken: this.accessToken,
          resourceId: this.resourceId,
          connectionId: this.connectionId,
        });

        if (!result?.success) {
          this.cleanupIpcListeners();
          reject(new Error(result?.error || 'Failed to connect Volcengine AST2 WebSocket'));
          return;
        }

        console.log('[VolcengineAST2Client] IPC WebSocket connected');
        this.isConnectedState = true;

        this.eventHandlers.onRealtimeEvent?.({
          source: 'client',
          event: {
            type: 'session.created',
            data: { status: 'connected', provider: 'volcengine_ast2', timestamp: Date.now() }
          }
        });

        // Wait for SessionStarted before resolving
        this.sessionStartedResolve = () => {
          this.eventHandlers.onOpen?.();
          resolve();
        };
        this.sessionStartedReject = reject;

        // Send StartSession
        this.sendStartSession();
      } catch (error) {
        console.error('[VolcengineAST2Client] IPC connection error:', error);
        this.cleanupIpcListeners();
        reject(error);
      }
    });
  }

  private cleanupIpcListeners(): void {
    if (window.electron?.removeAllListeners) {
      window.electron.removeAllListeners('volcengine-ast2-message');
      window.electron.removeAllListeners('volcengine-ast2-error');
      window.electron.removeAllListeners('volcengine-ast2-close');
    }
  }

  // ─── Extension path: declarativeNetRequest injects headers ─────────
  private async connectViaExtensionDNR(): Promise<void> {
    this.useIpc = false;

    // Ask background service worker to register DNR rules that inject
    // auth headers into the WebSocket upgrade request
    const dnrResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      chrome!.runtime.sendMessage(
        {
          type: 'VOLCENGINE_AST2_SET_HEADERS',
          credentials: {
            appKey: this.appId,
            accessKey: this.accessToken,
            resourceId: this.resourceId,
            connectId: this.connectionId,
          },
        },
        (response: { success: boolean; error?: string }) => {
          if (chrome!.runtime.lastError) {
            resolve({ success: false, error: chrome!.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: 'No response from background' });
          }
        }
      );
    });

    if (!dnrResult.success) {
      throw new Error(`Failed to set DNR headers: ${dnrResult.error}`);
    }

    // Now open a plain browser WebSocket — DNR rules will inject the auth headers
    return this.connectViaBrowserWebSocket();
  }

  // ─── Browser WebSocket fallback (no custom headers — may not auth) ─
  private connectViaBrowserWebSocket(): Promise<void> {
    this.useIpc = false;

    return new Promise((resolve, reject) => {
      try {
        this.websocket = new WebSocket(WS_ENDPOINT);
        this.websocket.binaryType = 'arraybuffer';

        this.websocket.onopen = () => {
          console.log('[VolcengineAST2Client] WebSocket connected');
          this.isConnectedState = true;

          this.eventHandlers.onRealtimeEvent?.({
            source: 'client',
            event: {
              type: 'session.created',
              data: { status: 'connected', provider: 'volcengine_ast2', timestamp: Date.now() }
            }
          });

          // Send StartSession
          this.sendStartSession();
        };

        this.websocket.onmessage = (event) => {
          this.handleMessage(event.data as ArrayBuffer);
        };

        this.websocket.onerror = (error) => {
          console.error('[VolcengineAST2Client] WebSocket error:', error);
          this.eventHandlers.onError?.(error);
          reject(error);
        };

        this.websocket.onclose = (event) => {
          console.log('[VolcengineAST2Client] WebSocket closed:', event.code, event.reason);
          this.isConnectedState = false;

          this.eventHandlers.onRealtimeEvent?.({
            source: 'client',
            event: {
              type: 'session.closed',
              data: {
                status: 'disconnected',
                provider: 'volcengine_ast2',
                timestamp: Date.now(),
                code: event.code,
                reason: event.reason,
              }
            }
          });

          this.eventHandlers.onClose?.(event);
        };

        // Wait for SessionStarted before resolving
        this.sessionStartedResolve = () => {
          this.eventHandlers.onOpen?.();
          resolve();
        };
        this.sessionStartedReject = reject;

      } catch (error) {
        console.error('[VolcengineAST2Client] Connection error:', error);
        reject(error);
      }
    });
  }

  private sendStartSession(): void {
    if (!this.currentConfig) return;
    if (!this.useIpc && (!this.websocket || this.websocket.readyState !== WebSocket.OPEN)) return;

    const request = TranslateRequest.encode({
      requestMeta: {
        Endpoint: 'volc.bigasr.sauc.duration',
        AppKey: this.appId,
        ResourceID: this.resourceId,
        ConnectionID: this.connectionId,
        SessionID: this.sessionId,
        Sequence: this.sequence++,
      },
      event: EventType.StartSession,
      user: {
        uid: 'sokuji-user',
        platform: 'web',
      },
      sourceAudio: {
        format: 'pcm',
        rate: 16000,
        bits: 16,
        channel: 1,
      },
      targetAudio: {
        format: 'ogg_opus',
        rate: OUTPUT_SAMPLE_RATE,
      },
      request: {
        mode: 's2s',
        sourceLanguage: this.currentConfig.sourceLanguage,
        targetLanguage: this.currentConfig.targetLanguage,
      },
    }).finish();

    this.sendData(request);

    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'start_session.sent',
        data: {
          sessionId: this.sessionId,
          sourceLanguage: this.currentConfig.sourceLanguage,
          targetLanguage: this.currentConfig.targetLanguage,
          mode: 's2s',
        }
      }
    });
  }

  private handleMessage(data: ArrayBuffer): void {
    try {
      const response = TranslateResponse.decode(new Uint8Array(data));
      const eventType: number = response.event;

      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: {
          type: EventType[eventType] || `message.${eventType}`,
          data: {
            event: eventType,
            eventName: EventType[eventType] || `unknown(${eventType})`,
            text: response.text || undefined,
            hasAudioData: !!(response.data && response.data.length > 0),
            audioDataLength: response.data?.length || 0,
            sessionId: response.responseMeta?.SessionID,
            statusCode: response.responseMeta?.StatusCode,
          }
        }
      });

      // Check for error status — Volcengine uses 20000000 as the success code (like HTTP 200)
      const statusCode = response.responseMeta?.StatusCode;
      if (statusCode && statusCode !== 0 && statusCode !== 20000000) {
        const errorMsg = response.responseMeta?.Message || `Status code: ${response.responseMeta?.StatusCode}`;
        console.error('[VolcengineAST2Client] Server error:', errorMsg);

        if (this.sessionStartedReject) {
          this.sessionStartedReject(new Error(errorMsg));
          this.sessionStartedResolve = null;
          this.sessionStartedReject = null;
        }

        const errorItem: ConversationItem = {
          id: this.generateItemId('error'),
          role: 'system',
          type: 'error',
          status: 'completed',
          formatted: { text: `[Error] ${errorMsg}` },
          content: [{ type: 'text', text: errorMsg }]
        };
        this.conversationItems.push(errorItem);
        this.eventHandlers.onConversationUpdated?.({ item: errorItem });
        return;
      }

      switch (eventType) {
        case EventType.SessionStarted:
          this.handleSessionStarted();
          break;

        case EventType.SessionFinished:
          console.log('[VolcengineAST2Client] Session finished');
          break;

        case EventType.SessionFailed:
          console.error('[VolcengineAST2Client] Session failed:', response.responseMeta?.Message);
          if (this.sessionStartedReject) {
            this.sessionStartedReject(new Error(response.responseMeta?.Message || 'Session failed'));
            this.sessionStartedResolve = null;
            this.sessionStartedReject = null;
          }
          break;

        // Source (original) language subtitle events
        case EventType.SourceSubtitleStart:
          this.handleSourceSubtitle(response, 'start');
          break;
        case EventType.SourceSubtitleResponse:
          this.handleSourceSubtitle(response, 'response');
          break;
        case EventType.SourceSubtitleEnd:
          this.handleSourceSubtitle(response, 'end');
          break;

        // Translation subtitle events
        case EventType.TranslationSubtitleStart:
          this.handleTranslationSubtitle(response, 'start');
          break;
        case EventType.TranslationSubtitleResponse:
          this.handleTranslationSubtitle(response, 'response');
          break;
        case EventType.TranslationSubtitleEnd:
          this.handleTranslationSubtitle(response, 'end');
          break;

        // TTS audio response
        case EventType.TTSResponse:
          this.handleTTSResponse(response);
          break;

        // TTS lifecycle
        case EventType.TTSSentenceStart:
          this.ttsChunks = [];
          break;
        case EventType.TTSSentenceEnd:
          this.decodeTTSAndPlay();
          break;
        case EventType.TTSEnded:
          // Flush any remaining chunks
          if (this.ttsChunks.length > 0) {
            this.decodeTTSAndPlay();
          }
          break;

        // Informational events — no action needed
        case EventType.UsageResponse:  // billing/usage data
        case EventType.AudioMuted:     // mic silence detected by server
          break;

        default:
          // Log unknown events for debugging
          if (eventType !== EventType.None) {
            console.log(`[VolcengineAST2Client] Unhandled event: ${EventType[eventType] || eventType}`);
          }
          break;
      }
    } catch (error) {
      console.error('[VolcengineAST2Client] Error parsing message:', error);
    }
  }

  private handleSessionStarted(): void {
    console.log('[VolcengineAST2Client] Session started successfully');

    if (this.sessionStartedResolve) {
      this.sessionStartedResolve();
      this.sessionStartedResolve = null;
      this.sessionStartedReject = null;
    }
  }

  private handleSourceSubtitle(response: any, phase: 'start' | 'response' | 'end'): void {
    const text = response.text || '';
    const isDefinite = phase === 'end';

    if (phase === 'start') {
      // New source subtitle segment - create new item
      this.currentSourceItemId = this.generateItemId('source');
    }

    const itemId = this.currentSourceItemId || this.generateItemId('source');

    const item: ConversationItem = {
      id: itemId,
      role: 'user',
      type: 'message',
      status: isDefinite ? 'completed' : 'in_progress',
      createdAt: Date.now(),
      formatted: { text, transcript: text },
      content: [{ type: 'text', text }]
    };

    if (isDefinite) {
      this.conversationItems.push(item);
      this.currentSourceItemId = null;
    }

    this.eventHandlers.onConversationUpdated?.({
      item,
      delta: {
        text,
        definite: isDefinite,
        language: this.currentConfig?.sourceLanguage,
        startTime: response.startTime,
        endTime: response.endTime,
      }
    });
  }

  private handleTranslationSubtitle(response: any, phase: 'start' | 'response' | 'end'): void {
    const text = response.text || '';
    const isDefinite = phase === 'end';

    if (phase === 'start') {
      // New translation subtitle segment - create new item
      this.currentTranslationItemId = this.generateItemId('translation');
    }

    const itemId = this.currentTranslationItemId || this.generateItemId('translation');

    const item: ConversationItem = {
      id: itemId,
      role: 'assistant',
      type: 'message',
      status: isDefinite ? 'completed' : 'in_progress',
      createdAt: Date.now(),
      formatted: { text, transcript: text },
      content: [{ type: 'text', text }]
    };

    if (isDefinite) {
      this.conversationItems.push(item);
      this.currentTranslationItemId = null;
    }

    this.eventHandlers.onConversationUpdated?.({
      item,
      delta: {
        text,
        definite: isDefinite,
        language: this.currentConfig?.targetLanguage,
        startTime: response.startTime,
        endTime: response.endTime,
      }
    });
  }

  private handleTTSResponse(response: any): void {
    if (!response.data || response.data.length === 0) return;

    // response.data is a Uint8Array VIEW into the shared protobuf decode
    // buffer — copy it before the buffer is reused on the next message.
    const chunk = new Uint8Array(response.data.length);
    chunk.set(response.data);
    this.ttsChunks.push(chunk);
  }

  /**
   * Concatenate accumulated Ogg Opus chunks, decode to PCM via Web Audio API,
   * and emit the resulting Int16Array through the normal audio pipeline.
   */
  private async decodeTTSAndPlay(): Promise<void> {
    if (this.ttsChunks.length === 0) return;

    // Concatenate all chunks into a single Ogg Opus blob
    const totalLength = this.ttsChunks.reduce((sum, c) => sum + c.length, 0);
    const opusData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of this.ttsChunks) {
      opusData.set(chunk, offset);
      offset += chunk.length;
    }
    this.ttsChunks = [];

    try {
      // Lazily create a reusable AudioContext for decoding
      if (!this.decodeContext || this.decodeContext.state === 'closed') {
        this.decodeContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      }

      const audioBuffer = await this.decodeContext.decodeAudioData(opusData.buffer);
      const float32 = audioBuffer.getChannelData(0);

      // Convert Float32 [-1,1] → Int16 for the existing audio pipeline
      const int16Array = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      const itemId = this.currentTranslationItemId || this.generateItemId('tts_audio');
      const item: ConversationItem = {
        id: itemId,
        role: 'assistant',
        type: 'message',
        status: 'in_progress',
        createdAt: Date.now(),
        formatted: { audio: int16Array },
        content: [{ type: 'audio' }]
      };

      this.eventHandlers.onConversationUpdated?.({
        item,
        delta: { audio: int16Array }
      });
    } catch (error) {
      console.error('[VolcengineAST2Client] Failed to decode TTS Opus audio:', error);
    }
  }

  async disconnect(): Promise<void> {
    // Send FinishSession before closing
    try {
      const request = TranslateRequest.encode({
        requestMeta: {
          SessionID: this.sessionId,
          ConnectionID: this.connectionId,
          Sequence: this.sequence++,
        },
        event: EventType.FinishSession,
      }).finish();

      this.sendData(request);
    } catch (e) {
      // Ignore send errors during disconnect
    }

    if (this.useIpc) {
      // Disconnect the main-process WebSocket and clean up IPC listeners
      try {
        await window.electron.invoke('volcengine-ast2-disconnect');
      } catch (e) {
        // Ignore cleanup errors
      }
      this.cleanupIpcListeners();
    } else if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    // Clean up DNR rules in extension context
    if (isExtension()) {
      try {
        chrome!.runtime.sendMessage({ type: 'VOLCENGINE_AST2_CLEAR_HEADERS' });
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    this.isConnectedState = false;
    this.ttsChunks = [];

    // Close the decode AudioContext
    if (this.decodeContext) {
      try { this.decodeContext.close(); } catch (e) { /* ignore */ }
      this.decodeContext = null;
    }

    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'session.closed',
        data: {
          status: 'disconnected',
          provider: 'volcengine_ast2',
          timestamp: Date.now(),
          reason: 'client_disconnect'
        }
      }
    });

    this.eventHandlers.onClose?.({});
  }

  isConnected(): boolean {
    if (this.useIpc) {
      return this.isConnectedState;
    }
    return this.isConnectedState && this.websocket?.readyState === WebSocket.OPEN;
  }

  updateSession(config: Partial<SessionConfig>): void {
    console.warn('[VolcengineAST2Client] Session updates are not supported. Reconnect to change configuration.');
  }

  reset(): void {
    this.conversationItems = [];
    this.sequence = 0;
    this.currentSourceItemId = null;
    this.currentTranslationItemId = null;
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.isConnectedState) {
      return;
    }

    // Convert Int16Array to raw bytes for protobuf binary_data field
    const rawBytes = new Uint8Array(audioData.buffer, audioData.byteOffset, audioData.byteLength);

    const request = TranslateRequest.encode({
      requestMeta: {
        SessionID: this.sessionId,
        ConnectionID: this.connectionId,
        Sequence: this.sequence++,
      },
      event: EventType.TaskRequest,
      sourceAudio: {
        binaryData: rawBytes,
      },
    }).finish();

    this.sendData(request);
  }

  appendInputText(text: string): void {
    console.warn('[VolcengineAST2Client] Text input is not supported for speech translation');
  }

  createResponse(config?: ResponseConfig): void {
    // Volcengine automatically generates responses when audio is received
  }

  cancelResponse(trackId?: string, offset?: number): void {
    console.warn('[VolcengineAST2Client] Cancel response is not supported');
  }

  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = { ...handlers };
  }

  getProvider(): ProviderType {
    return Provider.VOLCENGINE_AST2;
  }

  /**
   * Validate API credentials
   * In Electron: performs a real WebSocket connect-disconnect to verify credentials with the server.
   * In browser: format-only check (browser WebSocket API can't send custom headers).
   */
  static async validateApiKeyAndFetchModels(
    appId: string,
    accessToken: string
  ): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    // Simple format validation — coerce to string since numeric IDs from storage may arrive as numbers
    const appIdStr = String(appId ?? '');
    const accessTokenStr = String(accessToken ?? '');
    if (!appIdStr || appIdStr.trim().length === 0) {
      return {
        validation: { valid: false, message: 'APP ID is required', validating: false },
        models: []
      };
    }
    if (!accessTokenStr || accessTokenStr.trim().length === 0) {
      return {
        validation: { valid: false, message: 'Access Token is required', validating: false },
        models: []
      };
    }

    const models: FilteredModel[] = [{
      id: 'ast-v2-s2s',
      type: 'realtime',
      created: Date.now() / 1000
    }];

    // In Electron, perform real credential validation via IPC WebSocket proxy
    if (isElectron() && window.electron?.invoke) {
      try {
        const result = await window.electron.invoke('volcengine-ast2-validate', {
          appId: appIdStr.trim(),
          accessToken: accessTokenStr.trim(),
          resourceId: 'volc.bigasr.sauc.duration',
        });
        if (result?.success) {
          return {
            validation: { valid: true, message: 'API credentials verified', validating: false },
            models,
          };
        }
        return {
          validation: {
            valid: false,
            message: result?.error || 'Credential verification failed',
            validating: false,
          },
          models: [],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Credential verification failed';
        return {
          validation: { valid: false, message, validating: false },
          models: [],
        };
      }
    }

    // Extension: real validation via DNR header injection + WebSocket connect-disconnect
    if (isExtension()) {
      try {
        const connectionId = uuidv4();

        // Register DNR rules for this validation attempt
        const dnrResult = await new Promise<{ success: boolean; error?: string }>((resolve) => {
          chrome!.runtime.sendMessage(
            {
              type: 'VOLCENGINE_AST2_SET_HEADERS',
              credentials: {
                appKey: appIdStr.trim(),
                accessKey: accessTokenStr.trim(),
                resourceId: 'volc.bigasr.sauc.duration',
                connectId: connectionId,
              },
            },
            (response: { success: boolean; error?: string }) => {
              if (chrome!.runtime.lastError) {
                resolve({ success: false, error: chrome!.runtime.lastError.message });
              } else {
                resolve(response || { success: false, error: 'No response' });
              }
            }
          );
        });

        if (!dnrResult.success) {
          return {
            validation: { valid: false, message: `DNR setup failed: ${dnrResult.error}`, validating: false },
            models: [],
          };
        }

        // Try to connect a WebSocket — DNR rules will inject auth headers
        const validationResult = await new Promise<{ valid: boolean; message: string }>((resolve) => {
          const timeout = setTimeout(() => {
            ws.close();
            resolve({ valid: false, message: 'Connection timeout' });
          }, 8000);

          const ws = new WebSocket(WS_ENDPOINT);
          ws.binaryType = 'arraybuffer';

          ws.onopen = () => {
            // Connection accepted — server recognized the auth headers
            clearTimeout(timeout);

            // Send a minimal StartSession to fully verify credentials
            const sessionId = uuidv4();
            const startReq = TranslateRequest.encode({
              requestMeta: {
                Endpoint: 'volc.bigasr.sauc.duration',
                AppKey: appIdStr.trim(),
                ResourceID: 'volc.bigasr.sauc.duration',
                ConnectionID: connectionId,
                SessionID: sessionId,
                Sequence: 0,
              },
              event: EventType.StartSession,
              user: { uid: 'validation', platform: 'extension' },
              sourceAudio: { format: 'pcm', rate: 16000, bits: 16, channel: 1 },
              targetAudio: { format: 'pcm', rate: 24000, bits: 16, channel: 1 },
              request: { mode: 's2s', sourceLanguage: 'zh', targetLanguage: 'en' },
            }).finish();
            ws.send(startReq);
          };

          ws.onmessage = (evt) => {
            try {
              const response = TranslateResponse.decode(new Uint8Array(evt.data as ArrayBuffer));
              const statusCode = response.responseMeta?.StatusCode;

              if (statusCode && statusCode !== 0 && statusCode !== 20000000) {
                clearTimeout(timeout);
                ws.close();
                resolve({ valid: false, message: response.responseMeta?.Message || `Error: ${statusCode}` });
              } else if (response.event === EventType.SessionStarted) {
                clearTimeout(timeout);
                // Send FinishSession then close
                const finishReq = TranslateRequest.encode({
                  requestMeta: { ConnectionID: connectionId, Sequence: 1 },
                  event: EventType.FinishSession,
                }).finish();
                ws.send(finishReq);
                setTimeout(() => ws.close(), 300);
                resolve({ valid: true, message: 'API credentials verified' });
              }
            } catch (e) {
              // Continue waiting for more messages
            }
          };

          ws.onerror = () => {
            clearTimeout(timeout);
            resolve({ valid: false, message: 'Connection failed — credentials may be invalid' });
          };
        });

        // Clean up DNR rules after validation
        chrome!.runtime.sendMessage({ type: 'VOLCENGINE_AST2_CLEAR_HEADERS' });

        return {
          validation: { ...validationResult, validating: false },
          models: validationResult.valid ? models : [],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Credential verification failed';
        return {
          validation: { valid: false, message, validating: false },
          models: [],
        };
      }
    }

    // Web fallback: format-only check (WebSocket API can't send custom headers)
    return {
      validation: {
        valid: true,
        message: 'Credentials format valid (will be verified on connection)',
        validating: false,
      },
      models,
    };
  }
}
