import { RealtimeClient } from 'openai-realtime-api';
import type { 
  RealtimeEvent as OpenAIRealtimeEvent,
  Realtime,
  FormattedItem
} from 'openai-realtime-api';
import { IClient, ConversationItem, SessionConfig, ClientEventHandlers, ApiKeyValidationResult, FilteredModel, ResponseConfig } from '../interfaces/IClient';
import { RealtimeEvent } from '../../stores/logStore';
import { Provider, ProviderType } from '../../types/Provider';
import { unwrapTranslationText } from '../../utils/textUtils';
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
  private deltaSequenceNumber: number = 0; // Track delta sequence for ordering
  private itemCreatedAtMap: Map<string, number> = new Map(); // Track item creation times
  /**
   * Cached from `config.keepReplayAudio` at connect(). When false (default),
   * `convertToConversationItem` strips `item.formatted.audio` and
   * `item.formatted.file` from the returned `ConversationItem`, so the inline
   * replay button stays hidden and no per-item PCM/WAV memory is retained in
   * the UI state. The underlying `openai-realtime-api` SDK may still cache
   * audio internally (outside our control), but we don't propagate it forward.
   * Mirrors the gating in the other provider clients.
   */
  private keepReplayAudio: boolean = false;

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
   * Fetch the raw model list from /v1/models. Shared between voice-agent
   * validation (validateApiKeyAndFetchModels below) and translate validation
   * (OpenAITranslateGAClient.validateApiKeyAndFetchModels).
   *
   * Contract: callers MUST check `error` first. When `error` is present,
   * `models` is always `[]` and must not be inspected. When `error` is
   * undefined, `models` is the parsed `/v1/models` payload (possibly empty
   * if the user has no models). Caller decides how to filter and what
   * "valid" means (different model families satisfy different providers).
   */
  static async fetchOpenAIModelsList(apiKey: string, apiHost?: string): Promise<
    | { models: OpenAIModel[]; error?: undefined }
    | { models: []; error: ApiKeyValidationResult }
  > {
    if (!apiKey || apiKey.trim() === '') {
      return {
        models: [],
        error: {
          valid: false,
          message: i18n.t('settings.errorValidatingApiKey'),
          validating: false,
        },
      };
    }

    const host = (apiHost || OpenAIClient.DEFAULT_API_HOST).replace(/\/$/, '');
    const modelsEndpoint = `${host}/v1/models`;

    try {
      const response = await fetch(modelsEndpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (errorData.error?.code === 'unsupported_country_region_territory') {
          return {
            models: [],
            error: {
              valid: false,
              message: i18n.t('settings.regionNotSupported'),
              validating: false,
            },
          };
        }

        return {
          models: [],
          error: {
            valid: false,
            message: errorData.error?.message || i18n.t('settings.errorValidatingApiKey'),
            validating: false,
          },
        };
      }

      const data = await response.json();
      return { models: data.data || [] };
    } catch (error: any) {
      return {
        models: [],
        error: {
          valid: false,
          message: error.message || i18n.t('settings.errorValidatingApiKey'),
          validating: false,
        },
      };
    }
  }

  /**
   * Validate API key and fetch available models in a single request
   */
  static async validateApiKeyAndFetchModels(apiKey: string, apiHost?: string): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    const { models, error } = await this.fetchOpenAIModelsList(apiKey, apiHost);
    if (error) {
      return { validation: error, models: [] };
    }

    console.info("[Sokuji] [OpenAIClient] Available models:", models);

    const hasRealtimeModel = this.checkRealtimeModelAvailability(models);
    console.info("[Sokuji] [OpenAIClient] Has realtime model:", hasRealtimeModel);

    const filteredModels = this.filterRelevantModels(models);

    return {
      validation: this.buildValidationResult(hasRealtimeModel),
      models: filteredModels,
    };
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
    return 'gpt-realtime-2.1-mini';
  }

  /**
   * True for end-to-end voice-agent realtime models (gpt-realtime, -mini, -1.5, -2).
   * Excludes specialized realtime models that aren't speech-to-speech, e.g.
   * `gpt-realtime-whisper` (transcription-only).
   */
  private static isVoiceAgentRealtimeModel(modelId: string): boolean {
    const name = modelId.toLowerCase();
    if (!name.startsWith('gpt-realtime')) return false;
    // Specialized realtime models that aren't end-to-end speech-to-speech
    // belong to their own dedicated providers (transcription / translation)
    // and must not surface in the voice-agent OpenAI provider's model list.
    if (name.startsWith('gpt-realtime-whisper')) return false;
    if (name.startsWith('gpt-realtime-translate')) return false;
    return true;
  }

  /**
   * True for the dedicated translation model family. Used by
   * OpenAITranslateGAClient to filter /v1/models output.
   */
  static isTranslateRealtimeModel(modelId: string): boolean {
    return modelId.toLowerCase().startsWith('gpt-realtime-translate');
  }

  /**
   * Check if realtime models are available in the models list
   */
  private static checkRealtimeModelAvailability(models: any[]): boolean {
    return models.some((model: any) => {
      const modelName = model.id || '';
      return this.isVoiceAgentRealtimeModel(modelName);
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

      // Check for end-to-end voice-agent realtime models (excludes whisper variant)
      if (this.isVoiceAgentRealtimeModel(model.id)) {
        relevantModels.push({
          id: model.id,
          type: 'realtime',
          created: model.created
        });
      }
      // Check for audio models (GA format: gpt-audio-*)
      else if (modelName.startsWith('gpt-audio')) {
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

      // Handle server-side error events
      if (realtimeEvent.event.type === 'error' && realtimeEvent.source === 'server') {
        const errorEvent = realtimeEvent.event as any;
        if (errorEvent?.error) {
          const errorType = errorEvent.error.type || 'error';
          const errorMessage = errorEvent.error.message || errorEvent.error.code || 'Unknown error';
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

          // Notify UI about the error item
          this.eventHandlers.onConversationUpdated?.({ item: errorItem });
        }
      }
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

      // Create error ConversationItem for display in UI
      const errorType = event.error?.type || event.type || 'error';
      const errorMessage = event.error?.message || event.message || 'Unknown error';
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

      // Notify UI about the error item
      this.eventHandlers.onConversationUpdated?.({ item: errorItem });
      this.eventHandlers.onError?.(event);
    });

    // Handle conversation interruptions
    this.client.on('conversation.interrupted', () => {
      this.eventHandlers.onConversationInterrupted?.();
    });

    // Handle conversation updates
    this.client.on('conversation.updated', async (event: any) => {
      const { item, delta } = event;
      
      // Add sequence number to audio deltas for ordering
      if (delta?.audio) {
        delta.sequenceNumber = ++this.deltaSequenceNumber;
        delta.timestamp = Date.now();
        console.debug('[AudioSequence] Delta received:', {
          itemId: item.id,
          sequence: delta.sequenceNumber,
          audioSize: delta.audio.length,
          timestamp: delta.timestamp
        });
      }
      
      const conversationItem = this.convertToConversationItem(item);
      this.eventHandlers.onConversationUpdated?.({ item: conversationItem, delta });
    });
  }

  private convertToConversationItem(item: Realtime.Item | FormattedItem): ConversationItem {
    // Type assertion to access properties that may not be available on all ItemType variants
    const itemAny = item;

    // Track creation time - set only on first encounter
    if (!this.itemCreatedAtMap.has(item.id)) {
      this.itemCreatedAtMap.set(item.id, Date.now());
    }

    return {
      id: item.id,
      role: item.role as 'user' | 'assistant' | 'system',
      type: item.type as 'message' | 'function_call' | 'function_call_output',
      status: itemAny.status || 'completed',
      createdAt: this.itemCreatedAtMap.get(item.id),
      formatted: 'formatted' in item && item.formatted ? {
        text: unwrapTranslationText(item.formatted!.text),
        transcript: unwrapTranslationText(item.formatted!.transcript),
        // Gated by keepReplayAudio. When false (default), the heavy replay
        // fields are dropped so the inline ▶ button stays hidden and no
        // per-item PCM/WAV memory is retained on the UI items list.
        audio: this.keepReplayAudio ? item.formatted!.audio : undefined,
        tool: item.formatted!.tool ? {
          name: item.formatted!.tool.name,
          arguments: item.formatted!.tool.arguments
        } : undefined,
        output: item.formatted!.output,
        file: this.keepReplayAudio ? item.formatted!.file : undefined
      } : undefined,
      content: itemAny.content || []
    };
  }

  /**
   * Wait for session creation with error handling and timeout
   * This wraps waitForSessionCreated() to handle:
   * 1. Server errors that occur during session creation (e.g., API errors, connection failures)
   * 2. Timeout protection to prevent infinite waiting
   */
  private waitForSessionWithErrorHandling(): Promise<void> {
    const SESSION_TIMEOUT = 30000; // 30 seconds timeout

    return new Promise<void>((resolve, reject) => {
      let isSettled = false;

      // Timeout handler
      const timeout = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          this.client.off('realtime.event', errorHandler);
          reject(new Error('Session creation timeout - server did not respond in time'));
        }
      }, SESSION_TIMEOUT);

      // Error event handler - listens for server errors during session creation
      const errorHandler = (event: any) => {
        if (event.event?.type === 'error' && !isSettled) {
          isSettled = true;
          clearTimeout(timeout);
          this.client.off('realtime.event', errorHandler);
          const errorMessage = event.event.error?.message || event.event.error?.code || 'Session creation failed';
          reject(new Error(errorMessage));
        }
      };

      // Register error handler
      this.client.on('realtime.event', errorHandler);

      // Wait for session creation
      this.client.waitForSessionCreated()
        .then(() => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeout);
            this.client.off('realtime.event', errorHandler);
            resolve();
          }
        })
        .catch((error: Error) => {
          if (!isSettled) {
            isSettled = true;
            clearTimeout(timeout);
            this.client.off('realtime.event', errorHandler);
            reject(error);
          }
        });
    });
  }

  async connect(config: SessionConfig): Promise<void> {
    // Reset delta sequence number and item creation times for new session
    this.deltaSequenceNumber = 0;
    this.itemCreatedAtMap.clear();
    this.keepReplayAudio = config.keepReplayAudio ?? false;

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

    // Wait for the session to be fully created by the server with error handling and timeout
    // This ensures MainPanel only allows user interaction after session is ready
    // Also handles server errors that occur during session creation
    await this.waitForSessionWithErrorHandling();
    
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

    // Reasoning effort: only `gpt-realtime-2` accepts this; older models reject the field.
    if (config.model?.startsWith('gpt-realtime-2') &&
        'reasoningEffort' in config && config.reasoningEffort) {
      updateParams.reasoning = { effort: config.reasoningEffort };
      console.info('[Sokuji] [OpenAIClient] reasoning.effort applied:', config.reasoningEffort);
    }

    // Explicitly disable tools to prevent model drift from translator role
    // This ensures the model stays focused on translation and doesn't attempt tool calls
    updateParams.tool_choice = 'none';
    updateParams.tools = [];

    // Handle text-only mode (no audio output)
    if ('textOnly' in config && config.textOnly) {
      updateParams.modalities = ['text'];
    }

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
    this.itemCreatedAtMap.clear();
  }

  appendInputAudio(audioData: Int16Array): void {
    this.client.appendInputAudio(audioData);
  }

  appendInputText(text: string): void {
    if (!text.trim()) {
      console.warn('[OpenAIClient] Empty text input, ignoring');
      return;
    }

    // Send user message content - the library auto-creates ConversationItem
    this.client.sendUserMessageContent([
      { type: 'input_text', text: text.trim() }
    ]);
  }

  /**
   * Create a response from the AI model
   * @param config Optional configuration to override session-level settings for this response
   *               Used for per-turn instructions to prevent model drift
   */
  createResponse(config?: ResponseConfig): void {
    if (config) {
      // When bypassing the library's createResponse(), we need to manually commit
      // the input audio buffer first (same as what the library does internally)
      // This is required when turn detection is disabled (PTT mode)
      // The library checks: !this.getTurnDetectionType() && this.inputAudioBuffer.byteLength > 0
      //
      // IMPORTANT: Skip audio buffer commit for out-of-band anchor messages
      // (conversation: 'none') as they don't use audio input and committing
      // an empty buffer causes "buffer too small" errors
      if (config.conversation !== 'none') {
        this.client.realtime.send('input_audio_buffer.commit');
      }

      // Send response.create event with per-turn configuration
      const responseEvent: any = {
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
        console.debug('[OpenAIClient] Sending out-of-band response:', {
          conversation: config.conversation,
          modalities: config.modalities,
          hasInstructions: !!config.instructions,
          metadata: config.metadata
        });
      }

      // Use the underlying realtime API to send the event
      this.client.realtime.send('response.create', responseEvent);
    } else {
      // Use the default library method when no config is provided
      this.client.createResponse();
    }
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

  clearConversationItems(): void {
    this.client.conversation.clear();
    this.itemCreatedAtMap.clear();
  }

  setEventHandlers(handlers: ClientEventHandlers): void {
    this.eventHandlers = { ...handlers };
  }

  getProvider(): ProviderType {
    return Provider.OPENAI;
  }
} 