/**
 * Abstract interface for AI clients (OpenAI, Gemini, etc.)
 * This interface provides a unified API for different AI providers
 */

import { RealtimeEvent } from '../../contexts/LogContext';
import { ProviderType } from '../../types/Provider';

export interface ConversationItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  type: 'message' | 'function_call' | 'function_call_output' | 'error';
  status: 'in_progress' | 'completed' | 'incomplete' | 'cancelled';
  source?: 'speaker' | 'participant'; // Source of the conversation item (speaker's mic or participant's system audio)
  createdAt?: number; // Timestamp for accurate sorting
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
    transcript?: string | null;
  }>;
}

/**
 * Base session configuration shared by all providers
 */
export interface BaseSessionConfig {
  model: string;
  voice?: string;
  instructions?: string;
  temperature?: number;
  maxTokens?: number | string;
  textOnly?: boolean; // If true, only generate text responses (no audio output)
}

/**
 * OpenAI-specific session configuration
 */
export interface OpenAISessionConfig extends BaseSessionConfig {
  provider: 'openai' | 'cometapi';
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

/**
 * Gemini-specific session configuration
 */
export interface GeminiSessionConfig extends BaseSessionConfig {
  provider: 'gemini';
  // Add Gemini-specific configuration here as needed
}

/**
 * PalabraAI-specific session configuration
 */
export interface PalabraAISessionConfig extends BaseSessionConfig {
  provider: 'palabraai';
  sourceLanguage: string;
  targetLanguage: string;
  voiceId: string;
  segmentConfirmationSilenceThreshold: number;
  sentenceSplitterEnabled: boolean;
  translatePartialTranscriptions: boolean;
  desiredQueueLevelMs: number;
  maxQueueLevelMs: number;
  autoTempo: boolean;
}

/**
 * Volcengine-specific session configuration
 */
export interface VolcengineSessionConfig extends BaseSessionConfig {
  provider: 'volcengine';
  sourceLanguage: string;
  targetLanguages: string[];
  hotWordList?: Array<{ Word: string; Scale: number }>;
}

/**
 * Union type for all possible session configurations
 */
export type SessionConfig = OpenAISessionConfig | GeminiSessionConfig | PalabraAISessionConfig | VolcengineSessionConfig;

/**
 * Type guards for session configurations
 */
export function isOpenAISessionConfig(config: SessionConfig): config is OpenAISessionConfig {
  return config.provider === 'openai' || config.provider === 'cometapi';
}

export function isGeminiSessionConfig(config: SessionConfig): config is GeminiSessionConfig {
  return config.provider === 'gemini';
}

export function isPalabraAISessionConfig(config: SessionConfig): config is PalabraAISessionConfig {
  return config.provider === 'palabraai';
}

export function isVolcengineSessionConfig(config: SessionConfig): config is VolcengineSessionConfig {
  return config.provider === 'volcengine';
}

/**
 * Response configuration for per-turn instructions
 * Used to override session-level settings for individual responses
 * This is the core mechanism for preventing model drift by reinforcing
 * the translator role at each response generation
 */
export interface ResponseConfig {
  /**
   * Per-turn instructions that override session-level instructions
   * Should be short anchoring instructions to prevent model drift
   * Example: "TRANSLATE_ONLY; NO_ANSWERS; OUTPUT=Japanese"
   */
  instructions?: string;

  /**
   * Optional conversation ID for out-of-band responses
   * Set to 'none' to create responses without affecting conversation state
   */
  conversation?: 'auto' | 'none';

  /**
   * Output modalities for this response
   * Useful for creating text-only responses in certain scenarios
   */
  modalities?: ('text' | 'audio')[];

  /**
   * Optional metadata for response tracking and filtering
   * Used to identify special responses like anchors that should be filtered from UI
   */
  metadata?: Record<string, string>;
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

  // Text input
  appendInputText(text: string): void;

  // Response generation
  /**
   * Create a response from the AI model
   * @param config Optional configuration to override session-level settings for this response
   *               Used for per-turn instructions to prevent model drift
   */
  createResponse(config?: ResponseConfig): void;
  cancelResponse(trackId?: string, offset?: number): void;

  // Conversation management
  getConversationItems(): ConversationItem[];

  // Event handling
  setEventHandlers(handlers: ClientEventHandlers): void;

  // Provider-specific information
  getProvider(): ProviderType;

  // Optional device control methods (WebRTC only)
  switchInputDevice?(deviceId: string): Promise<void>;
  switchOutputDevice?(deviceId: string): Promise<void>;
  setOutputMuted?(muted: boolean): void;
  setOutputVolume?(volume: number): void;
}

/**
 * Static methods interface for client classes
 * These methods should be implemented as static methods in client classes
 */
export interface IClientStatic {
  /**
   * Validate API key and fetch available models in a single request
   */
  validateApiKeyAndFetchModels(apiKey: string): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }>;
  
  /**
   * Get the latest realtime model ID
   */
  getLatestRealtimeModel(models: FilteredModel[]): string;
} 