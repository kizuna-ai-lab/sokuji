/**
 * Abstract interface for AI clients (OpenAI, Gemini, etc.)
 * This interface provides a unified API for different AI providers
 */

import { RealtimeEvent } from '../../stores/logStore';
import type { ClientDiagnostic } from '../../lib/diagnostics/clientDiagnostics';
import { ProviderType } from '../../types/Provider';

export interface ConversationItem {
  id: string;
  role: 'user' | 'assistant' | 'system';
  type: 'message' | 'function_call' | 'function_call_output' | 'error';
  /**
   * For `type: 'error'` system rows only. `'warning'` marks a notice about a
   * session that is RUNNING, degraded (Local Native without a voice clip, a
   * Soniox custom voice that could not be prepared, a participant leg that
   * never came up) — the row still renders as the red error bubble, the one
   * system row the renderer draws, but subtitleIdleState must not read it as
   * a failed start. Absent means `'error'`: the session is broken, or never
   * started. A real `notice` item type replaces this flag under #481.
   */
  severity?: 'error' | 'warning';
  status: 'in_progress' | 'completed' | 'incomplete' | 'cancelled';
  source?: 'speaker' | 'participant'; // Source of the conversation item (speaker's mic or participant's system audio)
  createdAt?: number; // Timestamp for accurate sorting
  /**
   * The language actually detected for THIS item's text (e.g. Soniox reports
   * a per-token `language`), as an ISO code. When present, the conversation
   * bubble's language badge shows this instead of the configured
   * source/target — correct for two-way translation and auto-detect, where the
   * configured pair doesn't match what was spoken. Clients that don't receive
   * per-item language leave it undefined and the badge falls back to the
   * configured value.
   */
  detectedLanguage?: string;
  formatted?: {
    text?: string;
    transcript?: string;
    audioTextEnd?: number;
    audioSegments?: Array<{ textEnd: number; audioEnd: number }>;
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
  /**
   * If false (default), provider clients skip per-item audio chunk
   * accumulation — `item.formatted.audio` stays undefined and the inline
   * replay button is hidden. Cached at session start by each client.
   */
  keepReplayAudio?: boolean;
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
 * Local inference session configuration
 */
export interface LocalInferenceSessionConfig extends BaseSessionConfig {
  provider: 'local_inference';
  sourceLanguage: string;
  targetLanguage: string;
  asrModelId: string;
  translationModelId?: string;
  ttsModelId?: string;
  ttsSpeakerId: number;
  ttsSpeed: number;
  edgeTtsVoice?: string;
  vadThreshold?: number;
  /** vad-web only; 0 or absent derives it from vadThreshold. Never applies above it. */
  vadNegativeThreshold?: number;
  vadMinSilenceDuration?: number;
  vadMinSpeechDuration?: number;
  vadMaxSpeechDuration?: number;
  turnDetectionMode?: 'Auto' | 'Push-to-Talk' | 'Push-to-Translate';
  /**
   * Whether the active system prompt expects `<transcript>` wrapping around
   * the user message. Tracks the actual prompt, not the mode flag: true when
   * the resolved instructions equal a buildDefaultLocalPrompt output (Simple
   * mode OR Advanced-mode fallback when the user's textarea is empty); false
   * when the user provided a custom prompt in Advanced mode.
   */
  wrapTranscript?: boolean;
}

/**
 * Native (Electron sidecar) local inference: ASR → translation (→ optional TTS),
 * served by the Python sidecar over localhost WebSocket. Separate from the WASM
 * LOCAL_INFERENCE provider.
 */
export interface LocalNativeSessionConfig extends BaseSessionConfig {
  provider: 'local_native';
  sourceLanguage: string;
  targetLanguage: string;
  asrModelId: string;
  translationModelId?: string;
  ttsModelId?: string;
  ttsSpeed?: number;
  vadThreshold?: number;
  vadMinSilenceDuration?: number;
  vadMinSpeechDuration?: number;
  turnDetectionMode?: 'Auto' | 'Push-to-Talk' | 'Push-to-Translate';
  wrapTranscript?: boolean;
  asrDevice?: string;
  translationDevice?: string;
  ttsDevice?: string;
  ttsVoice?: string;
  /** Pinned quant variant for the translation model (e.g. 'fp8'). Undefined → sidecar auto-selects. */
  translationVariant?: string;
  /** User-pinned ASR quant (variant picker) — load must match the download. */
  asrVariant?: string;
  /** User-pinned TTS quant (variant picker, e.g. qwen3-tts fp32/bf16) — load must match the download. */
  ttsVariant?: string;
}

/**
 * Union type for all possible session configurations
 */
export type SessionConfig = PalabraAISessionConfig | LocalInferenceSessionConfig | LocalNativeSessionConfig;

/**
 * Type guards for session configurations
 */
export function isPalabraAISessionConfig(config: SessionConfig): config is PalabraAISessionConfig {
  return config.provider === 'palabraai';
}

export function isLocalInferenceSessionConfig(config: SessionConfig): config is LocalInferenceSessionConfig {
  return config.provider === 'local_inference';
}

export function isLocalNativeSessionConfig(config: SessionConfig): config is LocalNativeSessionConfig {
  return config.provider === 'local_native';
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
  /** The session is broken: raises a conversation bubble and an api_error. */
  onError?: (error: any) => void;
  /**
   * The session continues, degraded.
   *
   * For failures that used to become a `console.error` inside a client, where
   * they were invisible to the user and mis-attributed in analytics — a frame
   * that would not parse, a cleanup step that threw, TTS falling back. No
   * bubble, no api_error: `participantTelemetry` gives the code a channel and
   * the severity from CLIENT_DIAGNOSTICS, and files one panel entry.
   */
  onDiagnostic?: (diagnostic: ClientDiagnostic) => void;
  onConversationUpdated?: (data: { item: ConversationItem; delta?: any }) => void;
  onConversationInterrupted?: () => void;
  onRealtimeEvent?: (event: RealtimeEvent) => void;
  onReconnecting?: () => void;
  onReconnected?: () => void;
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
  clearConversationItems(): void;

  // Event handling
  setEventHandlers(handlers: ClientEventHandlers): void;

  // Provider-specific information
  getProvider(): ProviderType;
}
