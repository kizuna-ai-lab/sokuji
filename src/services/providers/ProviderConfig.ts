export interface LanguageOption {
  name: string;
  value: string;
  englishName: string;
}

export interface VoiceOption {
  name: string;
  value: string;
}

export interface ModelOption {
  id: string;
  type: 'realtime' | 'text' | 'multimodal';
}

export interface TurnDetectionConfig {
  modes: string[];
  hasThreshold: boolean;
  hasPrefixPadding: boolean;
  hasSilenceDuration: boolean;
  hasSemanticEagerness: boolean;
}

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ProviderCapabilities {
  // Core features
  hasTemplateMode: boolean;
  hasTurnDetection: boolean;
  hasVoiceSettings: boolean;
  hasNoiseReduction: boolean;
  hasModelConfiguration: boolean;
  textOnlyCapability: 'always' | 'optional' | 'never'; // 'always': inherently text-only, 'optional': user can toggle, 'never': not supported

  // Turn detection specific
  turnDetection: TurnDetectionConfig;

  // Supported ranges
  temperatureRange: { min: number; max: number; step: number };
  maxTokensRange: { min: number; max: number; step: number };

  // Reasoning effort (only applies to specific models, e.g. gpt-realtime-2).
  // When true, the provider config must also list `reasoningEfforts`. UI
  // gates rendering on this flag plus the currently-selected model.
  hasReasoningEffort?: boolean;
}

export interface ProviderConfig {
  // Basic info
  id: 'openai' | 'gemini' | string;
  displayName: string;

  // API configuration
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  requiresAuth?: boolean; // True if this provider requires backend authentication
  supportsCustomEndpoint?: boolean; // True if this provider supports custom API endpoint
  customEndpointLabel?: string; // Label for custom endpoint input
  customEndpointPlaceholder?: string; // Placeholder for custom endpoint input
  
  // Supported options
  languages: LanguageOption[];
  // When defined, target language dropdown uses this restricted list instead of `languages`.
  // Used by providers that support a different (typically smaller) set of target languages
  // than source languages — e.g. gpt-realtime-translate has 13 target languages.
  targetLanguages?: LanguageOption[];
  voices: VoiceOption[];
  models: ModelOption[];
  noiseReductionModes: string[];
  transcriptModels: string[];
  reasoningEfforts?: ReasoningEffort[];

  // Capabilities
  capabilities: ProviderCapabilities;
}

 