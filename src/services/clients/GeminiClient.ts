import { ActivityHandling, GoogleGenAI, LiveConnectConfig, LiveServerContent, LiveServerMessage, Modality, Session } from '@google/genai';
import { IClient, ConversationItem, SessionConfig, ClientEventHandlers, ApiKeyValidationResult, FilteredModel, IClientStatic } from '../interfaces/IClient';
import i18n from '../../locales';
import { Provider, ProviderType } from '../../types/Provider';

/**
 * Gemini Live API client adapter
 * Implements the IClient interface for Google's Gemini Live API
 */
export class GeminiClient implements IClient {
  private static readonly MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
  
  private client: GoogleGenAI;
  private session: Session | null = null;
  private eventHandlers: ClientEventHandlers = {};
  private apiKey: string;
  private conversationItems: ConversationItem[] = [];
  private isConnectedState = false;
  private currentModel = '';
  
  // Turn accumulation state
  private currentTurn: {
    inputTranscription: string;
    modelTurnParts: any[];
    outputTranscription: string;
    audioData: Int16Array[];
    textParts: string[];
    inputTranscriptionItem?: ConversationItem;
    // Combine modelTurn and outputTranscription into a single assistant item
    assistantItem?: ConversationItem;
  } = {
    inputTranscription: '',
    modelTurnParts: [],
    outputTranscription: '',
    audioData: [],
    textParts: [],
  };

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({ apiKey });
  }

  /**
   * Make a request to Gemini API models endpoint with pagination support
   */
  private static async fetchModelsFromAPI(apiKey: string): Promise<any[]> {
    const allModels: any[] = [];
    let nextPageToken: string | undefined;

    do {
      const url = nextPageToken 
        ? `${this.MODELS_ENDPOINT}?key=${apiKey}&pageToken=${nextPageToken}`
        : `${this.MODELS_ENDPOINT}?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || 'Failed to fetch models');
      }

      const data = await response.json();
      const models = data.models || [];
      allModels.push(...models);
      
      nextPageToken = data.nextPageToken;
    } while (nextPageToken);

    return allModels;
  }

  /**
   * Check if a model is realtime capable (supports bidirectional generation)
   */
  private static isRealtimeCapableModel(model: any): boolean {
    const modelName = model.name?.toLowerCase() || '';
    
    // Check for models with "audio" or "live" in the name
    return modelName.includes('audio') || modelName.includes('live');
  }

  /**
   * Check if realtime models are available in the models list
   */
  private static checkRealtimeModelAvailability(models: any[]): boolean {
    return models.some(this.isRealtimeCapableModel);
  }

  /**
   * Build validation result based on realtime model availability
   */
  private static buildValidationResult(hasRealtimeModel: boolean): ApiKeyValidationResult {
    if (!hasRealtimeModel) {
      return {
        valid: false,
        message: i18n.t('settings.realtimeModelNotAvailable'),
        validating: false,
        hasRealtimeModel: false
      };
    }

    const message = i18n.t('settings.apiKeyValidationCompleted') + ' ' + i18n.t('settings.realtimeModelAvailable');

    return {
      valid: true,
      message: message,
      validating: false,
      hasRealtimeModel: true
    };
  }

  /**
   * Get fallback models when no suitable models found from API
   */
  private static getFallbackModels(): FilteredModel[] {
    return [
      {
        id: 'gemini-2.5-flash-preview-native-audio-dialog',
        type: 'realtime',
        created: Date.now() / 1000
      },
      {
        id: 'gemini-2.0-flash-live',
        type: 'realtime',
        created: Date.now() / 1000 - 86400
      }
    ];
  }

  /**
   * Sort models by creation date (newest first) and then by name
   */
  private static sortModels(models: FilteredModel[]): FilteredModel[] {
    return models.sort((a: FilteredModel, b: FilteredModel) => {
      if (b.created !== a.created) {
        return b.created - a.created;
      }
      return a.id.localeCompare(b.id);
    });
  }

  /**
   * Handle API key validation errors
   */
  private static handleValidationError(error: any): ApiKeyValidationResult {
    console.error("[Sokuji] [GeminiClient] API key validation error:", error);
    return {
      valid: false,
      message: error.message || i18n.t('settings.errorValidatingApiKey'),
      validating: false
    };
  }

  /**
   * Handle model fetching errors
   */
  private static handleModelFetchError(error: any): never {
    console.error("[Sokuji] [GeminiClient] Error fetching models:", error);
    throw error;
  }

  /**
   * Validate API key format and throw error if invalid
   */
  private static validateApiKeyFormat(apiKey: string): void {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('API key is required');
    }
  }

  /**
   * Validate API key and fetch available models in a single request
   */
  static async validateApiKeyAndFetchModels(apiKey: string): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    try {
      // Check if API key is empty or invalid
      if (!apiKey || apiKey.trim() === '') {
        return {
          validation: {
            valid: false,
            message: i18n.t('settings.errorValidatingApiKey'),
            validating: false
          },
          models: []
        };
      }

      // Make request to Gemini API models endpoint
      const availableModels = await this.fetchModelsFromAPI(apiKey);

      console.info("[Sokuji] [GeminiClient] Validation response: success");

      // Check for realtime models availability
      const hasRealtimeModel = this.checkRealtimeModelAvailability(availableModels);

      console.info("[Sokuji] [GeminiClient] Available models:", availableModels);
      console.info("[Sokuji] [GeminiClient] Has realtime model:", hasRealtimeModel);

      // Filter relevant models
      const filteredModels = this.filterRelevantModels(availableModels);

      // Return validation result and models
      return {
        validation: this.buildValidationResult(hasRealtimeModel),
        models: filteredModels
      };

    } catch (error: any) {
      return {
        validation: this.handleValidationError(error),
        models: []
      };
    }
  }



  /**
   * Filter models to get only realtime models
   */
  private static filterRelevantModels(models: any[]): FilteredModel[] {
    const relevantModels: FilteredModel[] = [];

    models.forEach(model => {
      // Check for realtime capable models using the shared method
      if (this.isRealtimeCapableModel(model)) {
        const modelId = model.name?.replace('models/', '') || '';
        
        // Extract creation date from model version or use current time as fallback
        let createdTime = Date.now() / 1000;
        
        // Try to extract date from version string (e.g., "2.0", "exp-03-07", "preview-04-17")
        if (model.version) {
          const versionMatch = model.version.match(/(\d{2})-(\d{2})/);
          if (versionMatch) {
            const [, month, day] = versionMatch;
            // Assume current year for simplicity
            const year = new Date().getFullYear();
            createdTime = new Date(year, parseInt(month) - 1, parseInt(day)).getTime() / 1000;
          }
        }
        
        relevantModels.push({
          id: modelId,
          type: 'realtime',
          created: createdTime
        });
      }
    });

    console.info(`[Sokuji] [GeminiClient] Found ${relevantModels.length} realtime-capable models from API`);

    // If no models found from API, return fallback models
    if (relevantModels.length === 0) {
      console.warn("[Sokuji] [GeminiClient] No suitable models found from API, using fallback models");
      return this.getFallbackModels();
    }

    // Sort by creation date (newest first) and then by name
    return this.sortModels(relevantModels);
  }

  /**
   * Get the latest realtime model for Gemini
   */
  static getLatestRealtimeModel(filteredModels: FilteredModel[]): string {
    const realtimeModels = filteredModels.filter(model => model.type === 'realtime');
    
    if (realtimeModels.length > 0) {
      // Return the first one (newest due to sorting)
      return realtimeModels[0].id;
    }
    
    // Fallback to default Gemini realtime model (contains "audio")
    return 'gemini-2.5-flash-preview-native-audio-dialog';
  }

  async connect(config: SessionConfig): Promise<void> {
    if (this.isConnectedState) {
      await this.disconnect();
    }

    this.currentModel = config.model;
    
    // Convert SessionConfig to LiveConnectConfig
    const liveConfig: LiveConnectConfig = {
      responseModalities: [Modality.AUDIO],
      temperature: config.temperature,
      maxOutputTokens: typeof config.maxTokens === 'number' ? config.maxTokens : undefined,
      systemInstruction: config.instructions ? {
        parts: [{ text: config.instructions }]
      } : undefined,
      speechConfig: config.voice ? {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: config.voice
          }
        }
      } : undefined,
      inputAudioTranscription: true,
      outputAudioTranscription: true,
      realtimeInputConfig: {
        activityHandling: ActivityHandling.NO_INTERRUPTION,
      }
    };

    try {
      this.session = await this.client.live.connect({
        model: config.model,
        config: liveConfig,
        callbacks: {
          onopen: () => {
            console.info('[Sokuji] [GeminiClient] Session opened');
            this.isConnectedState = true;
            this.eventHandlers.onRealtimeEvent?.({
              source: 'client',
              event: { 
                type: 'session.opened', 
                data: { 
                  status: 'connected',
                  provider: 'gemini',
                  model: this.currentModel,
                  timestamp: Date.now(),
                  config: {
                    temperature: liveConfig.temperature,
                    maxOutputTokens: liveConfig.maxOutputTokens,
                    systemInstruction: liveConfig.systemInstruction ? 'set' : 'none'
                  }
                } 
              }
            });
            this.eventHandlers.onOpen?.();
          },
          onmessage: this.handleMessage.bind(this),
          onerror: (error: ErrorEvent) => {
            console.error('[Sokuji] [GeminiClient] Session error:', error);
            this.eventHandlers.onRealtimeEvent?.({
              source: 'client',
              event: { 
                type: 'session.error', 
                data: {
                  message: error.message,
                  filename: error.filename,
                  lineno: error.lineno,
                  colno: error.colno,
                  type: error.type,
                  isTrusted: error.isTrusted,
                  timestamp: error.timeStamp,
                  error: error.error ? error.error.toString() : undefined
                }
              }
            });
            this.eventHandlers.onError?.(error);
          },
          onclose: (event: CloseEvent) => {
            console.info('[Sokuji] [GeminiClient] Session closed', event);
            this.isConnectedState = false;
            // Clean up session state
            this.session = null;
            this.conversationItems = [];
            this.eventHandlers.onRealtimeEvent?.({
              source: 'client',
              event: { 
                type: 'session.closed', 
                data: {
                  code: event.code,
                  reason: event.reason,
                  type: event.type,
                  wasClean: event.wasClean,
                  isTrusted: event.isTrusted,
                  timestamp: event.timeStamp
                }
              }
            });
            this.eventHandlers.onClose?.(event);
          }
        }
      });
    } catch (error) {
      this.isConnectedState = false;
      throw error;
    }
  }

  private async handleMessage(message: LiveServerMessage): Promise<void> {
    console.info('[Sokuji] [GeminiClient] Message received:', message);
    
    // Emit specific realtime events based on message content
    if (message.setupComplete) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'setupComplete', data: message.setupComplete }
      });
      // Setup is complete, ready to use
      return;
    }

    if (message.usageMetadata) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'usageMetadata', data: message.usageMetadata }
      });
    }

    if (message.toolCall) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'toolCall', data: message.toolCall }
      });
    }

    if (message.toolCallCancellation) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'toolCallCancellation', data: message.toolCallCancellation }
      });
    }

    if (message.goAway) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'goAway', data: message.goAway }
      });
    }

    if (message.sessionResumptionUpdate) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'sessionResumptionUpdate', data: message.sessionResumptionUpdate }
      });
    }

    if (message.serverContent) {
      await this.handleServerContent(message.serverContent);
    }
  }

  private resetCurrentTurn(): void {
    this.currentTurn = {
      inputTranscription: '',
      modelTurnParts: [],
      outputTranscription: '',
      audioData: [],
      textParts: [],
    };
  }

  private async finalizeTurn(): Promise<void> {
    // Create final conversation items from accumulated data
    
    // Finalize input transcription if we have accumulated text
    if (this.currentTurn.inputTranscription.trim()) {
      if (this.currentTurn.inputTranscriptionItem && this.currentTurn.inputTranscriptionItem.formatted) {
        // Update existing item with final accumulated text and mark as completed
        this.currentTurn.inputTranscriptionItem.formatted.transcript = this.currentTurn.inputTranscription.trim();
        this.currentTurn.inputTranscriptionItem.status = 'completed';
        this.eventHandlers.onConversationUpdated?.({ item: this.currentTurn.inputTranscriptionItem });
      } else {
        // Create new item if none exists
        const conversationItem: ConversationItem = {
          id: this.generateId(),
          role: 'user',
          type: 'message',
          status: 'completed',
          formatted: {
            transcript: this.currentTurn.inputTranscription.trim()
          }
        };
        this.conversationItems.push(conversationItem);
        this.eventHandlers.onConversationUpdated?.({ item: conversationItem });
      }
    }

    // Finalize assistant response (combining modelTurn and outputTranscription)
    if (this.currentTurn.audioData.length > 0 || this.currentTurn.textParts.length > 0 || this.currentTurn.outputTranscription.trim()) {
      // Combine all audio data
      let combinedAudio: Int16Array | undefined;
      if (this.currentTurn.audioData.length > 0) {
        const totalLength = this.currentTurn.audioData.reduce((sum, arr) => sum + arr.length, 0);
        combinedAudio = new Int16Array(totalLength);
        let offset = 0;
        for (const audioChunk of this.currentTurn.audioData) {
          combinedAudio.set(audioChunk, offset);
          offset += audioChunk.length;
        }
      }

      // Combine all text parts
      const combinedText = this.currentTurn.textParts.join('');
      const outputTranscript = this.currentTurn.outputTranscription.trim();

      if (this.currentTurn.assistantItem && this.currentTurn.assistantItem.formatted) {
        // Update existing item and mark as completed
        if (combinedAudio) {
          this.currentTurn.assistantItem.formatted.audio = combinedAudio;
        }
        if (combinedText) {
          this.currentTurn.assistantItem.formatted.text = combinedText;
        }
        if (outputTranscript) {
          this.currentTurn.assistantItem.formatted.transcript = outputTranscript;
        }
        this.currentTurn.assistantItem.status = 'completed';
        // Don't send audio delta in finalization to avoid duplicate playback
        this.eventHandlers.onConversationUpdated?.({ 
          item: this.currentTurn.assistantItem
        });
      } else {
        // Create new item
        const conversationItem: ConversationItem = {
          id: this.generateId(),
          role: 'assistant',
          type: 'message',
          status: 'completed',
          formatted: {}
        };

        if (combinedAudio && conversationItem.formatted) {
          conversationItem.formatted.audio = combinedAudio;
        }
        if (combinedText && conversationItem.formatted) {
          conversationItem.formatted.text = combinedText;
        }
        if (outputTranscript && conversationItem.formatted) {
          conversationItem.formatted.transcript = outputTranscript;
        }

        this.conversationItems.push(conversationItem);
        // Don't send audio delta in finalization to avoid duplicate playback
        this.eventHandlers.onConversationUpdated?.({ 
          item: conversationItem
        });
      }
    }
  }

  private async handleServerContent(serverContent: LiveServerContent): Promise<void> {
    if ('interrupted' in serverContent) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'serverContent.interrupted', data: serverContent.interrupted }
      });
      this.eventHandlers.onConversationInterrupted?.();
      // Reset current turn on interruption
      this.resetCurrentTurn();
      return;
    }

    if ('turnComplete' in serverContent) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'serverContent.turnComplete', data: serverContent.turnComplete }
      });
      
      // Finalize accumulated data and create final conversation items
      await this.finalizeTurn();
      
      // Reset for next turn
      this.resetCurrentTurn();
      return;
    }

    if ('generationComplete' in serverContent) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'serverContent.generationComplete', data: serverContent.generationComplete }
      });
    }

    if ('groundingMetadata' in serverContent && serverContent.groundingMetadata) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'serverContent.groundingMetadata', data: serverContent.groundingMetadata }
      });
    }

    if ('outputTranscription' in serverContent && serverContent.outputTranscription) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'serverContent.outputTranscription', data: serverContent.outputTranscription }
      });
      
      // Accumulate output transcription text
      if (serverContent.outputTranscription.text) {
        this.currentTurn.outputTranscription += serverContent.outputTranscription.text;
        
        // Create or update the same assistant item that handles modelTurn
        if (!this.currentTurn.assistantItem) {
          this.currentTurn.assistantItem = {
            id: this.generateId(),
            role: 'assistant',
            type: 'message',
            status: 'in_progress',
            formatted: {}
          };
          this.conversationItems.push(this.currentTurn.assistantItem);
        }
        
        // Update the transcript field of the assistant item
        if (this.currentTurn.assistantItem.formatted) {
          this.currentTurn.assistantItem.formatted.transcript = this.currentTurn.outputTranscription;
          this.eventHandlers.onConversationUpdated?.({ item: this.currentTurn.assistantItem });
        }
      }
    }

    if ('inputTranscription' in serverContent && serverContent.inputTranscription) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'serverContent.inputTranscription', data: serverContent.inputTranscription }
      });
      
      // Accumulate input transcription text
      if (serverContent.inputTranscription.text) {
        this.currentTurn.inputTranscription += serverContent.inputTranscription.text;
        
        // Create or update conversation item for real-time display
        if (!this.currentTurn.inputTranscriptionItem) {
          this.currentTurn.inputTranscriptionItem = {
            id: this.generateId(),
            role: 'user',
            type: 'message',
            status: 'in_progress',
            formatted: {
              transcript: this.currentTurn.inputTranscription
            }
          };
          this.conversationItems.push(this.currentTurn.inputTranscriptionItem);
          this.eventHandlers.onConversationUpdated?.({ item: this.currentTurn.inputTranscriptionItem });
        } else if (this.currentTurn.inputTranscriptionItem.formatted) {
          // Update existing item with accumulated text
          this.currentTurn.inputTranscriptionItem.formatted.transcript = this.currentTurn.inputTranscription;
          this.eventHandlers.onConversationUpdated?.({ item: this.currentTurn.inputTranscriptionItem });
        }
      }
    }

    if ('modelTurn' in serverContent && serverContent.modelTurn) {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'server',
        event: { type: 'serverContent.modelTurn', data: serverContent.modelTurn }
      });
      const parts = serverContent.modelTurn.parts || [];
      
      // Separate audio and text parts
      const audioParts = parts.filter(p => 
        p.inlineData && p.inlineData.mimeType?.startsWith('audio/pcm')
      );
      const textParts = parts.filter(p => p.text);

      // Track if we have new audio or text in this message
      let hasNewAudio = false;
      let hasNewText = false;
      let newAudioChunks: Int16Array[] = [];

      // Accumulate audio parts
      for (const audioPart of audioParts) {
        if (audioPart.inlineData?.data) {
          const audioData = this.base64ToArrayBuffer(audioPart.inlineData.data);
          const audioChunk = new Int16Array(audioData);
          this.currentTurn.audioData.push(audioChunk);
          newAudioChunks.push(audioChunk);
          hasNewAudio = true;
        }
      }

      // Accumulate text parts
      for (const textPart of textParts) {
        if (textPart.text) {
          this.currentTurn.textParts.push(textPart.text);
          hasNewText = true;
        }
      }

      // Create or update conversation item for real-time display
      if (hasNewAudio || hasNewText) {
        if (!this.currentTurn.assistantItem) {
          this.currentTurn.assistantItem = {
            id: this.generateId(),
            role: 'assistant',
            type: 'message',
            status: 'in_progress',
            formatted: {}
          };
          this.conversationItems.push(this.currentTurn.assistantItem);
        }

        // Update with latest accumulated data
        if (this.currentTurn.assistantItem.formatted) {
          // Update combined audio data
          if (this.currentTurn.audioData.length > 0) {
            const totalLength = this.currentTurn.audioData.reduce((sum, arr) => sum + arr.length, 0);
            const combinedAudio = new Int16Array(totalLength);
            let offset = 0;
            for (const audioChunk of this.currentTurn.audioData) {
              combinedAudio.set(audioChunk, offset);
              offset += audioChunk.length;
            }
            this.currentTurn.assistantItem.formatted.audio = combinedAudio;
          }

          // Update combined text
          if (this.currentTurn.textParts.length > 0) {
            this.currentTurn.assistantItem.formatted.text = this.currentTurn.textParts.join('');
          }

          // Preserve existing transcript from outputTranscription
          // (transcript field is managed by outputTranscription handler)

          // Only emit delta for new audio chunks to avoid duplicate playback
          if (hasNewAudio && newAudioChunks.length > 0) {
            // Combine all new audio chunks from this message
            const totalNewLength = newAudioChunks.reduce((sum, arr) => sum + arr.length, 0);
            const combinedNewAudio = new Int16Array(totalNewLength);
            let offset = 0;
            for (const audioChunk of newAudioChunks) {
              combinedNewAudio.set(audioChunk, offset);
              offset += audioChunk.length;
            }
            
            this.eventHandlers.onConversationUpdated?.({ 
              item: this.currentTurn.assistantItem, 
              delta: { audio: combinedNewAudio }
            });
          } else {
            // Update without audio delta if only text changed
            this.eventHandlers.onConversationUpdated?.({ item: this.currentTurn.assistantItem });
          }
        }
      }
    }
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private generateId(): string {
    return `gemini_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async disconnect(): Promise<void> {
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    this.isConnectedState = false;
    this.conversationItems = [];
    this.resetCurrentTurn();
  }

  isConnected(): boolean {
    return this.isConnectedState;
  }

  updateSession(config: Partial<SessionConfig>): void {
    // Gemini Live API doesn't support runtime session updates like OpenAI
    // This would require reconnecting with new configuration
    console.warn('[GeminiClient] Runtime session updates not supported. Reconnection required.');
  }

  reset(): void {
    this.conversationItems = [];
    this.resetCurrentTurn();
    if (this.session) {
      // Reset conversation state
      this.session = null;
      this.isConnectedState = false;
    }
  }

  appendInputAudio(audioData: Int16Array): void {
    if (!this.session) {
      console.warn('[GeminiClient] No active session for audio input');
      return;
    }

    // Convert Int16Array to base64 PCM format for Gemini
    const base64Audio = this.arrayBufferToBase64(audioData);
    
    this.session.sendRealtimeInput({
      media: {
        mimeType: 'audio/pcm;rate=24000',
        data: base64Audio
      }
    });

    // Create a user conversation item for the audio input
    const conversationItem: ConversationItem = {
      id: this.generateId(),
      role: 'user',
      type: 'message',
      status: 'completed',
      formatted: {
        audio: audioData
      }
    };
    
    // this.conversationItems.push(conversationItem);
    // this.eventHandlers.onConversationUpdated?.({ item: conversationItem });
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  createResponse(): void {
    // Gemini Live API automatically generates responses based on turn detection
    // This is handled internally by the API
    console.debug('[GeminiClient] Response creation is handled automatically by Gemini Live API');
  }

  cancelResponse(trackId?: string, offset?: number): void {
    // Gemini Live API doesn't support response cancellation in the same way as OpenAI
    console.warn('[GeminiClient] Response cancellation not supported');
  }

  getConversationItems(): ConversationItem[] {
    return [...this.conversationItems];
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = { ...handlers };
  }

  getProvider(): ProviderType {
    return Provider.GEMINI;
  }
} 