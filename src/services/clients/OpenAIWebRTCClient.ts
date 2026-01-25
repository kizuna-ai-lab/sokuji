/**
 * OpenAIWebRTCClient
 *
 * OpenAI Realtime API client using WebRTC transport.
 * Implements the IClient interface for compatibility with existing infrastructure.
 *
 * Key differences from WebSocket client:
 * - Audio flows via MediaStreamTrack (automatic, native WebRTC)
 * - Events sent/received via DataChannel "oai-events"
 * - Uses ephemeral tokens for authentication
 * - Lower latency due to native audio codec (Opus)
 */

import {
  IClient,
  ConversationItem,
  SessionConfig,
  ClientEventHandlers,
  OpenAISessionConfig,
  isOpenAISessionConfig,
  ResponseConfig
} from '../interfaces/IClient';
import { RealtimeEvent } from '../../stores/logStore';
import { Provider, ProviderType } from '../../types/Provider';
import { EphemeralTokenService } from '../EphemeralTokenService';
import { WebRTCAudioBridge, BufferedAudioMetadata } from '../../lib/modern-audio/WebRTCAudioBridge';

interface WebRTCClientOptions {
  /** User's API key for ephemeral token generation */
  apiKey: string;
  /** Optional custom API host */
  apiHost?: string;
  /** Optional input device ID */
  inputDeviceId?: string;
  /** Optional output device ID */
  outputDeviceId?: string;
}

interface ServerEvent {
  type: string;
  event_id?: string;
  [key: string]: any;
}

/**
 * OpenAI Realtime API client using WebRTC transport
 */
export class OpenAIWebRTCClient implements IClient {
  private static readonly DEFAULT_API_HOST = 'https://api.openai.com';

  private apiKey: string;
  private apiHost: string;
  private inputDeviceId?: string;
  private outputDeviceId?: string;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private audioBridge: WebRTCAudioBridge;
  private eventHandlers: ClientEventHandlers = {};

  private conversationItems: ConversationItem[] = [];
  private itemCreatedAtMap: Map<string, number> = new Map();
  private connected: boolean = false;
  private currentModel: string = '';
  private currentVoice: string = '';
  private turnDetectionDisabled: boolean = false;
  private currentResponseItemId: string | null = null;

  constructor(options: WebRTCClientOptions) {
    this.apiKey = options.apiKey;
    this.apiHost = (options.apiHost || OpenAIWebRTCClient.DEFAULT_API_HOST).replace(/\/$/, '');
    this.inputDeviceId = options.inputDeviceId;
    this.outputDeviceId = options.outputDeviceId;

    // Create audio bridge with PCM buffering enabled for smooth playback
    this.audioBridge = new WebRTCAudioBridge({
      sampleRate: 24000,
      enablePCMBuffering: true,
      pcmBufferThresholdMs: 150,
      pcmFlushTimeoutMs: 100
    });

    // Set up buffered audio callback - routes to conversation updates
    this.audioBridge.onBufferedAudioData = (pcmData: Int16Array, metadata: BufferedAudioMetadata) => {
      this.handleBufferedAudio(pcmData, metadata);
    };
  }

  /**
   * Handle buffered audio data from WebRTCAudioBridge
   * Emits audio delta events for conversation updates
   */
  private handleBufferedAudio(pcmData: Int16Array, metadata: BufferedAudioMetadata): void {
    const itemId = this.currentResponseItemId || `webrtc_audio_${Date.now()}`;

    // Emit aggregated audio delta event - same format as WebSocket client
    this.eventHandlers.onConversationUpdated?.({
      item: {
        id: itemId,
        role: 'assistant',
        type: 'message',
        status: 'in_progress',
        formatted: { audio: pcmData }
      },
      delta: {
        audio: pcmData,
        sequenceNumber: metadata.sequenceNumber,
        timestamp: metadata.timestamp
      }
    });
  }

  /**
   * Connect to OpenAI Realtime API using WebRTC
   */
  async connect(config: SessionConfig): Promise<void> {
    if (!isOpenAISessionConfig(config)) {
      throw new Error('OpenAIWebRTCClient requires OpenAI session config');
    }

    this.currentModel = config.model;
    this.currentVoice = config.voice || 'alloy';

    try {
      // Get ephemeral token
      const ephemeralToken = await EphemeralTokenService.getToken(
        this.apiKey,
        this.currentModel,
        this.currentVoice,
        this.apiHost
      );

      // Create RTCPeerConnection
      this.pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      // Set up audio track from microphone
      const localStream = await this.audioBridge.getLocalStream(this.inputDeviceId);
      localStream.getTracks().forEach(track => {
        this.pc!.addTrack(track, localStream);
      });

      // Handle remote audio track
      this.pc.ontrack = (event) => {
        console.debug('[OpenAIWebRTCClient] Received remote track:', event.track.kind);
        if (event.streams && event.streams[0]) {
          this.audioBridge.handleRemoteStream(event.streams[0], this.outputDeviceId);
        }
      };

      // Create data channel for events
      this.dc = this.pc.createDataChannel('oai-events');
      this.setupDataChannelListeners();

      // Connection state monitoring
      this.pc.oniceconnectionstatechange = () => {
        console.debug('[OpenAIWebRTCClient] ICE connection state:', this.pc?.iceConnectionState);
        if (this.pc?.iceConnectionState === 'disconnected' ||
            this.pc?.iceConnectionState === 'failed') {
          this.handleDisconnection();
        }
      };

      this.pc.onconnectionstatechange = () => {
        console.debug('[OpenAIWebRTCClient] Connection state:', this.pc?.connectionState);
        if (this.pc?.connectionState === 'connected') {
          this.connected = true;
          this.eventHandlers.onOpen?.();
        } else if (this.pc?.connectionState === 'failed' ||
                   this.pc?.connectionState === 'closed') {
          this.handleDisconnection();
        }
      };

      // Create and set local offer
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete
      await this.waitForIceGathering();

      // Send offer to OpenAI and get answer via REST API
      const answer = await this.sendOfferToOpenAI(
        this.pc.localDescription!.sdp,
        ephemeralToken
      );

      // Set remote description
      await this.pc.setRemoteDescription({
        type: 'answer',
        sdp: answer
      });

      // Wait for data channel to open, then send session config
      await this.waitForDataChannelOpen();
      this.sendSessionUpdate(config);

      console.info('[OpenAIWebRTCClient] WebRTC connection established');

    } catch (error) {
      console.error('[OpenAIWebRTCClient] Connection failed:', error);
      this.cleanup();
      throw error;
    }
  }

  /**
   * Wait for ICE gathering to complete
   */
  private waitForIceGathering(): Promise<void> {
    return new Promise((resolve) => {
      if (this.pc?.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (this.pc?.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      this.pc?.addEventListener('icegatheringstatechange', checkState);

      // Timeout after 5 seconds
      setTimeout(() => {
        this.pc?.removeEventListener('icegatheringstatechange', checkState);
        resolve();
      }, 5000);
    });
  }

  /**
   * Wait for data channel to open
   */
  private waitForDataChannelOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.dc?.readyState === 'open') {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Data channel open timeout'));
      }, 10000);

      this.dc!.onopen = () => {
        clearTimeout(timeout);
        console.debug('[OpenAIWebRTCClient] Data channel opened');
        resolve();
      };

      this.dc!.onerror = (error) => {
        clearTimeout(timeout);
        reject(error);
      };
    });
  }

  /**
   * Send SDP offer to OpenAI and receive answer
   */
  private async sendOfferToOpenAI(sdp: string, token: string): Promise<string> {
    const endpoint = `${this.apiHost}/v1/realtime?model=${encodeURIComponent(this.currentModel)}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/sdp'
      },
      body: sdp
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to establish WebRTC connection: ${response.status} ${errorText}`);
    }

    return await response.text();
  }

  /**
   * Set up data channel event listeners
   */
  private setupDataChannelListeners(): void {
    if (!this.dc) return;

    this.dc.onmessage = (event) => {
      try {
        const serverEvent: ServerEvent = JSON.parse(event.data);
        this.handleServerEvent(serverEvent);
      } catch (error) {
        console.error('[OpenAIWebRTCClient] Failed to parse server event:', error);
      }
    };

    this.dc.onerror = (error) => {
      console.error('[OpenAIWebRTCClient] Data channel error:', error);
      this.eventHandlers.onError?.(error);
    };

    this.dc.onclose = () => {
      console.debug('[OpenAIWebRTCClient] Data channel closed');
      this.handleDisconnection();
    };
  }

  /**
   * Handle server events received via data channel
   */
  private handleServerEvent(event: ServerEvent): void {
    // Emit realtime event for logging
    const realtimeEvent: RealtimeEvent = {
      source: 'server',
      event: {
        type: event.type,
        data: event
      }
    };
    this.eventHandlers.onRealtimeEvent?.(realtimeEvent);

    // Handle specific event types
    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        console.debug('[OpenAIWebRTCClient] Session event:', event.type);
        break;

      case 'conversation.item.created':
        this.handleItemCreated(event);
        break;

      case 'response.audio_transcript.delta':
      case 'response.text.delta':
        this.handleTranscriptDelta(event);
        break;

      case 'response.audio_transcript.done':
      case 'response.text.done':
        this.handleTranscriptDone(event);
        break;

      case 'input_audio_buffer.speech_started':
        this.eventHandlers.onConversationInterrupted?.();
        break;

      case 'conversation.item.input_audio_transcription.completed':
        this.handleInputTranscriptionCompleted(event);
        break;

      case 'response.done':
        this.handleResponseDone(event);
        break;

      case 'error':
        this.handleErrorEvent(event);
        break;

      default:
        // Log unhandled events for debugging
        if (event.type.includes('error')) {
          console.warn('[OpenAIWebRTCClient] Unhandled error event:', event);
        }
    }
  }

  /**
   * Handle conversation.item.created event
   */
  private handleItemCreated(event: ServerEvent): void {
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

    // Track current assistant response item for audio PCM association
    if (conversationItem.role === 'assistant') {
      this.currentResponseItemId = item.id;
    }

    this.conversationItems.push(conversationItem);
    this.eventHandlers.onConversationUpdated?.({ item: conversationItem });
  }

  /**
   * Handle transcript delta events
   */
  private handleTranscriptDelta(event: ServerEvent): void {
    const itemId = event.item_id;
    const delta = event.delta;
    if (!itemId || !delta) return;

    const item = this.conversationItems.find(i => i.id === itemId);
    if (!item) return;

    // Append delta to transcript
    if (item.formatted) {
      item.formatted.transcript = (item.formatted.transcript || '') + delta;
      item.formatted.text = item.formatted.transcript;
    }

    this.eventHandlers.onConversationUpdated?.({
      item,
      delta: { transcript: delta }
    });
  }

  /**
   * Handle transcript done events
   */
  private handleTranscriptDone(event: ServerEvent): void {
    const itemId = event.item_id;
    const transcript = event.transcript;
    if (!itemId) return;

    const item = this.conversationItems.find(i => i.id === itemId);
    if (!item) return;

    if (item.formatted && transcript) {
      item.formatted.transcript = transcript;
      item.formatted.text = transcript;
    }

    this.eventHandlers.onConversationUpdated?.({ item });
  }

  /**
   * Handle input audio transcription completed
   */
  private handleInputTranscriptionCompleted(event: ServerEvent): void {
    const itemId = event.item_id;
    const transcript = event.transcript;
    if (!itemId) return;

    const item = this.conversationItems.find(i => i.id === itemId);
    if (item && item.formatted) {
      item.formatted.transcript = transcript;
      item.formatted.text = transcript;
      this.eventHandlers.onConversationUpdated?.({ item });
    }
  }

  /**
   * Handle response.done event
   */
  private handleResponseDone(event: ServerEvent): void {
    const response = event.response;
    if (!response?.output) return;

    for (const outputItem of response.output) {
      const item = this.conversationItems.find(i => i.id === outputItem.id);
      if (item) {
        item.status = 'completed';
        this.eventHandlers.onConversationUpdated?.({ item });
      }
    }

    // Clear current response item ID when response is complete
    this.currentResponseItemId = null;
  }

  /**
   * Handle error events
   */
  private handleErrorEvent(event: ServerEvent): void {
    const error = event.error || event;
    const errorItem: ConversationItem = {
      id: `error_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      role: 'system',
      type: 'error',
      status: 'completed',
      formatted: {
        text: `[${error.type || 'error'}] ${error.message || 'Unknown error'}`
      },
      content: [{
        type: 'text',
        text: error.message || 'Unknown error'
      }]
    };

    this.eventHandlers.onConversationUpdated?.({ item: errorItem });
    this.eventHandlers.onError?.(error);
  }

  /**
   * Send session.update event to configure the session
   */
  private sendSessionUpdate(config: OpenAISessionConfig): void {
    const sessionUpdate: any = {
      type: 'session.update',
      session: {
        modalities: config.textOnly ? ['text'] : ['text', 'audio'],
        voice: config.voice || 'alloy',
        instructions: config.instructions,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        temperature: config.temperature ?? 0.8,
        max_response_output_tokens: config.maxTokens === 'inf' ? 'inf' : config.maxTokens,
        // Explicitly disable tools to prevent model drift from translator role
        tool_choice: 'none',
        tools: []
      }
    };

    // Add turn detection config and track if disabled
    if (config.turnDetection) {
      if (config.turnDetection.type === 'none') {
        sessionUpdate.session.turn_detection = null;
        this.turnDetectionDisabled = true;
      } else {
        this.turnDetectionDisabled = false;
        sessionUpdate.session.turn_detection = {
          type: config.turnDetection.type,
          threshold: config.turnDetection.threshold,
          prefix_padding_ms: config.turnDetection.prefixPadding
            ? Math.round(config.turnDetection.prefixPadding * 1000)
            : undefined,
          silence_duration_ms: config.turnDetection.silenceDuration
            ? Math.round(config.turnDetection.silenceDuration * 1000)
            : undefined,
          create_response: config.turnDetection.createResponse ?? true,
          interrupt_response: config.turnDetection.interruptResponse ?? false
        };

        if (config.turnDetection.type === 'semantic_vad' && config.turnDetection.eagerness) {
          sessionUpdate.session.turn_detection.eagerness =
            config.turnDetection.eagerness.toLowerCase();
        }
      }
    }

    // Add input audio transcription
    if (config.inputAudioTranscription?.model) {
      sessionUpdate.session.input_audio_transcription = {
        model: config.inputAudioTranscription.model
      };
    }

    // Add noise reduction
    if (config.inputAudioNoiseReduction?.type) {
      sessionUpdate.session.input_audio_noise_reduction = {
        type: config.inputAudioNoiseReduction.type
      };
    }

    this.sendEvent(sessionUpdate);
  }

  /**
   * Send event via data channel
   */
  private sendEvent(event: any): void {
    if (!this.dc || this.dc.readyState !== 'open') {
      console.warn('[OpenAIWebRTCClient] Cannot send event, data channel not open');
      return;
    }

    const eventStr = JSON.stringify(event);
    this.dc.send(eventStr);

    // Emit client event for logging
    const realtimeEvent: RealtimeEvent = {
      source: 'client',
      event: {
        type: event.type,
        data: event
      }
    };
    this.eventHandlers.onRealtimeEvent?.(realtimeEvent);
  }

  /**
   * Handle disconnection
   */
  private handleDisconnection(): void {
    if (!this.connected) return;

    this.connected = false;
    this.eventHandlers.onClose?.({ reason: 'disconnected' });
    this.cleanup();
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.audioBridge.cleanup();

    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    this.connected = false;
  }

  /**
   * Disconnect from the session
   */
  async disconnect(): Promise<void> {
    console.info('[OpenAIWebRTCClient] Disconnecting...');
    this.cleanup();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.dc?.readyState === 'open';
  }

  /**
   * Update session configuration
   */
  updateSession(config: Partial<SessionConfig>): void {
    if (isOpenAISessionConfig(config as SessionConfig)) {
      this.sendSessionUpdate(config as OpenAISessionConfig);
    }
  }

  /**
   * Reset conversation state
   */
  reset(): void {
    this.conversationItems = [];
    this.itemCreatedAtMap.clear();
    this.currentResponseItemId = null;
  }

  /**
   * Append input audio (not used in WebRTC - audio flows via MediaStreamTrack)
   * This method exists for interface compatibility but is a no-op
   */
  appendInputAudio(_audioData: Int16Array): void {
    // In WebRTC mode, audio is sent automatically via the MediaStreamTrack
    // This method is intentionally a no-op
    console.debug('[OpenAIWebRTCClient] appendInputAudio called but audio flows via MediaStreamTrack in WebRTC mode');
  }

  /**
   * Append text input
   */
  appendInputText(text: string): void {
    if (!text.trim()) return;

    const event = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: text
        }]
      }
    };

    this.sendEvent(event);
    // Send response.create directly without committing audio buffer
    // Text input should not affect the audio input stream
    this.sendEvent({ type: 'response.create' });
  }

  /**
   * Create a response from the AI model
   * When VAD is disabled, commits the input audio buffer first
   * @param config Optional configuration to override session-level settings for this response
   *               Used for per-turn instructions to prevent model drift
   */
  createResponse(config?: ResponseConfig): void {
    // When turn detection is disabled, we need to commit the input audio buffer first
    // so the server knows the user has finished speaking
    //
    // IMPORTANT: Skip audio buffer commit for out-of-band anchor messages
    // (conversation: 'none') as they don't use audio input and committing
    // an empty buffer causes "buffer too small" errors
    if (this.turnDetectionDisabled && config?.conversation !== 'none') {
      this.sendEvent({ type: 'input_audio_buffer.commit' });
    }

    if (config) {
      // Send response.create event with per-turn configuration
      const responseEvent: any = {
        type: 'response.create',
        response: {}
      };

      // Add per-turn instructions if provided (key mechanism for preventing drift)
      if (config.instructions) {
        responseEvent.response.instructions = config.instructions;
      }

      // Add conversation mode if specified
      if (config.conversation) {
        responseEvent.response.conversation = config.conversation;
      }

      // Add modalities if specified
      if (config.modalities) {
        responseEvent.response.modalities = config.modalities;
      }

      // Add metadata if specified (for tracking/filtering purposes)
      if (config.metadata) {
        responseEvent.response.metadata = config.metadata;
      }

      // Log out-of-band anchor requests for debugging
      if (config.conversation === 'none') {
        console.debug('[OpenAIWebRTCClient] Sending out-of-band response:', {
          conversation: config.conversation,
          modalities: config.modalities,
          hasInstructions: !!config.instructions,
          metadata: config.metadata
        });
      }

      this.sendEvent(responseEvent);
    } else {
      this.sendEvent({ type: 'response.create' });
    }
  }

  /**
   * Cancel response (limited support in WebRTC)
   */
  cancelResponse(_trackId?: string, _offset?: number): void {
    this.sendEvent({ type: 'response.cancel' });
  }

  /**
   * Get conversation items
   */
  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];
  }

  /**
   * Set event handlers
   */
  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = handlers;
  }

  /**
   * Get provider type
   */
  getProvider(): ProviderType {
    return Provider.OPENAI;
  }

  /**
   * Get the audio bridge for external access (e.g., device switching)
   */
  getAudioBridge(): WebRTCAudioBridge {
    return this.audioBridge;
  }

  /**
   * Switch input device
   */
  async switchInputDevice(deviceId: string): Promise<void> {
    if (!this.pc) return;

    this.inputDeviceId = deviceId;
    const newStream = await this.audioBridge.getLocalStream(deviceId);

    // Replace tracks in the peer connection
    const senders = this.pc.getSenders();
    const audioSender = senders.find(s => s.track?.kind === 'audio');

    if (audioSender) {
      const newTrack = newStream.getAudioTracks()[0];
      await audioSender.replaceTrack(newTrack);
      console.debug('[OpenAIWebRTCClient] Switched input device to:', deviceId);
    }
  }

  /**
   * Switch output device
   */
  async switchOutputDevice(deviceId: string): Promise<void> {
    this.outputDeviceId = deviceId;
    await this.audioBridge.setOutputDevice(deviceId);
    console.debug('[OpenAIWebRTCClient] Switched output device to:', deviceId);
  }

  /**
   * Set output volume
   */
  setVolume(volume: number): void {
    this.audioBridge.setVolume(volume);
  }

  /**
   * Set output muted state
   * Note: This is a no-op because audio playback is handled by ModernAudioPlayer,
   * not by the WebRTC HTMLAudioElement (which is always muted).
   * Volume/mute control is managed through audioStore's global volume settings.
   */
  setOutputMuted(muted: boolean): void {
    // Do NOT call audioBridge.setMuted() - the HTMLAudioElement must stay muted
    // to prevent double audio playback. ModernAudioPlayer is the sole audio source.
    console.debug('[OpenAIWebRTCClient] Output muted request (no-op, handled by audioStore):', muted);
  }

  /**
   * Get frequency data for visualization
   */
  getFrequencies(): { values: Float32Array } | null {
    return this.audioBridge.getFrequencies();
  }
}
