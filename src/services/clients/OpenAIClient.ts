import { RealtimeClient } from 'openai-realtime-api';
import type { 
  RealtimeEvent as OpenAIRealtimeEvent,
  Realtime,
  FormattedItem
} from 'openai-realtime-api';
import { IClient, ConversationItem, SessionConfig, ClientEventHandlers, ApiKeyValidationResult, FilteredModel } from '../interfaces/IClient';
import { RealtimeEvent } from '../../contexts/LogContext';
import { Provider, ProviderType } from '../../types/Provider';
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
  private static readonly DEFAULT_API_HOST = 'https://api.openai.com';
  
  private client: RealtimeClient;
  private eventHandlers: ClientEventHandlers = {};
  private apiKey: string;
  private apiHost: string;

  constructor(apiKey: string, apiHost?: string) {
    this.apiKey = apiKey;
    this.apiHost = apiHost || OpenAIClient.DEFAULT_API_HOST;
    
    // Remove trailing slash from API host if present
    this.apiHost = this.apiHost.replace(/\/$/, '');
    
    this.client = new RealtimeClient({
      apiKey: apiKey,
      dangerouslyAllowAPIKeyInBrowser: true,
      url: `${this.apiHost}/v1/realtime`
    });
    this.setupEventListeners();
  }

  /**
   * Validate API key and fetch available models in a single request
   */
  static async validateApiKeyAndFetchModels(apiKey: string, apiHost?: string): Promise<{
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
      
      // Use provided API host or default
      const host = apiHost || this.DEFAULT_API_HOST;
      const modelsEndpoint = `${host.replace(/\/$/, '')}/v1/models`;
      
      // Make request to OpenAI API models endpoint
      const response = await fetch(modelsEndpoint, {
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
          validation: {
            valid: false,
            message: errorData.error?.message || i18n.t('settings.errorValidatingApiKey'),
            validating: false
          },
          models: []
        };
      }
      
      // Parse successful response
      const data = await response.json();
      const availableModels = data.data || [];
      
      // Check for realtime models availability
      const hasRealtimeModel = this.checkRealtimeModelAvailability(availableModels);

        console.info("[Sokuji] [OpenAIClient] Available models:", availableModels);
        console.info("[Sokuji] [OpenAIClient] Has realtime model:", hasRealtimeModel);
      
      // Filter relevant models
      const filteredModels = this.filterRelevantModels(availableModels);
      
      // Return validation result and models
      return {
        validation: this.buildValidationResult(hasRealtimeModel),
        models: filteredModels
      };
      
    } catch (error: any) {
        console.error("[Sokuji] [OpenAIClient] API key validation error:", error);
      return {
        validation: {
          valid: false,
          message: error.message || i18n.t('settings.errorValidatingApiKey'),
          validating: false
        },
        models: []
      };
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
      // Support both old format (gpt-4o-realtime) and new format (gpt-realtime)
      return (modelName.includes('realtime') && modelName.includes('4o')) || 
             modelName.startsWith('gpt-realtime');
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
      
      // Check for realtime models (both 4o/mini variants and new gpt-realtime format)
      if ((modelName.includes('realtime') && (modelName.includes('4o') || modelName.includes('gpt-4'))) ||
          modelName.startsWith('gpt-realtime')) {
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
    // Handle realtime events - using 'realtime.event' custom event
    this.client.on('realtime.event', (realtimeEvent: OpenAIRealtimeEvent) => {
      const standardizedEvent: RealtimeEvent = {
        source: realtimeEvent.source || 'server',
        event: {
          type: realtimeEvent.event.type || 'unknown',
          data: realtimeEvent
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
    this.client.on('conversation.updated', async (event: any) => {
      const { item, delta } = event;
      const conversationItem = this.convertToConversationItem(item);
      this.eventHandlers.onConversationUpdated?.({ item: conversationItem, delta });
    });
  }

  private convertToConversationItem(item: Realtime.Item | FormattedItem): ConversationItem {
    // Type assertion to access properties that may not be available on all ItemType variants
    const itemAny = item;
    
    return {
      id: item.id,
      role: item.role as 'user' | 'assistant' | 'system',
      type: item.type as 'message' | 'function_call' | 'function_call_output',
      status: itemAny.status || 'completed',
      formatted: 'formatted' in item && item.formatted ? {
        text: item.formatted!.text,
        transcript: item.formatted!.transcript,
        audio: item.formatted!.audio,
        tool: item.formatted!.tool ? {
          name: item.formatted!.tool.name,
          arguments: item.formatted!.tool.arguments
        } : undefined,
        output: item.formatted!.output,
        file: item.formatted!.file
      } : undefined,
      content: itemAny.content || []
    };
  }

  async connect(config: SessionConfig): Promise<void> {
    // Create new client instance with fresh API key, API host and model
    this.client = new RealtimeClient({
      apiKey: this.apiKey,
      dangerouslyAllowAPIKeyInBrowser: true,
      url: `${this.apiHost}/v1/realtime`,
      model: config.model
    });
    
    // Re-setup event listeners for new client
    this.setupEventListeners();

    // Connect to the API
    await this.client.connect();

    // Update session configuration immediately after connection
    // This is important to send configuration as soon as possible
    this.updateSession(config);
    
    // Wait for the session to be fully created by the server
    // This ensures MainPanel only allows user interaction after session is ready
    await this.client.waitForSessionCreated();
    
    // Only send these events after session is created
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
          apiHost: this.apiHost
        } 
      }
    });
    
    // Critical: Only call onOpen after session is truly ready
    // This ensures MainPanel's setIsSessionActive(true) happens at the right time
    this.eventHandlers.onOpen?.();
  }

  async disconnect(): Promise<void> {
    this.client.disconnect();
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
    return this.client.isConnected;
  }

  updateSession(config: Partial<SessionConfig>): void {
    const updateParams: any = {};

    if (config.model) updateParams.model = config.model;
    if (config.voice) updateParams.voice = config.voice;
    if (config.instructions) updateParams.instructions = config.instructions;
    if (config.temperature !== undefined) updateParams.temperature = config.temperature;
    if (config.maxTokens !== undefined) updateParams.max_response_output_tokens = config.maxTokens;

    // Handle turn detection (only for OpenAI/CometAPI configurations)
    if ('turnDetection' in config && config.turnDetection) {
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

    // Handle noise reduction (only for OpenAI/CometAPI configurations)
    if ('inputAudioNoiseReduction' in config && config.inputAudioNoiseReduction) {
      updateParams.input_audio_noise_reduction = {
        type: config.inputAudioNoiseReduction.type === 'near_field' ? 'near_field' :
              config.inputAudioNoiseReduction.type === 'far_field' ? 'far_field' : undefined
      };
      if (!updateParams.input_audio_noise_reduction.type) {
        delete updateParams.input_audio_noise_reduction;
      }
    }

    // Handle transcription (only for OpenAI/CometAPI configurations)
    if ('inputAudioTranscription' in config && config.inputAudioTranscription) {
      updateParams.input_audio_transcription = {
        model: config.inputAudioTranscription.model,
        language: undefined,
        prompt: undefined
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

  getProvider(): ProviderType {
    return Provider.OPENAI;
  }
} 