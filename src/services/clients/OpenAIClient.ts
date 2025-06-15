import { RealtimeClient } from '@openai/realtime-api-beta';
import { ItemType } from '@openai/realtime-api-beta/dist/lib/client.js';
import { IClient, ConversationItem, SessionConfig, ClientEventHandlers, ApiKeyValidationResult, FilteredModel, IClientStatic } from '../interfaces/IClient';
import { RealtimeEvent } from '../../contexts/LogContext';
import i18n from '../../locales';

/**
 * OpenAI model information interface
 */
interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

/**
 * OpenAI Realtime API client adapter
 * Implements the IClient interface for OpenAI's Realtime API
 */
export class OpenAIClient implements IClient {
  private static readonly MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
  
  private client: RealtimeClient;
  private eventHandlers: ClientEventHandlers = {};
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = new RealtimeClient({
      apiKey,
      dangerouslyAllowAPIKeyInBrowser: true,
    });
    this.setupEventListeners();
  }

  /**
   * Validate OpenAI API key by making a request to the models endpoint
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
      
      // Make request to OpenAI API models endpoint
      const response = await fetch(this.MODELS_ENDPOINT, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      console.info("[Sokuji] [OpenAIClient] Validation response:", response);
      
      // Handle non-200 responses
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          valid: false,
          message: errorData.error?.message || i18n.t('settings.errorValidatingApiKey'),
          validating: false
        };
      }
      
      // Parse successful response
      const data = await response.json();
      const availableModels = data.data || [];
      
      // Check for realtime models availability
      const hasRealtimeModel = this.checkRealtimeModelAvailability(availableModels);
      
      console.info("[Sokuji] [OpenAIClient] Available models:", availableModels);
      console.info("[Sokuji] [OpenAIClient] Has realtime model:", hasRealtimeModel);
      
      // Return validation result based on realtime model availability
      return this.buildValidationResult(hasRealtimeModel);
      
    } catch (error: any) {
      console.error("[Sokuji] [OpenAIClient] API key validation error:", error);
      return {
        valid: false,
        message: error.message || i18n.t('settings.errorValidatingApiKey'),
        validating: false
      };
    }
  }

  /**
   * Fetch available models from OpenAI API
   */
  static async fetchAvailableModels(apiKey: string): Promise<FilteredModel[]> {
    try {
      if (!apiKey || apiKey.trim() === '') {
        throw new Error('API key is required');
      }

      const response = await fetch(this.MODELS_ENDPOINT, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || 'Failed to fetch models');
      }

      const data = await response.json();
      const models: OpenAIModel[] = data.data || [];
      
      return this.filterRelevantModels(models);
    } catch (error: any) {
      console.error("[Sokuji] [OpenAIClient] Error fetching models:", error);
      throw error;
    }
  }

  /**
   * Get the latest realtime model from the filtered models
   */
  static getLatestRealtimeModel(filteredModels: FilteredModel[]): string {
    const realtimeModels = filteredModels.filter(model => model.type === 'realtime');
    
    if (realtimeModels.length > 0) {
      // Return the first one (newest due to sorting)
      return realtimeModels[0].id;
    }
    
    // Fallback to default if no realtime models found
    return 'gpt-4o-mini-realtime-preview';
  }

  /**
   * Check if realtime models are available in the models list
   */
  private static checkRealtimeModelAvailability(models: any[]): boolean {
    return models.some((model: any) => {
      const modelName = model.id?.toLowerCase() || '';
      return modelName.includes('realtime') && modelName.includes('4o');
    });
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
   * Filter models to get only realtime and audio models
   */
  private static filterRelevantModels(models: OpenAIModel[]): FilteredModel[] {
    const relevantModels: FilteredModel[] = [];

    models.forEach(model => {
      const modelName = model.id.toLowerCase();
      
      // Check for realtime models (both 4o and mini variants)
      if (modelName.includes('realtime') && (modelName.includes('4o') || modelName.includes('gpt-4'))) {
        relevantModels.push({
          id: model.id,
          type: 'realtime',
          created: model.created
        });
      }
      // Check for audio models (both 4o and mini variants)
      else if (modelName.includes('audio') && (modelName.includes('4o') || modelName.includes('gpt-4'))) {
        relevantModels.push({
          id: model.id,
          type: 'audio',
          created: model.created
        });
      }
    });

    // Sort by creation date (newest first) and then by name
    return relevantModels.sort((a, b) => {
      if (b.created !== a.created) {
        return b.created - a.created;
      }
      return a.id.localeCompare(b.id);
    });
  }

  private setupEventListeners(): void {
    // Handle realtime events
    this.client.on('realtime.event', (realtimeEvent: any) => {
              // Convert raw OpenAI event to our standardized RealtimeEvent format
        const standardizedEvent: RealtimeEvent = {
        source: 'server', // OpenAI events are always from server
        event: {
          type: realtimeEvent.event?.type || 'unknown',
          data: realtimeEvent,
          // Copy all OpenAI-specific properties for backward compatibility
          ...realtimeEvent
        }
      };
      this.eventHandlers.onRealtimeEvent?.(standardizedEvent);
    });

    // Handle errors
    this.client.on('error', (event: any) => {
      this.eventHandlers.onRealtimeEvent?.({
        source: 'client',
        event: { 
          type: 'session.error', 
          data: {
            message: event.message || event.toString(),
            type: event.type || 'error',
            error: event.error ? event.error.toString() : undefined,
            stack: event.stack,
            timestamp: event.timeStamp || Date.now(),
            // Keep original data to avoid missing information
            original: event
          }
        }
      });
      this.eventHandlers.onError?.(event);
    });

    // Handle conversation interruptions
    this.client.on('conversation.interrupted', () => {
      this.eventHandlers.onConversationInterrupted?.();
    });

    // Handle conversation updates
    this.client.on('conversation.updated', async ({ item, delta }: any) => {
      const conversationItem = this.convertToConversationItem(item);
      this.eventHandlers.onConversationUpdated?.({ item: conversationItem, delta });
    });
  }

  private convertToConversationItem(item: ItemType): ConversationItem {
    // Type assertion to access properties that may not be available on all ItemType variants
    const itemAny = item as any;
    
    return {
      id: item.id,
      role: item.role as 'user' | 'assistant' | 'system',
      type: item.type as 'message' | 'function_call' | 'function_call_output',
      status: itemAny.status || 'completed',
      formatted: item.formatted ? {
        text: item.formatted.text,
        transcript: item.formatted.transcript,
        audio: item.formatted.audio,
        tool: item.formatted.tool ? {
          name: item.formatted.tool.name,
          arguments: item.formatted.tool.arguments
        } : undefined,
        output: item.formatted.output,
        file: item.formatted.file
      } : undefined,
      content: itemAny.content || []
    };
  }

  async connect(config: SessionConfig): Promise<void> {
    // Create new client instance with fresh API key
    this.client = new RealtimeClient({
      apiKey: this.apiKey,
      dangerouslyAllowAPIKeyInBrowser: true,
    });
    
    // Re-setup event listeners for new client
    this.setupEventListeners();

    // Update session configuration
    this.updateSession(config);

    // Connect to the API
    await this.client.realtime.connect({ model: config.model });
    
    // Update session after connection
    this.client.updateSession();
    
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
          temperature: config.temperature
        } 
      }
    });
    this.eventHandlers.onOpen?.();
  }

  async disconnect(): Promise<void> {
    this.client.reset();
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

  isConnected(): boolean {
    return this.client.isConnected();
  }

  updateSession(config: Partial<SessionConfig>): void {
    const updateParams: any = {};

    if (config.model) updateParams.model = config.model;
    if (config.voice) updateParams.voice = config.voice;
    if (config.instructions) updateParams.instructions = config.instructions;
    if (config.temperature !== undefined) updateParams.temperature = config.temperature;
    if (config.maxTokens !== undefined) updateParams.max_response_output_tokens = config.maxTokens;

    // Handle turn detection
    if (config.turnDetection) {
      const td = config.turnDetection;
      if (td.type === 'none') {
        // No turn detection
      } else if (td.type === 'server_vad') {
        updateParams.turn_detection = {
          create_response: td.createResponse ?? true,
          type: 'server_vad',
          interrupt_response: td.interruptResponse ?? false,
          prefix_padding_ms: td.prefixPadding !== undefined ? Math.round(td.prefixPadding * 1000) : undefined,
          silence_duration_ms: td.silenceDuration !== undefined ? Math.round(td.silenceDuration * 1000) : undefined,
          threshold: td.threshold
        };
        // Remove undefined fields
        Object.keys(updateParams.turn_detection).forEach(key =>
          updateParams.turn_detection[key] === undefined && delete updateParams.turn_detection[key]
        );
      } else if (td.type === 'semantic_vad') {
        updateParams.turn_detection = {
          create_response: td.createResponse ?? true,
          type: 'semantic_vad',
          interrupt_response: td.interruptResponse ?? false,
          eagerness: td.eagerness?.toLowerCase(),
        };
        // Remove undefined fields
        Object.keys(updateParams.turn_detection).forEach(key =>
          updateParams.turn_detection[key] === undefined && delete updateParams.turn_detection[key]
        );
      }
    }

    // Handle noise reduction
    if (config.inputAudioNoiseReduction) {
      updateParams.input_audio_noise_reduction = {
        type: config.inputAudioNoiseReduction.type === 'near_field' ? 'near_field' :
              config.inputAudioNoiseReduction.type === 'far_field' ? 'far_field' : undefined
      };
      if (!updateParams.input_audio_noise_reduction.type) {
        delete updateParams.input_audio_noise_reduction;
      }
    }

    // Handle transcription
    if (config.inputAudioTranscription) {
      updateParams.input_audio_transcription = {
        model: config.inputAudioTranscription.model
      };
    }

    this.client.updateSession(updateParams);
  }

  reset(): void {
    this.client.reset();
  }

  appendInputAudio(audioData: Int16Array): void {
    this.client.appendInputAudio(audioData);
  }

  createResponse(): void {
    this.client.createResponse();
  }

  cancelResponse(trackId?: string, offset?: number): void {
    if (trackId && offset !== undefined) {
      this.client.cancelResponse(trackId, offset);
    }
  }

  getConversationItems(): ConversationItem[] {
    const items = this.client.conversation.getItems();
    return items.map(item => this.convertToConversationItem(item));
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = { ...handlers };
  }

  getProvider(): 'openai' | 'gemini' {
    return 'openai';
  }
} 