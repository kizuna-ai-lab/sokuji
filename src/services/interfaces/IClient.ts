/**
 * Abstract interface for AI clients (OpenAI, Gemini, etc.)
 * This interface provides a unified API for different AI providers
 */

import { RealtimeEvent } from '../../contexts/LogContext';

export interface ConversationItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  type: 'message' | 'function_call' | 'function_call_output';
  status: 'in_progress' | 'completed' | 'incomplete' | 'cancelled';
  formatted?: {
    text?: string;
    transcript?: string;
    audio?: Int16Array | ArrayBuffer;
    tool?: {
      name: string;
      arguments: string;
    };
    output?: string;
    file?: any;
  };
  content?: Array<{
    type: string;
    text?: string;
    audio?: any;
    transcript?: string;
  }>;
}

export interface SessionConfig {
  model: string;
  voice?: string;
  instructions?: string;
  temperature?: number;
  maxTokens?: number | string;
  turnDetection?: {
    type: 'server_vad' | 'semantic_vad' | 'none';
    threshold?: number;
    prefixPadding?: number;
    silenceDuration?: number;
    eagerness?: string;
    createResponse?: boolean;
    interruptResponse?: boolean;
  };
  inputAudioTranscription?: {
    model: string;
  };
  inputAudioNoiseReduction?: {
    type: 'near_field' | 'far_field';
  };
}

export interface ClientEventHandlers {
  onOpen?: () => void;
  onClose?: (event: any) => void;
  onError?: (error: any) => void;
  onConversationUpdated?: (data: { item: ConversationItem; delta?: any }) => void;
  onConversationInterrupted?: () => void;
  onRealtimeEvent?: (event: RealtimeEvent) => void;
}

/**
 * API Key validation result interface
 */
export interface ApiKeyValidationResult {
  valid: boolean | null;
  message: string;
  validating: boolean;
  hasRealtimeModel?: boolean;
}

/**
 * Model information interface
 */
export interface FilteredModel {
  id: string;
  type: 'realtime' | 'audio';
  created: number;
}

export interface IClient {
  // Connection management
  connect(config: SessionConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // Session management
  updateSession(config: Partial<SessionConfig>): void;
  reset(): void;
  
  // Audio input
  appendInputAudio(audioData: Int16Array): void;
  
  // Response generation
  createResponse(): void;
  cancelResponse(trackId?: string, offset?: number): void;
  
  // Conversation management
  getConversationItems(): ConversationItem[];
  
  // Event handling
  setEventHandlers(handlers: ClientEventHandlers): void;
  
  // Provider-specific information
  getProvider(): 'openai' | 'gemini';
}

/**
 * Static methods interface for client classes
 * These methods should be implemented as static methods in client classes
 */
export interface IClientStatic {
  /**
   * Validate API key for the provider
   */
  validateApiKey(apiKey: string): Promise<ApiKeyValidationResult>;
  
  /**
   * Fetch available models from the provider
   */
  fetchAvailableModels(apiKey: string): Promise<FilteredModel[]>;
  
  /**
   * Get the latest realtime model ID
   */
  getLatestRealtimeModel(models: FilteredModel[]): string;
} 