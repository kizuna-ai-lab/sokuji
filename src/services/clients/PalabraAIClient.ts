import { IClient, ConversationItem, SessionConfig, ClientEventHandlers, ApiKeyValidationResult, PalabraAISessionConfig, isPalabraAISessionConfig } from '../interfaces/IClient';
import { Provider, ProviderType } from '../../types/Provider';
import i18n from '../../locales';
import { Room, RoomEvent, TrackPublication, RemoteParticipant, RemoteTrack, RemoteAudioTrack, LocalAudioTrack, setLogLevel } from 'livekit-client';

// Suppress verbose logs from LiveKit client, including silence detection.
setLogLevel('error');

// --- Helper functions to get the correct worklet path ---

/**
 * Determines if the code is running in a Chrome extension environment.
 * @returns {boolean} True if running in a Chrome extension.
 */
function isExtensionEnvironment() {
  return typeof window !== 'undefined' && 
         typeof window.chrome !== 'undefined' && 
         typeof window.chrome.runtime !== 'undefined' && 
         typeof window.chrome.runtime.getURL === 'function';
}

/**
 * Creates a source URL for the Palabra PCM Processor AudioWorklet.
 * This function handles the different pathing requirements for
 * Chrome Extensions and Electron/web environments.
 * @returns {string} URL to the AudioWorklet code.
 */
function getPalabraWorkletProcessorSrc(): string {
  if (isExtensionEnvironment()) {
    return window.chrome.runtime.getURL('worklets/palabra-audio-worklet-processor.js');
  } else {
    return new URL('../worklets/palabra-audio-worklet-processor.js', import.meta.url).href;
  }
}

/**
 * PalabraAI API session configuration interface (returned by the API)
 */
interface PalabraAIApiSessionConfig {
  id: string;
  publisher: string;
  subscriber: string[];
  webrtc_room_name: string;
  webrtc_url: string;
  ws_url: string;
}

/**
 * PalabraAI translation configuration interface
 */
interface PalabraAITranslationConfig {
  message_type: string;
  data: {
    input_stream: {
      content_type: string;
      source: {
        type: string;
      };
    };
    output_stream: {
      content_type: string;
      target: {
        type: string;
      };
    };
    pipeline: {
      transcription: {
        source_language: string;
        detectable_languages: string[];
        segment_confirmation_silence_threshold: number;
        sentence_splitter: {
          enabled: boolean;
        };
        verification: {
          auto_transcription_correction: boolean;
          transcription_correction_style: string | null;
        };
      };
      translations: Array<{
        target_language: string;
        translate_partial_transcriptions: boolean;
        speech_generation: {
          voice_cloning: boolean;
          voice_id: string;
          voice_timbre_detection: {
            enabled: boolean;
            high_timbre_voices: string[];
            low_timbre_voices: string[];
          };
        };
      }>;
      translation_queue_configs: {
        global: {
          desired_queue_level_ms: number;
          max_queue_level_ms: number;
          auto_tempo: boolean;
        };
      };
      allowed_message_types: string[];
    };
  };
}

/**
 * PalabraAI session data interface
 */
interface PalabraAISessionData {
  id: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

/**
 * PalabraAI WebRTC client adapter
 * Implements the IClient interface for PalabraAI's WebRTC API
 */
export class PalabraAIClient implements IClient {
  private static readonly API_BASE_URL = 'https://api.palabra.ai';
  
  private clientId: string;
  private clientSecret: string;
  private room: Room | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private conversationItems: ConversationItem[] = [];
  private isConnectedState = false;
  private sessionConfig: PalabraAIApiSessionConfig | null = null;
  private currentSessionConfig: PalabraAISessionConfig | null = null;
  private instanceId: string;
  private currentSessionId: string | null = null;
  
  // Audio handling
  private audioContext: AudioContext | null = null;
  private audioDestination: MediaStreamAudioDestinationNode | null = null;
  private customAudioTrack: LocalAudioTrack | null = null;
  private hiddenAudioElement: HTMLAudioElement | null = null;

  // Additional members for remote audio capture
  private remoteAudioContext: AudioContext | null = null;
  private remoteAudioSource: MediaStreamAudioSourceNode | null = null;
  private remoteAudioWorkletNode: AudioWorkletNode | null = null;
  private remoteAudioStream: MediaStream | null = null;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    // Generate a unique instance ID that remains constant for this client instance
    this.instanceId = `palabra_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate API credentials by checking user sessions
   */
  static async validateApiKey(clientId: string, clientSecret: string): Promise<ApiKeyValidationResult> {
    try {
      // Check if credentials are empty
      if (!clientId || clientId.trim() === '' || !clientSecret || clientSecret.trim() === '') {
        return {
          valid: false,
          message: i18n.t('settings.errorValidatingApiKey'),
          validating: false
        };
      }

      // Test credentials by getting user sessions
      const response = await fetch(`${this.API_BASE_URL}/session-storage/sessions`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'ClientId': clientId,
          'ClientSecret': clientSecret,
        }
      });

      console.info("[Sokuji] [PalabraAIClient] Validating credentials via sessions API, response status:", response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.warn("[Sokuji] [PalabraAIClient] Validation failed:", errorData);
        return {
          valid: false,
          message: errorData.error?.message || i18n.t('settings.errorValidatingApiKey'),
          validating: false
        };
      }

      // Parse successful response
      const data = await response.json();
      console.info("[Sokuji] [PalabraAIClient] Credentials validation successful, sessions retrieved:", data.sessions?.length || 0);
      
      return {
        valid: true,
        message: i18n.t('settings.apiKeyValidated') + ' ' + i18n.t('settings.realtimeTranslationAvailable', 'Realtime translation service is available'),
        validating: false
      };

    } catch (error: any) {
      console.error("[Sokuji] [PalabraAIClient] Validation error:", error);
      return {
        valid: false,
        message: error.message || i18n.t('settings.errorValidatingApiKey'),
        validating: false
      };
    }
  }

  async connect(config: SessionConfig): Promise<void> {
    console.info("[Sokuji] [PalabraAIClient] Connecting to PalabraAI", config);
    
    // Validate that this is a PalabraAI session config
    if (!isPalabraAISessionConfig(config)) {
      throw new Error('PalabraAIClient requires PalabraAISessionConfig');
    }
    
    try {
      this.currentSessionConfig = config;
      
      // Clean up existing sessions before creating new one
      await this.cleanupExistingSessions();
      
      // Create PalabraAI session
      await this.createSession();
      
      // Connect to WebRTC room
      await this.connectToRoom();
      
      // Set up audio publishing
      await this.setupAudio();
      
      // Start translation with configuration
      await this.startTranslation();
      
      this.isConnectedState = true;
      console.info("[Sokuji] [PalabraAIClient] Connected successfully");
      
    } catch (error) {
      console.error("[Sokuji] [PalabraAIClient] Connection error:", error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      // Send end_task before disconnecting
      if (this.room && this.isConnectedState) {
        try {
          const endTaskConfig = {
            message_type: "end_task",
            data: {}
          };
          
          const payload = JSON.stringify(endTaskConfig);
          const encoder = new TextEncoder();
          const message = encoder.encode(payload);
          
          // Notify about end_task event
          this.eventHandlers.onRealtimeEvent?.({
            source: 'client',
            event: {
              type: 'end_task',
              data: endTaskConfig
            }
          });
          
          await this.room.localParticipant.publishData(message, { reliable: true });
          console.info("[Sokuji] [PalabraAIClient] End task sent");
        } catch (error) {
          console.warn("[Sokuji] [PalabraAIClient] Error sending end_task:", error);
        }
      }
      
      // Clean up current session
      if (this.currentSessionId) {
        await this.deleteSession(this.currentSessionId);
        this.currentSessionId = null;
      }
      
      // Clean up audio resources before disconnecting room
      this.cleanupAudio();
      this.cleanupRemoteAudio();
      
      if (this.room) {
        await this.room.disconnect();
        this.room = null;
      }
      this.isConnectedState = false;
      this.sessionConfig = null;
      this.conversationItems = [];
      
      console.info("[Sokuji] [PalabraAIClient] Disconnected successfully");
      
    } catch (error) {
      console.error("[Sokuji] [PalabraAIClient] Disconnect error:", error);
      throw error;
    }
  }

  isConnected(): boolean {
    return this.isConnectedState && this.room !== null;
  }

  updateSession(config: Partial<SessionConfig>): void {
    if (this.currentSessionConfig) {
      // For PalabraAI, we only update if the partial config is for PalabraAI
      // Check if the partial config has the provider field and it's 'palabraai'
      if (!config.provider || config.provider === 'palabraai') {
        this.currentSessionConfig = { ...this.currentSessionConfig, ...(config as Partial<PalabraAISessionConfig>) };
      }
    }
  }

  reset(): void {
    this.conversationItems = [];
    // Note: PalabraAI doesn't have a reset concept like OpenAI
    // We would need to disconnect and reconnect to reset
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.audioContext || !this.audioDestination) {
      console.warn("[Sokuji] [PalabraAIClient] Audio context not initialized");
      return;
    }
    
    try {
      // Handle different input types - cast to any to allow type checking
      const data = audioData as any;
      let int16Array: Int16Array;
      
      if (data instanceof Float32Array) {
        // Convert Float32Array to Int16Array
        int16Array = new Int16Array(data.length);
        for (let i = 0; i < data.length; i++) {
          // Convert from Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
          int16Array[i] = Math.max(-32768, Math.min(32767, data[i] * 32767));
        }
      } else if (data instanceof Int16Array) {
        int16Array = data;
      } else if (data instanceof ArrayBuffer) {
        int16Array = new Int16Array(data);
      } else if (data && typeof data === 'object' && data.buffer instanceof ArrayBuffer) {
        // Handle Uint8Array or other TypedArray
        int16Array = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
      } else {
        console.warn("[Sokuji] [PalabraAIClient] Invalid audio data type:", typeof data, data);
        return;
      }
      
      // Check if we have valid audio data
      if (!int16Array || int16Array.length === 0) {
        console.warn("[Sokuji] [PalabraAIClient] Empty audio data received");
        return;
      }
      
      // Optional: log input audio buffer length for troubleshooting
      
      // Convert Int16Array to AudioBuffer
      const audioBuffer = this.audioContext.createBuffer(1, int16Array.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      
      // Convert Int16 to Float32 and normalize
      for (let i = 0; i < int16Array.length; i++) {
        channelData[i] = int16Array[i] / 32768.0;
      }
      
      // Create AudioBufferSourceNode and play the audio
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioDestination);
      source.start();
      
    } catch (error) {
      console.error("[Sokuji] [PalabraAIClient] Error processing audio data:", error);
    }
  }

  createResponse(): void {
    // PalabraAI handles response generation automatically
    // No explicit response creation needed
  }

  cancelResponse(trackId?: string, offset?: number): void {
    // PalabraAI doesn't support canceling responses
    // This is a no-op for PalabraAI
  }

  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];  // Return a new array copy to ensure React detects changes
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = handlers;
  }

  getProvider(): ProviderType {
    return Provider.PALABRA_AI;
  }

  private async createSession(): Promise<void> {
    const response = await fetch(`${PalabraAIClient.API_BASE_URL}/session-storage/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ClientId': this.clientId,
        'ClientSecret': this.clientSecret,
      },
      body: JSON.stringify({
        data: {
          subscriber_count: 0,
          intent: 'api'
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.statusText}`);
    }

    const data = await response.json();
    this.sessionConfig = data.data;
    this.currentSessionId = this.sessionConfig?.id || null;
    console.info("[Sokuji] [PalabraAIClient] Session created:", this.sessionConfig);
  }

  private async connectToRoom(): Promise<void> {
    if (!this.sessionConfig) {
      throw new Error('No session configuration available');
    }

    this.room = new Room();
    
    // Set up event handlers
    this.room.on(RoomEvent.TrackSubscribed, this.handleTrackSubscribed.bind(this));
    this.room.on(RoomEvent.DataReceived, this.handleDataReceived.bind(this));
    this.room.on(RoomEvent.Connected, this.handleRoomConnected.bind(this));
    this.room.on(RoomEvent.Disconnected, this.handleRoomDisconnected.bind(this));
    
    // Connect to the room
    await this.room.connect(this.sessionConfig.webrtc_url, this.sessionConfig.publisher);
    console.info("[Sokuji] [PalabraAIClient] Connected to WebRTC room");
  }

  private async setupAudio(): Promise<void> {
    if (!this.room) {
      throw new Error('Room not connected');
    }

    // Create audio context and destination for custom audio processing
    this.audioContext = new AudioContext({ sampleRate: 24000 });
    this.audioDestination = this.audioContext.createMediaStreamDestination();
    
    // Get the MediaStreamTrack from the destination
    const audioTrack = this.audioDestination.stream.getAudioTracks()[0];
    
    if (!audioTrack) {
      throw new Error('Failed to create audio track from MediaStreamAudioDestinationNode');
    }
    
    // Create a custom audio track from the MediaStreamTrack
    this.customAudioTrack = new LocalAudioTrack(audioTrack, undefined, true, this.audioContext);
    
    // Publish the custom audio track
    await this.room.localParticipant.publishTrack(this.customAudioTrack, { 
      dtx: false, // Required to be disabled for proper work of Palabra translation pipeline
      red: false, 
      audioPreset: {
        maxBitrate: 32000, 
        priority: "high"
      }
    });
    
    console.info("[Sokuji] [PalabraAIClient] Custom audio setup complete");
  }

  private async startTranslation(): Promise<void> {
    if (!this.room || !this.currentSessionConfig) {
      throw new Error('Room not connected or configuration missing');
    }

    const translationConfig: PalabraAITranslationConfig = {
      message_type: "set_task",
      data: {
        input_stream: {
          content_type: "audio",
          source: {
            type: "webrtc"
          }
        },
        output_stream: {
          content_type: "audio",
          target: {
            type: "webrtc"
          }
        },
        pipeline: {
          transcription: {
            source_language: this.currentSessionConfig.sourceLanguage,
            detectable_languages: [],
            segment_confirmation_silence_threshold: this.currentSessionConfig.segmentConfirmationSilenceThreshold,
            sentence_splitter: {
              enabled: this.currentSessionConfig.sentenceSplitterEnabled
            },
            verification: {
              auto_transcription_correction: false,
              transcription_correction_style: null
            }
          },
          translations: [
            {
              target_language: this.currentSessionConfig.targetLanguage,
              translate_partial_transcriptions: this.currentSessionConfig.translatePartialTranscriptions,
              speech_generation: {
                voice_cloning: false,
                voice_id: this.currentSessionConfig.voiceId,
                voice_timbre_detection: {
                  enabled: true,
                  high_timbre_voices: ['default_high'],
                  low_timbre_voices: ['default_low']
                }
              }
            }
          ],
          translation_queue_configs: {
            global: {
              desired_queue_level_ms: this.currentSessionConfig.desiredQueueLevelMs,
              max_queue_level_ms: this.currentSessionConfig.maxQueueLevelMs,
              auto_tempo: this.currentSessionConfig.autoTempo
            }
          },
          allowed_message_types: [
            "translated_transcription",
            "partial_transcription",
            "partial_translated_transcription",
            "validated_transcription"
          ]
        }
      }
    };

    const payload = JSON.stringify(translationConfig);
    const encoder = new TextEncoder();
    const message = encoder.encode(payload);
    
    // Notify about set_task event
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'set_task',
        data: translationConfig
      }
    });
    
    await this.room.localParticipant.publishData(message, { reliable: true });
    console.info("[Sokuji] [PalabraAIClient] Translation started with config:", translationConfig);
  }

  private handleTrackSubscribed(track: RemoteTrack, publication: TrackPublication, participant: RemoteParticipant): void {
    console.info("[Sokuji] [PalabraAIClient] Track subscribed:", track.kind);
    // Verbose logs (publication, participant) removed for cleaner output
    
    // Notify about track subscription event
    this.eventHandlers.onRealtimeEvent?.({
      source: 'server',
      event: {
        type: 'session.opened',
        data: {
          trackKind: track.kind,
          participantSid: participant.sid,
          participantIdentity: participant.identity,
          publicationSource: publication.source,
          trackSid: track.sid
        }
      }
    });
    
    if (track.kind === 'audio') {
      const audioTrack = track as RemoteAudioTrack;
      // Step 0: Attach track to a hidden, muted audio element to activate the WebRTC decoder
      this.hiddenAudioElement = audioTrack.attach();
      this.hiddenAudioElement.muted = true;
      this.hiddenAudioElement.volume = 0;
      this.hiddenAudioElement.style.display = 'none';
      document.body.appendChild(this.hiddenAudioElement);

      // The setup is asynchronous, so we'll wrap it in a function.
      const setupAudioWorklet = async () => {
        try {
          // Step 1: Obtain MediaStreamTrack
          const mediaStream = new MediaStream([audioTrack.mediaStreamTrack]);
          this.remoteAudioStream = mediaStream;

          // Step 2: Create AudioContext
          this.remoteAudioContext = new AudioContext({ sampleRate: 24000 });
          
          // Step 3: Get the dynamically resolved worklet path
          const workletUrl = getPalabraWorkletProcessorSrc();

          // Step 4: Add the audio worklet module
          await this.remoteAudioContext.audioWorklet.addModule(workletUrl);

          // Step 5: Create an AudioWorkletNode
          this.remoteAudioWorkletNode = new AudioWorkletNode(this.remoteAudioContext, 'palabra-pcm-processor');

          // Step 6: Create MediaStreamAudioSourceNode and connect the processing nodes
          this.remoteAudioSource = this.remoteAudioContext.createMediaStreamSource(mediaStream);
          this.remoteAudioSource.connect(this.remoteAudioWorkletNode);
          this.remoteAudioWorkletNode.connect(this.remoteAudioContext.destination);

          // Step 7: Process PCM data received from the worklet
          this.remoteAudioWorkletNode.port.onmessage = (event) => {
            const pcm = event.data as Int16Array;
            // Push data to MainPanel
            this.eventHandlers.onConversationUpdated?.({
              item: {
                id: this.instanceId,
                role: 'assistant',
                type: 'message',
                status: 'in_progress',
                formatted: { audio: pcm }
              },
              delta: { audio: pcm }
            });
          };
        } catch (error) {
          console.error("[Sokuji] [PalabraAIClient] Failed to set up audio worklet:", error);
        }
      };

      setupAudioWorklet();
    }
  }

  private handleDataReceived(payload: Uint8Array): void {
    const decoder = new TextDecoder();
    const message = decoder.decode(payload);
    
    try {
      const data = JSON.parse(message);
      // Detailed payload logging removed to keep console output concise
      
      // Check if this is a queue status message
      // Format: { "es": { "current_queue_level_ms": 320, "max_queue_level_ms": 24000 } }
      const isQueueStatusMessage = this.isQueueStatusMessage(data);
      
      if (isQueueStatusMessage) {
        // Ignored queue status message
        return;
      }
      
      // Handle different message types
      switch (data.message_type) {
        case 'translated_transcription':
          this.handleTranslatedTranscription(data.data);
          break;
        case 'partial_transcription':
          this.handlePartialTranscription(data.data);
          break;
        case 'partial_translated_transcription':
          this.handlePartialTranslatedTranscription(data.data);
          break;
        case 'validated_transcription':
          this.handleValidatedTranscription(data.data);
          break;
        case 'error':
          this.handleError(data.data);
          break;
        default:
          // Unknown message types are forwarded to realtime event handler
          this.eventHandlers.onRealtimeEvent?.({
            source: 'server',
            event: {
              type: 'error',
              data: data
            }
          });
      }
    } catch (error: any) {
      console.error("[Sokuji] [PalabraAIClient] Error parsing data:", error);
      // Notify about parsing error
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: {
          type: 'error',
          data: { error: error.message, rawMessage: message }
        }
      });
    }
  }

  /**
   * Check if the received data is a queue status message
   * Queue status messages have language codes as keys with queue level information
   */
  private isQueueStatusMessage(data: any): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }
    
    // Check if it's a simple object with language code keys
    const keys = Object.keys(data);
    if (keys.length === 0) {
      return false;
    }
    
    // Check if all keys are potential language codes (2-3 letter codes)
    const allKeysAreLangCodes = keys.every(key => 
      typeof key === 'string' && 
      key.length >= 2 && 
      key.length <= 3 && 
      /^[a-z]+$/.test(key)
    );
    
    if (!allKeysAreLangCodes) {
      return false;
    }
    
    // Check if values contain queue level information
    const allValuesAreQueueInfo = keys.every(key => {
      const value = data[key];
      return value && 
        typeof value === 'object' && 
        (value.hasOwnProperty('current_queue_level_ms') || 
         value.hasOwnProperty('max_queue_level_ms'));
    });
    
    return allValuesAreQueueInfo;
  }

  private handleTranslatedTranscription(data: any): void {
    const transcriptionData = typeof data === 'string' ? JSON.parse(data) : data;
    const text = transcriptionData.transcription?.text || '';
    const transcriptionId = transcriptionData.transcription?.transcription_id || `fallback_${Date.now()}`;
    
    // Notify about translated transcription event
    this.eventHandlers.onRealtimeEvent?.({
      source: 'server',
      event: {
        type: 'translated_transcription',
        data: transcriptionData
      }
    });
    
    if (text) {
      const itemId = `translated_${transcriptionId}`;
      
      // Check if translated item already exists to avoid duplicates
      const existingItem = this.conversationItems.find(item => item.id === itemId);
      
      if (!existingItem) {
        // Create conversation item for translated text using transcription_id
        const item: ConversationItem = {
          id: itemId,
          role: 'assistant',
          type: 'message',
          status: 'completed',
          formatted: {
            transcript: text
          }
        };
        
        this.conversationItems.push(item);
        
        // Notify event handlers
        this.eventHandlers.onConversationUpdated?.({ item });
      }
      // If item already exists, it's a duplicate - ignore it
    }
  }

  private handlePartialTranscription(data: any): void {
    const transcriptionData = typeof data === 'string' ? JSON.parse(data) : data;
    const text = transcriptionData.transcription?.text || '';
    const transcriptionId = transcriptionData.transcription?.transcription_id || `fallback_${Date.now()}`;
    
    // Notify about partial transcription event
    this.eventHandlers.onRealtimeEvent?.({
      source: 'server',
      event: {
        type: 'partial_transcription',
        data: transcriptionData
      }
    });
    
    if (text) {
      // Check if there's already a validated item for this transcription_id
      const validatedItemId = `validated_${transcriptionId}`;
      const existingValidatedItem = this.conversationItems.find(item => item.id === validatedItemId);
      
      if (existingValidatedItem) {
        // Ignore partial transcription if already validated
        return;
      }
      
      // Use transcription_id to find or create partial transcription item
      const itemId = `partial_${transcriptionId}`;
      let item = this.conversationItems.find(item => item.id === itemId);
      
      if (!item) {
        // Create new partial item
        item = {
          id: itemId,
          role: 'user',
          type: 'message',
          status: 'in_progress',
          formatted: {
            transcript: text
          }
        };
        this.conversationItems.push(item);
        
        // Notify event handlers
        this.eventHandlers.onConversationUpdated?.({ item });
      } else {
        // Update existing partial item with latest content
        item.formatted = {
          transcript: text
        };
        item.status = 'in_progress'; // Ensure status is in_progress for partial
        
        // Notify event handlers of update
        this.eventHandlers.onConversationUpdated?.({ item });
      }
    }
  }

  private handlePartialTranslatedTranscription(data: any): void {
    const transcriptionData = typeof data === 'string' ? JSON.parse(data) : data;
    const text = transcriptionData.transcription?.text || '';
    const transcriptionId = transcriptionData.transcription?.transcription_id || `fallback_${Date.now()}`;

    // Notify about partial translated transcription event
    this.eventHandlers.onRealtimeEvent?.({
      source: 'server',
      event: {
        type: 'partial_translated_transcription',
        data: transcriptionData
      }
    });

    if (text) {
      // Check if there's already a translated item for this transcription_id
      const translatedItemId = `translated_${transcriptionId}`;
      const existingTranslatedItem = this.conversationItems.find(item => item.id === translatedItemId);
      
      if (existingTranslatedItem) {
        // Ignore partial translated transcription if already translated
        return;
      }
      
      // Use transcription_id to find or create partial translated transcription item
      const itemId = `partial_translated_${transcriptionId}`;
      let item = this.conversationItems.find(item => item.id === itemId);

      if (!item) {
        // Create new partial translated item
        item = {
          id: itemId,
          role: 'assistant',
          type: 'message',
          status: 'in_progress',
          formatted: {
            transcript: text
          }
        };
        this.conversationItems.push(item);
        
        // Notify event handlers
        this.eventHandlers.onConversationUpdated?.({ item });
      } else {
        // Update existing partial translated item with latest content
        item.formatted = {
          transcript: text
        };
        item.status = 'in_progress'; // Ensure status is in_progress for partial
        
        // Notify event handlers of update
        this.eventHandlers.onConversationUpdated?.({ item });
      }
    }
  }

  private handleValidatedTranscription(data: any): void {
    const transcriptionData = typeof data === 'string' ? JSON.parse(data) : data;
    const text = transcriptionData.transcription?.text || '';
    const transcriptionId = transcriptionData.transcription?.transcription_id || `fallback_${Date.now()}`;
    
    // Notify about validated transcription event
    this.eventHandlers.onRealtimeEvent?.({
      source: 'server',
      event: {
        type: 'validated_transcription',
        data: transcriptionData
      }
    });
    
    if (text) {
      // Find the partial transcription with the same transcription_id
      const partialItemId = `partial_${transcriptionId}`;
      const validatedItemId = `validated_${transcriptionId}`;
      
      // Check if validated item already exists to avoid duplicates
      const existingValidatedItem = this.conversationItems.find(item => item.id === validatedItemId);
      
      if (!existingValidatedItem) {
        // Find partial item to complete
        const partialItem = this.conversationItems.find(item => 
          item.id === partialItemId && item.status === 'in_progress'
        );
        
        if (partialItem) {
          // Complete the partial transcription
          partialItem.status = 'completed';
          partialItem.id = validatedItemId;
          partialItem.formatted = {
            transcript: text
          };
          
          // Notify event handlers with updated item
          this.eventHandlers.onConversationUpdated?.({ item: partialItem });
        } else {
          // Create new validated item if no partial item found
          const item: ConversationItem = {
            id: validatedItemId,
            role: 'user',
            type: 'message',
            status: 'completed',
            formatted: {
              transcript: text
            }
          };
          this.conversationItems.push(item);
          
          // Notify event handlers
          this.eventHandlers.onConversationUpdated?.({ item });
        }
      }
      // If validated item already exists, it's a duplicate - ignore it
    }
  }

  private handleError(data: any): void {
    const errorData = typeof data === 'string' ? JSON.parse(data) : data;
    
    // Notify about error event
    this.eventHandlers.onRealtimeEvent?.({
      source: 'server',
      event: {
        type: 'error',
        data: errorData
      }
    });
    
    console.error("[Sokuji] [PalabraAIClient] Received error:", errorData);
  }

  private handleRoomConnected(): void {
    console.info("[Sokuji] [PalabraAIClient] Room connected");
    
    // Notify about room connection event
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'session.opened',
        data: { sessionId: this.currentSessionId }
      }
    });
    
    if (this.eventHandlers.onOpen) {
      this.eventHandlers.onOpen();
    }
  }

  private handleRoomDisconnected(): void {
    console.info("[Sokuji] [PalabraAIClient] Room disconnected");
    
    // Notify about room disconnection event
    this.eventHandlers.onRealtimeEvent?.({
      source: 'client',
      event: {
        type: 'session.closed',
        data: { sessionId: this.currentSessionId }
      }
    });
    
    if (this.eventHandlers.onClose) {
      this.eventHandlers.onClose(null);
    }
  }

  private cleanupAudio(): void {
    if (this.audioDestination) {
      this.audioDestination.disconnect();
      this.audioDestination = null;
    }
    
    if (this.customAudioTrack) {
      this.customAudioTrack.stop();
      this.customAudioTrack = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.cleanupRemoteAudio();
  }

  /**
   * Get all existing sessions for the current user
   */
  private async getUserSessions(): Promise<PalabraAISessionData[]> {
    try {
      const response = await fetch(`${PalabraAIClient.API_BASE_URL}/session-storage/sessions`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'ClientId': this.clientId,
          'ClientSecret': this.clientSecret,
        }
      });

      if (!response.ok) {
        console.warn("[Sokuji] [PalabraAIClient] Failed to get sessions:", response.statusText);
        return [];
      }

      const data = await response.json();
      // Raw API responses omitted from routine logs
      
      // Handle different possible response structures
      let sessions: PalabraAISessionData[] = [];
      
      if (data && Array.isArray(data)) {
        // Response is directly an array
        sessions = data;
      } else if (data && data.data && Array.isArray(data.data)) {
        // Response has a data property with array
        sessions = data.data;
      } else if (data && data.sessions) {
        // Response has a sessions property with array or null
        sessions = data.sessions;
      } else if (data && data.data && 'sessions' in data.data) {
        // This handles {"data": {"sessions": [...]}} and {"data": {"sessions": null}}
        sessions = data.data.sessions;
      } else {
        console.warn("[Sokuji] [PalabraAIClient] Unexpected response structure:", data);
        return [];
      }
      
      console.info("[Sokuji] [PalabraAIClient] Retrieved existing sessions:", (sessions || []).length);
      return sessions || [];
      
    } catch (error) {
      console.error("[Sokuji] [PalabraAIClient] Error getting sessions:", error);
      return [];
    }
  }

  /**
   * Delete a specific session by ID
   */
  private async deleteSession(sessionId: string): Promise<void> {
    try {
      const response = await fetch(`${PalabraAIClient.API_BASE_URL}/session-storage/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: {
          'ClientId': this.clientId,
          'ClientSecret': this.clientSecret,
        }
      });

      if (response.ok || response.status === 204) {
        console.info("[Sokuji] [PalabraAIClient] Session deleted successfully:", sessionId);
      } else {
        console.warn("[Sokuji] [PalabraAIClient] Failed to delete session:", sessionId, response.statusText);
      }
    } catch (error) {
      console.error("[Sokuji] [PalabraAIClient] Error deleting session:", sessionId, error);
    }
  }

  /**
   * Clean up all existing sessions
   */
  private async cleanupExistingSessions(): Promise<void> {
    try {
      const existingSessions = await this.getUserSessions();
      
      if (!existingSessions || !Array.isArray(existingSessions) || existingSessions.length === 0) {
        console.info("[Sokuji] [PalabraAIClient] No existing sessions to clean up");
        return;
      }

      console.info("[Sokuji] [PalabraAIClient] Cleaning up existing sessions:", existingSessions.length);
      
      // Delete all existing sessions
      const deletePromises = existingSessions.map(session => {
        if (session && session.id) {
          return this.deleteSession(session.id);
        } else {
          console.warn("[Sokuji] [PalabraAIClient] Invalid session object:", session);
          return Promise.resolve();
        }
      });
      
      await Promise.all(deletePromises);
      console.info("[Sokuji] [PalabraAIClient] Cleanup completed");
      
    } catch (error) {
      console.error("[Sokuji] [PalabraAIClient] Error during cleanup:", error);
      // Don't throw here, allow connection to continue
    }
  }

  private cleanupRemoteAudio(): void {
    if (this.hiddenAudioElement) {
      this.hiddenAudioElement.remove();
      this.hiddenAudioElement = null;
    }

    if (this.remoteAudioWorkletNode) {
      this.remoteAudioWorkletNode.port.onmessage = null;
      this.remoteAudioWorkletNode.disconnect();
      this.remoteAudioWorkletNode = null;
    }
    if (this.remoteAudioSource) {
      this.remoteAudioSource.disconnect();
      this.remoteAudioSource = null;
    }
    if (this.remoteAudioContext) {
      this.remoteAudioContext.close();
      this.remoteAudioContext = null;
    }
    this.remoteAudioStream = null;
  }
} 