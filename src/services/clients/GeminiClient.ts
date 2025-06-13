import { GoogleGenAI, LiveConnectConfig, LiveServerContent, LiveServerMessage } from '@google/genai';
import { IClient, ConversationItem, SessionConfig, ClientEventHandlers, ApiKeyValidationResult, FilteredModel, IClientStatic } from '../interfaces/IClient';
import i18n from '../../locales';

/**
 * Gemini Live API client adapter
 * Implements the IClient interface for Google's Gemini Live API
 */
export class GeminiClient implements IClient {
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
   * Validate Gemini API key by attempting to create a client
   * Note: Gemini doesn't have a dedicated models endpoint, so we simulate validation
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

      // For Gemini, we'll try to create a client instance
      // This is a basic validation - in a real scenario, you might want to make a test API call
      const testClient = new GoogleGenAI({ apiKey });
      
      console.info("[Sokuji] [GeminiClient] API key validation attempt");
      
      // For now, we'll assume the key is valid if it's in the correct format
      // A more robust implementation would make a test API call
      const isValidFormat = apiKey.trim().length > 10; // Basic format check
      
      if (!isValidFormat) {
        return {
          valid: false,
          message: i18n.t('settings.errorValidatingApiKey'),
          validating: false
        };
      }

      // Return success for Gemini
      return {
        valid: true,
        message: i18n.t('settings.apiKeyValidationCompleted'),
        validating: false,
        hasRealtimeModel: true // Gemini Live supports realtime by default
      };
      
    } catch (error: any) {
      console.error("[Sokuji] [GeminiClient] API key validation error:", error);
      return {
        valid: false,
        message: error.message || i18n.t('settings.errorValidatingApiKey'),
        validating: false
      };
    }
  }

  /**
   * Fetch available models for Gemini
   * Note: Gemini Live has predefined models, so we return a static list
   */
  static async fetchAvailableModels(apiKey: string): Promise<FilteredModel[]> {
    try {
      if (!apiKey || apiKey.trim() === '') {
        throw new Error('API key is required');
      }

      // Return predefined Gemini Live models
      // These are the models that support live conversation
      const geminiModels: FilteredModel[] = [
        {
          id: 'gemini-2.0-flash-exp',
          type: 'realtime',
          created: Date.now() / 1000 // Current timestamp
        },
        {
          id: 'gemini-exp-1206',
          type: 'realtime',
          created: Date.now() / 1000 - 86400 // Yesterday
        }
      ];

      console.info("[Sokuji] [GeminiClient] Available models:", geminiModels);
      return geminiModels;
      
    } catch (error: any) {
      console.error("[Sokuji] [GeminiClient] Error fetching models:", error);
      throw error;
    }
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
    
    // Fallback to default Gemini model
    return 'gemini-2.0-flash-exp';
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