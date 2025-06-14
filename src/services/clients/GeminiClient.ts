import { GoogleGenAI, LiveConnectConfig, LiveServerContent, LiveServerMessage } from '@google/genai';
import { IClient, ConversationItem, SessionConfig, ClientEventHandlers, ApiKeyValidationResult, FilteredModel, IClientStatic } from '../interfaces/IClient';
import i18n from '../../locales';

/**
 * Gemini Live API client adapter
 * Implements the IClient interface for Google's Gemini Live API
 */
export class GeminiClient implements IClient {
  private static readonly MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
  
  private client: GoogleGenAI;
  private session: any = null;
  private eventHandlers: ClientEventHandlers = {};
  private apiKey: string;
  private conversationItems: ConversationItem[] = [];
  private isConnectedState = false;
  private currentModel = '';

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
   * Validate Gemini API key by making a request to the models endpoint
   */
  static async validateApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
    try {
      // Check if API key is empty or invalid
      if (!apiKey || apiKey.trim() === '') {
        return {
          valid: false,
          message: i18n.t('settings.errorValidatingApiKey'),
          validating: false
        };
      }

      // Make request to Gemini API models endpoint
      const availableModels = await this.fetchModelsFromAPI(apiKey);

      console.info("[Sokuji] [GeminiClient] Validation response: success");

      // Check for realtime models availability
      const hasRealtimeModel = this.checkRealtimeModelAvailability(availableModels);

      console.info("[Sokuji] [GeminiClient] Available models:", availableModels);
      console.info("[Sokuji] [GeminiClient] Has realtime model:", hasRealtimeModel);

      // Return validation result based on realtime model availability
      return this.buildValidationResult(hasRealtimeModel);

    } catch (error: any) {
      return this.handleValidationError(error);
    }
  }

  /**
   * Fetch available models from Gemini API
   */
  static async fetchAvailableModels(apiKey: string): Promise<FilteredModel[]> {
    try {
      this.validateApiKeyFormat(apiKey);

      const models = await this.fetchModelsFromAPI(apiKey);
      
      return this.filterRelevantModels(models);
    } catch (error: any) {
      return this.handleModelFetchError(error);
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
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: typeof config.maxTokens === 'number' ? config.maxTokens : undefined,
      },
      systemInstruction: config.instructions ? {
        parts: [{ text: config.instructions }]
      } : undefined,
    };

    // Handle voice configuration
    if (config.voice) {
      // Note: Gemini Live API voice configuration may be added here when available
      // For now, voice is handled by the provider configuration system
    }

    try {
      this.session = await this.client.live.connect({
        model: config.model,
        config: liveConfig,
        callbacks: {
          onopen: () => {
            this.isConnectedState = true;
            this.eventHandlers.onOpen?.();
          },
          onmessage: this.handleMessage.bind(this),
          onerror: (error: ErrorEvent) => {
            this.eventHandlers.onError?.(error);
          },
          onclose: (event: CloseEvent) => {
            this.isConnectedState = false;
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
    // Emit realtime event for logging
    this.eventHandlers.onRealtimeEvent?.({
      source: 'server',
      event: { type: 'message', data: message }
    });

    if (message.setupComplete) {
      // Setup is complete, ready to use
      return;
    }

    if (message.toolCall) {
      // Handle tool calls
      const conversationItem: ConversationItem = {
        id: message.toolCall.functionCalls?.[0]?.id || this.generateId(),
        role: 'assistant',
        type: 'function_call',
        status: 'completed',
        formatted: {
          tool: {
            name: message.toolCall.functionCalls?.[0]?.name || '',
            arguments: JSON.stringify(message.toolCall.functionCalls?.[0]?.args || {})
          }
        }
      };
      
      this.conversationItems.push(conversationItem);
      this.eventHandlers.onConversationUpdated?.({ item: conversationItem });
      return;
    }

    if (message.serverContent) {
      await this.handleServerContent(message.serverContent);
    }
  }

  private async handleServerContent(serverContent: LiveServerContent): Promise<void> {
    if ('interrupted' in serverContent) {
      this.eventHandlers.onConversationInterrupted?.();
      return;
    }

    if ('turnComplete' in serverContent) {
      // Turn is complete
      return;
    }

    if ('modelTurn' in serverContent && serverContent.modelTurn) {
      const parts = serverContent.modelTurn.parts || [];
      
      // Separate audio and text parts
      const audioParts = parts.filter(p => 
        p.inlineData && p.inlineData.mimeType?.startsWith('audio/pcm')
      );
      const textParts = parts.filter(p => p.text);

      // Handle audio parts
      for (const audioPart of audioParts) {
        if (audioPart.inlineData?.data) {
          const audioData = this.base64ToArrayBuffer(audioPart.inlineData.data);
          
          const conversationItem: ConversationItem = {
            id: this.generateId(),
            role: 'assistant',
            type: 'message',
            status: 'completed',
            formatted: {
              audio: new Int16Array(audioData)
            }
          };
          
          this.conversationItems.push(conversationItem);
          this.eventHandlers.onConversationUpdated?.({ 
            item: conversationItem, 
            delta: { audio: new Int16Array(audioData) }
          });
        }
      }

      // Handle text parts
      for (const textPart of textParts) {
        if (textPart.text) {
          const conversationItem: ConversationItem = {
            id: this.generateId(),
            role: 'assistant',
            type: 'message',
            status: 'completed',
            formatted: {
              text: textPart.text
            }
          };
          
          this.conversationItems.push(conversationItem);
          this.eventHandlers.onConversationUpdated?.({ item: conversationItem });
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
    const base64Audio = this.arrayBufferToBase64(audioData.buffer);
    
    this.session.sendRealtimeInput({
      media: {
        mimeType: 'audio/pcm',
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
    
    this.conversationItems.push(conversationItem);
    this.eventHandlers.onConversationUpdated?.({ item: conversationItem });
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

  getProvider(): 'openai' | 'gemini' {
    return 'gemini';
  }
} 