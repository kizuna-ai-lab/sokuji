/**
 * OpenAIGAClient
 *
 * OpenAI Realtime API client using the official 'openai' SDK (GA).
 * Uses OpenAIRealtimeWebSocket which does NOT send the beta header.
 *
 * This client is used for direct OpenAI connections only.
 * OpenAI Compatible and Kizuna AI providers continue to use OpenAIClient (beta).
 */

import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';
import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  OpenAISessionConfig,
  isOpenAISessionConfig,
  ApiKeyValidationResult,
  FilteredModel,
  ResponseConfig
} from '../interfaces/IClient';
import type { EventData } from '../../stores/logStore';
import { Provider, ProviderType } from '../../types/Provider';
import { unwrapTranslationText } from '../../utils/textUtils';
import { OpenAIClient } from './OpenAIClient';

/**
 * OpenAI Realtime API client using the official SDK (GA protocol)
 * Implements the IClient interface for OpenAI's GA Realtime API
 */
export class OpenAIGAClient implements IClient {
  private rt: OpenAIRealtimeWebSocket | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private apiKey: string;
  private deltaSequenceNumber: number = 0;
  private itemCreatedAtMap: Map<string, number> = new Map();

  // Manual conversation tracking (same pattern as OpenAIWebRTCClient)
  private conversationItems: ConversationItem[] = [];
  private itemLookup: Map<string, ConversationItem> = new Map();
  private connected: boolean = false;
  private turnDetectionDisabled: boolean = false;
  // Track out-of-band response IDs (conversation_id === null) to filter from UI
  private outOfBandResponseIds: Set<string> = new Set();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Validate API key and fetch available models (delegates to OpenAIClient static methods)
   */
  static async validateApiKeyAndFetchModels(apiKey: string): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    return OpenAIClient.validateApiKeyAndFetchModels(apiKey);
  }

  /**
   * Get the latest realtime model from the filtered models
   */
  static getLatestRealtimeModel(filteredModels: FilteredModel[]): string {
    return OpenAIClient.getLatestRealtimeModel(filteredModels);
  }

  async connect(config: SessionConfig): Promise<void> {
    if (!isOpenAISessionConfig(config)) {
      throw new Error('OpenAIGAClient requires OpenAI session config');
    }

    // Reset state for new session
    this.deltaSequenceNumber = 0;
    this.itemCreatedAtMap.clear();
    this.conversationItems = [];
    this.itemLookup.clear();
    this.turnDetectionDisabled = false;
    this.outOfBandResponseIds.clear();

    // Create the official SDK WebSocket client
    this.rt = new OpenAIRealtimeWebSocket({
      model: config.model,
      dangerouslyAllowBrowser: true
    }, {
      apiKey: this.apiKey,
      baseURL: 'https://api.openai.com/v1'
    });

    // Set up event listeners
    this.setupEventListeners();

    // Wait for session creation with timeout
    await this.waitForSessionCreated();

    // Send session configuration
    this.sendSessionUpdate(config);

    // Emit session opened event
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'session.opened',
        data: {
          status: 'connected',
          provider: 'openai',
          model: config.model,
          timestamp: Date.now(),
          voice: config.voice,
          temperature: config.temperature,
          protocol: 'ga'
        }
      }
    });

    this.connected = true;
    this.eventHandlers.onOpen?.();
  }

  /**
   * Wait for session.created event with timeout and error handling
   */
  private waitForSessionCreated(): Promise<void> {
    const SESSION_TIMEOUT = 30000;

    return new Promise<void>((resolve, reject) => {
      if (!this.rt) {
        reject(new Error('WebSocket client not initialized'));
        return;
      }

      let isSettled = false;

      const timeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          reject(new Error('Session creation timeout - server did not respond in time'));
        }
      }, SESSION_TIMEOUT);

      this.rt.on('session.created', () => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeout);
          resolve();
        }
      });

      this.rt.on('error', (err: any) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeout);
          reject(new Error(err?.message || 'Connection failed'));
        }
      });

      // Handle WebSocket close before session is created
      this.rt!.socket.addEventListener('close', (event) => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeout);
          reject(new Error(`WebSocket closed before session created: ${event.code} ${event.reason}`));
        }
      });
    });
  }

  /**
   * Set up all event listeners on the GA WebSocket client
   */
  private setupEventListeners(): void {
    if (!this.rt) return;

    // Session events
    this.rt.on('session.created', (event) => {
      this.forwardServerEvent('session.created', event);
    });

    this.rt.on('session.updated', (event) => {
      this.forwardServerEvent('session.updated', event);
    });

    // Conversation item events
    this.rt.on('conversation.item.created', (event) => {
      this.handleItemCreated(event);
      this.forwardServerEvent('conversation.item.created', event);
    });

    this.rt.on('conversation.item.deleted', (event) => {
      this.forwardServerEvent('conversation.item.deleted', event);
    });

    this.rt.on('conversation.item.truncated', (event) => {
      this.forwardServerEvent('conversation.item.truncated', event);
    });

    // Input audio transcription
    this.rt.on('conversation.item.input_audio_transcription.completed', (event) => {
      this.handleInputTranscriptionCompleted(event);
      this.forwardServerEvent('conversation.item.input_audio_transcription.completed', event);
    });

    this.rt.on('conversation.item.input_audio_transcription.failed', (event) => {
      this.forwardServerEvent('conversation.item.input_audio_transcription.failed', event);
    });

    // Input audio buffer events
    // When audio buffer is committed, create a user conversation item
    this.rt.on('input_audio_buffer.committed', (event) => {
      this.handleUserItemCreated(event);
      this.forwardServerEvent('input_audio_buffer.committed', event);
    });

    this.rt.on('input_audio_buffer.cleared', (event) => {
      this.forwardServerEvent('input_audio_buffer.cleared', event);
    });

    this.rt.on('input_audio_buffer.speech_started', (event) => {
      this.eventHandlers.onConversationInterrupted?.();
      this.forwardServerEvent('input_audio_buffer.speech_started', event);
    });

    this.rt.on('input_audio_buffer.speech_stopped', (event) => {
      this.forwardServerEvent('input_audio_buffer.speech_stopped', event);
    });

    // GA text output events
    this.rt.on('response.output_text.delta', (event) => {
      this.handleTextDelta(event);
      this.forwardServerEvent('response.output_text.delta', event);
    });

    this.rt.on('response.output_text.done', (event) => {
      this.handleTextDone(event);
      this.forwardServerEvent('response.output_text.done', event);
    });

    // GA audio output events
    this.rt.on('response.output_audio.delta', (event) => {
      this.handleAudioDelta(event);
      this.forwardServerEvent('response.output_audio.delta', event);
    });

    this.rt.on('response.output_audio.done', (event) => {
      this.forwardServerEvent('response.output_audio.done', event);
    });

    // GA audio transcript events
    this.rt.on('response.output_audio_transcript.delta', (event) => {
      this.handleTranscriptDelta(event);
      this.forwardServerEvent('response.output_audio_transcript.delta', event);
    });

    this.rt.on('response.output_audio_transcript.done', (event) => {
      this.handleTranscriptDone(event);
      this.forwardServerEvent('response.output_audio_transcript.done', event);
    });

    // Response lifecycle events
    this.rt.on('response.created', (event) => {
      // Track out-of-band responses (conversation_id === null) — these are anchor
      // messages that should not appear in the conversation UI
      const response = (event as any).response;
      if (response?.id && response?.conversation_id === null) {
        this.outOfBandResponseIds.add(response.id);
      }
      this.forwardServerEvent('response.created', event);
    });

    this.rt.on('response.done', (event) => {
      this.handleResponseDone(event);
      this.forwardServerEvent('response.done', event);
    });

    // Response content structure events
    // GA API uses response.output_item.added instead of conversation.item.created
    // for assistant response items — skip out-of-band (anchor) responses
    this.rt.on('response.output_item.added', (event) => {
      const responseId = (event as any).response_id;
      if (!this.outOfBandResponseIds.has(responseId)) {
        this.handleItemCreated(event);
      }
      this.forwardServerEvent('response.output_item.added', event);
    });

    this.rt.on('response.output_item.done', (event) => {
      this.forwardServerEvent('response.output_item.done', event);
    });

    this.rt.on('response.content_part.added', (event) => {
      this.forwardServerEvent('response.content_part.added', event);
    });

    this.rt.on('response.content_part.done', (event) => {
      this.forwardServerEvent('response.content_part.done', event);
    });

    // Function calling events
    this.rt.on('response.function_call_arguments.delta', (event) => {
      this.forwardServerEvent('response.function_call_arguments.delta', event);
    });

    this.rt.on('response.function_call_arguments.done', (event) => {
      this.forwardServerEvent('response.function_call_arguments.done', event);
    });

    // Rate limits
    this.rt.on('rate_limits.updated', (event) => {
      this.forwardServerEvent('rate_limits.updated', event);
    });

    // Error handling
    this.rt.on('error', (err: any) => {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: {
          type: 'error',
          data: err
        }
      });

      // Create error ConversationItem for display in UI
      const errorType = err?.error?.type || err?.type || 'error';
      const errorMessage = err?.error?.message || err?.message || 'Unknown error';
      const errorItem: ConversationItem = {
        id: `error_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        role: 'system',
        type: 'error',
        status: 'completed',
        formatted: {
          text: `[${errorType}] ${errorMessage}`,
        },
        content: [{
          type: 'text',
          text: errorMessage
        }]
      };

      this.eventHandlers.onConversationUpdated?.({ item: errorItem });
      this.eventHandlers.onError?.(err);
    });

    // WebSocket close
    this.rt.socket.addEventListener('close', () => {
      if (this.connected) {
        this.connected = false;
        this.eventHandlers.onRealtimeEvent?.({
          source: 'client',
          event: {
            type: 'session.closed',
            data: {
              status: 'disconnected',
              provider: 'openai',
              timestamp: Date.now(),
              reason: 'websocket_closed'
            }
          }
        });
        this.eventHandlers.onClose?.({});
      }
    });
  }

  /**
   * Forward a server event to the logging system
   */
  private forwardServerEvent(type: EventData['type'], event: any): void {
    this.eventHandlers.onRealtimeEvent?.({
      source: 'server',
      event: {
        type,
        data: event
      }
    });
  }

  /**
   * Handle conversation.item.created event
   */
  private handleItemCreated(event: any): void {
    const item = event.item;
    if (!item) return;

    const createdAt = Date.now();
    this.itemCreatedAtMap.set(item.id, createdAt);

    const conversationItem: ConversationItem = {
      id: item.id,
      role: item.role || 'assistant',
      type: item.type || 'message',
      status: item.status || 'in_progress',
      createdAt,
      formatted: {
        text: '',
        transcript: ''
      },
      content: item.content || []
    };

    // Track current assistant response item
    // (Not currently needed since audio uses item_id, but kept for consistency
    // with WebRTC client pattern)

    this.conversationItems.push(conversationItem);
    this.itemLookup.set(item.id, conversationItem);
    this.eventHandlers.onConversationUpdated?.({ item: conversationItem });
  }

  /**
   * Handle user item creation from input_audio_buffer.committed
   * GA API doesn't emit conversation.item.created for user audio items,
   * so we create a user ConversationItem when the audio buffer is committed.
   */
  private handleUserItemCreated(event: any): void {
    const itemId = event.item_id;
    if (!itemId || this.itemLookup.has(itemId)) return;

    const createdAt = Date.now();
    this.itemCreatedAtMap.set(itemId, createdAt);

    const conversationItem: ConversationItem = {
      id: itemId,
      role: 'user',
      type: 'message',
      status: 'in_progress',
      createdAt,
      formatted: {
        text: '',
        transcript: ''
      },
      content: []
    };

    this.conversationItems.push(conversationItem);
    this.itemLookup.set(itemId, conversationItem);
    this.eventHandlers.onConversationUpdated?.({ item: conversationItem });
  }

  /**
   * Handle response.output_text.delta (GA event)
   */
  private handleTextDelta(event: any): void {
    const itemId = event.item_id;
    const delta = event.delta;
    if (!itemId || !delta) return;

    const item = this.itemLookup.get(itemId);
    if (!item) return;

    if (item.formatted) {
      item.formatted.text = (item.formatted.text || '') + delta;
    }

    this.eventHandlers.onConversationUpdated?.({
      item,
      delta: { transcript: delta }
    });
  }

  /**
   * Handle response.output_text.done (GA event)
   */
  private handleTextDone(event: any): void {
    const itemId = event.item_id;
    const text = event.text;
    if (!itemId) return;

    const item = this.itemLookup.get(itemId);
    if (!item) return;

    if (item.formatted && text) {
      const cleaned = unwrapTranslationText(text);
      item.formatted.text = cleaned;
    }

    this.eventHandlers.onConversationUpdated?.({ item });
  }

  /**
   * Handle response.output_audio.delta (GA event)
   * Decode base64 audio to Int16Array and emit as delta
   */
  private handleAudioDelta(event: any): void {
    const itemId = event.item_id;
    const audioBase64 = event.delta;
    if (!itemId || !audioBase64) return;

    const item = this.itemLookup.get(itemId);
    if (!item) return;

    const audioData = base64ToInt16Array(audioBase64);
    const sequenceNumber = ++this.deltaSequenceNumber;

    this.eventHandlers.onConversationUpdated?.({
      item: {
        ...item,
        formatted: {
          ...item.formatted,
          audio: audioData
        }
      },
      delta: {
        audio: audioData,
        sequenceNumber,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Handle response.output_audio_transcript.delta (GA event)
   */
  private handleTranscriptDelta(event: any): void {
    const itemId = event.item_id;
    const delta = event.delta;
    if (!itemId || !delta) return;

    const item = this.itemLookup.get(itemId);
    if (!item) return;

    if (item.formatted) {
      item.formatted.transcript = (item.formatted.transcript || '') + delta;
      // Also update text to show transcript when text output isn't available
      if (!item.formatted.text) {
        item.formatted.text = item.formatted.transcript;
      }
    }

    this.eventHandlers.onConversationUpdated?.({
      item,
      delta: { transcript: delta }
    });
  }

  /**
   * Handle response.output_audio_transcript.done (GA event)
   */
  private handleTranscriptDone(event: any): void {
    const itemId = event.item_id;
    const transcript = event.transcript;
    if (!itemId) return;

    const item = this.itemLookup.get(itemId);
    if (!item) return;

    if (item.formatted && transcript) {
      const cleaned = unwrapTranslationText(transcript);
      item.formatted.transcript = cleaned;
      item.formatted.text = cleaned;
    }

    this.eventHandlers.onConversationUpdated?.({ item });
  }

  /**
   * Handle input audio transcription completed
   */
  private handleInputTranscriptionCompleted(event: any): void {
    const itemId = event.item_id;
    const transcript = event.transcript;
    if (!itemId) return;

    const item = this.itemLookup.get(itemId);
    if (item && item.formatted) {
      item.formatted.transcript = transcript;
      item.formatted.text = transcript;
      this.eventHandlers.onConversationUpdated?.({ item });
    }
  }

  /**
   * Handle response.done event - mark items as completed
   */
  private handleResponseDone(event: any): void {
    const response = event.response;
    if (!response?.output) return;

    for (const outputItem of response.output) {
      const item = this.itemLookup.get(outputItem.id);
      if (item) {
        item.status = 'completed';
        this.eventHandlers.onConversationUpdated?.({ item });
      }
    }

  }

  /**
   * Send session.update event with configuration
   */
  private sendSessionUpdate(config: OpenAISessionConfig): void {
    if (!this.rt) return;

    // GA API session parameters differ from beta:
    // - 'modalities' → 'output_modalities' (only ['text'] or ['audio'], not both)
    // - 'max_response_output_tokens' → 'max_output_tokens'
    // - 'input_audio_format'/'output_audio_format' → nested 'audio' config
    // - 'temperature' → removed (not a GA session param)
    // - 'voice' → set at connection time, can only be updated if no audio output yet
    const session: any = {
      type: 'realtime',
      output_modalities: config.textOnly ? ['text'] : ['audio'],
      instructions: config.instructions,
      max_output_tokens: config.maxTokens === 'inf' ? 'inf' : config.maxTokens,
      // Explicitly disable tools to prevent model drift from translator role
      tool_choice: 'none',
      tools: []
    };

    // GA API nests turn_detection, transcription, noise_reduction under audio.input
    const audioInput: any = {};
    let hasAudioInput = false;

    // Turn detection → audio.input.turn_detection
    if (config.turnDetection) {
      if (config.turnDetection.type === 'none') {
        audioInput.turn_detection = null;
        this.turnDetectionDisabled = true;
      } else {
        this.turnDetectionDisabled = false;
        const td: any = {
          type: config.turnDetection.type,
          create_response: config.turnDetection.createResponse ?? true,
          interrupt_response: config.turnDetection.interruptResponse ?? false
        };

        if (config.turnDetection.type === 'server_vad') {
          if (config.turnDetection.threshold !== undefined) td.threshold = config.turnDetection.threshold;
          if (config.turnDetection.prefixPadding !== undefined) td.prefix_padding_ms = Math.round(config.turnDetection.prefixPadding * 1000);
          if (config.turnDetection.silenceDuration !== undefined) td.silence_duration_ms = Math.round(config.turnDetection.silenceDuration * 1000);
        } else if (config.turnDetection.type === 'semantic_vad' && config.turnDetection.eagerness) {
          td.eagerness = config.turnDetection.eagerness.toLowerCase();
        }

        audioInput.turn_detection = td;
      }
      hasAudioInput = true;
    }

    // Input audio transcription → audio.input.transcription
    if (config.inputAudioTranscription?.model) {
      audioInput.transcription = {
        model: config.inputAudioTranscription.model
      };
      hasAudioInput = true;
    }

    // Noise reduction → audio.input.noise_reduction
    if (config.inputAudioNoiseReduction?.type) {
      audioInput.noise_reduction = {
        type: config.inputAudioNoiseReduction.type
      };
      hasAudioInput = true;
    }

    if (hasAudioInput) {
      session.audio = { input: audioInput };
    }

    this.rt.send({
      type: 'session.update',
      session
    } as any);

    // Forward as client event for logging
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'session.update',
        data: { session }
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.rt) {
      this.rt.close();
      this.rt = null;
    }

    if (this.connected) {
      this.connected = false;
      this.eventHandlers.onRealtimeEvent?.({
        source: 'client',
        event: {
          type: 'session.closed',
          data: {
            status: 'disconnected',
            provider: 'openai',
            timestamp: Date.now(),
            reason: 'client_disconnect'
          }
        }
      });
      this.eventHandlers.onClose?.({});
    }
  }

  isConnected(): boolean {
    return this.connected && this.rt !== null;
  }

  updateSession(config: Partial<SessionConfig>): void {
    if (isOpenAISessionConfig(config as SessionConfig)) {
      this.sendSessionUpdate(config as OpenAISessionConfig);
    }
  }

  reset(): void {
    this.conversationItems = [];
    this.itemLookup.clear();
    this.itemCreatedAtMap.clear();
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.rt) return;

    const base64 = int16ArrayToBase64(audioData);
    this.rt.send({
      type: 'input_audio_buffer.append',
      audio: base64
    } as any);
  }

  appendInputText(text: string): void {
    if (!this.rt || !text.trim()) return;

    this.rt.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: text.trim()
        }]
      }
    } as any);

    // Forward as client event for logging
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'conversation.item.create',
        data: { text: text.trim() }
      }
    });

    this.rt.send({ type: 'response.create' } as any);
  }

  createResponse(config?: ResponseConfig): void {
    if (!this.rt) return;

    // When turn detection is disabled, commit audio buffer first (PTT mode)
    // Skip for out-of-band anchor messages (conversation: 'none')
    if (this.turnDetectionDisabled && config?.conversation !== 'none') {
      this.rt.send({ type: 'input_audio_buffer.commit' } as any);

      this.eventHandlers.onRealtimeEvent?.({
        source: 'client',
        event: {
          type: 'input_audio_buffer.commit',
          data: {}
        }
      });
    }

    if (config) {
      const responseEvent: any = {
        type: 'response.create',
        response: {}
      };

      if (config.instructions) {
        responseEvent.response.instructions = config.instructions;
      }
      if (config.conversation) {
        responseEvent.response.conversation = config.conversation;
      }
      // GA API uses 'output_modalities' instead of 'modalities' in response.create
      if (config.modalities) {
        responseEvent.response.output_modalities = config.modalities;
      }
      if (config.metadata) {
        responseEvent.response.metadata = config.metadata;
      }

      if (config.conversation === 'none') {
        console.debug('[OpenAIGAClient] Sending out-of-band response:', {
          conversation: config.conversation,
          modalities: config.modalities,
          hasInstructions: !!config.instructions,
          metadata: config.metadata
        });
      }

      this.rt.send(responseEvent);

      this.eventHandlers.onRealtimeEvent?.({
        source: 'client',
        event: {
          type: 'response.create',
          data: responseEvent
        }
      });
    } else {
      this.rt.send({ type: 'response.create' } as any);

      this.eventHandlers.onRealtimeEvent?.({
        source: 'client',
        event: {
          type: 'response.create',
          data: {}
        }
      });
    }
  }

  cancelResponse(_trackId?: string, _offset?: number): void {
    if (!this.rt) return;
    this.rt.send({ type: 'response.cancel' } as any);

    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'response.cancel',
        data: {}
      }
    });
  }

  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = { ...handlers };
  }

  getProvider(): ProviderType {
    return Provider.OPENAI;
  }
}

/**
 * Convert Int16Array to base64-encoded string
 */
function int16ArrayToBase64(data: Int16Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64-encoded string to Int16Array
 */
function base64ToInt16Array(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}
