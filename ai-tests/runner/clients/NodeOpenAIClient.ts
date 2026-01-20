/**
 * Node.js OpenAI Realtime API Client
 *
 * Uses the openai-realtime-api library (same as main Sokuji app)
 * for consistent behavior and proper handling of cancelled responses.
 */

import { RealtimeClient } from 'openai-realtime-api';
import type { TestCaseConfig, ConversationItem } from '../types.js';

/**
 * Event handlers for the client
 */
export interface NodeClientEventHandlers {
  onOpen?: () => void;
  onClose?: (event: { code: number; reason: string }) => void;
  onError?: (error: Error) => void;
  onEvent?: (event: Record<string, unknown>) => void;
  onConversationUpdated?: (item: ConversationItem) => void;
  onInputTranscription?: (itemId: string, transcript: string) => void;
  onOutputTranscription?: (text: string) => void;
  onItemCompleted?: (item: ConversationItem) => void;
}

/**
 * Node.js OpenAI Realtime API Client
 *
 * This implementation uses the openai-realtime-api library which:
 * - Handles response correlation internally
 * - Provides `conversation.item.completed` event for truly completed items
 * - Automatically uses `ws` package in Node.js environment
 */
export class NodeOpenAIClient {
  private static readonly DEFAULT_API_HOST = 'wss://api.openai.com';

  private apiKey: string;
  private apiHost: string;
  private client: RealtimeClient | null = null;
  private eventHandlers: NodeClientEventHandlers = {};
  private currentOutputTranscript: string = '';

  constructor(apiKey: string, apiHost?: string) {
    this.apiKey = apiKey;
    this.apiHost = apiHost || NodeOpenAIClient.DEFAULT_API_HOST;
    // Ensure WSS protocol
    this.apiHost = this.apiHost.replace(/^https?:/, 'wss:').replace(/\/$/, '');
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: NodeClientEventHandlers): void {
    this.eventHandlers = { ...handlers };
  }

  /**
   * Connect to the OpenAI Realtime API
   */
  async connect(config: TestCaseConfig): Promise<void> {
    const model = config.model || 'gpt-4o-realtime-preview';

    // Create new client instance with model
    this.client = new RealtimeClient({
      apiKey: this.apiKey,
      url: `${this.apiHost}/v1/realtime`,
      model: model,
    });

    // Setup event listeners before connecting
    this.setupEventListeners();

    // Connect to the API
    await this.client.connect();

    // Update session with full configuration
    this.updateSession(config);

    // Wait for session to be ready
    await this.client.waitForSessionCreated();

    this.eventHandlers.onOpen?.();
  }

  /**
   * Setup event listeners on the client
   */
  private setupEventListeners(): void {
    if (!this.client) return;

    // Forward all raw realtime events for debugging/logging
    this.client.on('realtime.event', (realtimeEvent: any) => {
      this.eventHandlers.onEvent?.(realtimeEvent.event);
    });

    // Handle conversation updates (streaming)
    // This fires whenever an item is updated with new content
    this.client.on('conversation.updated', (event: any) => {
      const { item, delta } = event;

      // Convert to our ConversationItem format
      const conversationItem = this.convertToConversationItem(item);
      this.eventHandlers.onConversationUpdated?.(conversationItem);

      // Handle input transcription (user's speech transcribed)
      if (item.role === 'user' && item.formatted?.transcript) {
        this.eventHandlers.onInputTranscription?.(item.id, item.formatted.transcript);
      }

      // Handle output transcription (streaming)
      // Track the latest transcript for assistant responses
      if (item.role === 'assistant' && item.formatted?.transcript) {
        this.currentOutputTranscript = item.formatted.transcript;
        this.eventHandlers.onOutputTranscription?.(item.formatted.transcript);
      }
    });

    // Handle item completion - CRITICAL for correct response handling
    // This ONLY fires when an item is truly completed, not when cancelled
    this.client.on('conversation.item.completed', (event: any) => {
      const { item } = event;

      if (item.role === 'assistant') {
        const conversationItem = this.convertToConversationItem(item);
        this.eventHandlers.onItemCompleted?.(conversationItem);
      }
    });

    // Handle errors
    this.client.on('error', (event: any) => {
      const errorMessage = event.message || event.error?.message || String(event);
      this.eventHandlers.onError?.(new Error(errorMessage));
    });
  }

  /**
   * Convert library item format to our ConversationItem format
   */
  private convertToConversationItem(item: any): ConversationItem {
    return {
      id: item.id,
      role: item.role as 'user' | 'assistant' | 'system',
      type: item.type as ConversationItem['type'],
      status: item.status || 'in_progress',
      formatted: item.formatted ? {
        text: item.formatted.text,
        transcript: item.formatted.transcript,
        audio: item.formatted.audio,
      } : undefined,
      content: item.content,
    };
  }

  /**
   * Update session configuration
   */
  updateSession(config: TestCaseConfig): void {
    if (!this.client) return;

    const updateParams: any = {};

    if (config.systemInstruction) {
      updateParams.instructions = config.systemInstruction;
    }

    if (config.temperature !== undefined) {
      updateParams.temperature = config.temperature;
    }

    if (config.voice) {
      updateParams.voice = config.voice;
    }

    if (config.inputAudioTranscription) {
      updateParams.input_audio_transcription = {
        model: config.inputAudioTranscription.model,
      };
    }

    if (config.turnDetection) {
      if (config.turnDetection.type === 'none') {
        updateParams.turn_detection = null;
      } else {
        updateParams.turn_detection = {
          type: config.turnDetection.type,
          threshold: config.turnDetection.threshold,
          prefix_padding_ms: config.turnDetection.prefixPaddingMs,
          silence_duration_ms: config.turnDetection.silenceDurationMs,
        };

        // Remove undefined values
        Object.keys(updateParams.turn_detection).forEach(key => {
          if (updateParams.turn_detection[key] === undefined) {
            delete updateParams.turn_detection[key];
          }
        });
      }
    }

    this.client.updateSession(updateParams);
  }

  /**
   * Append input audio (PCM16)
   * The library handles base64 encoding internally
   */
  appendInputAudio(audioData: Int16Array): void {
    if (!this.client) return;
    this.client.appendInputAudio(audioData);
  }

  /**
   * Commit the input audio buffer
   * Uses conversation.item.create with input_audio type
   */
  commitInputAudio(): void {
    if (!this.client) return;
    // The library's createResponse() handles committing audio automatically
    // when turn_detection is none. For server_vad, the server auto-commits.
  }

  /**
   * Clear the input audio buffer
   */
  clearInputAudio(): void {
    // The library doesn't expose direct buffer clearing
    // With server_vad, the buffer is managed automatically
  }

  /**
   * Clear input audio buffer and wait for server acknowledgment
   * This is a no-op with the library as buffer management is automatic
   */
  async clearInputAudioAndWait(_timeoutMs: number = 5000): Promise<void> {
    // The library manages the audio buffer internally
    // No explicit clearing needed between inputs
    return Promise.resolve();
  }

  /**
   * Wait for WebSocket buffer to drain
   * The library handles this internally
   */
  async waitForDrain(): Promise<void> {
    // The library handles buffering internally
    // Add a small delay to ensure audio is fully sent
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * Send text input
   */
  sendTextInput(text: string): void {
    if (!this.client) return;
    this.client.sendUserMessageContent([
      { type: 'input_text', text: text }
    ]);
  }

  /**
   * Create a response
   */
  createResponse(): void {
    if (!this.client) return;
    this.currentOutputTranscript = '';
    this.client.createResponse();
  }

  /**
   * Get the current output transcript (streaming)
   */
  getCurrentResponseText(): string {
    return this.currentOutputTranscript;
  }

  /**
   * Get all conversation items
   */
  getConversationItems(): ConversationItem[] {
    if (!this.client) return [];
    const items = this.client.conversation.getItems();
    return items.map(item => this.convertToConversationItem(item));
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.client?.isConnected ?? false;
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.currentOutputTranscript = '';
    // Invoke onClose callback to notify consumers of disconnection
    this.eventHandlers.onClose?.({ code: 1000, reason: 'Client disconnected' });
  }
}
