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

export interface ProviderCapabilities {
  // Core features
  hasTemplateMode: boolean;
  hasTurnDetection: boolean;
  hasVoiceSettings: boolean;
  hasNoiseReduction: boolean;
  hasModelConfiguration: boolean;
  
  // Turn detection specific
  turnDetection: TurnDetectionConfig;
  
  // Supported ranges
  temperatureRange: { min: number; max: number; step: number };
  maxTokensRange: { min: number; max: number; step: number };
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
  voices: VoiceOption[];
  models: ModelOption[];
  noiseReductionModes: string[];
  transcriptModels: string[];
  
  // Capabilities
  capabilities: ProviderCapabilities;
  
  // Default values
  defaults: {
    model: string;
    voice: string;
    temperature: number;
    maxTokens: number;
    sourceLanguage: string;
    targetLanguage: string;
    turnDetectionMode: string;
    threshold: number;
    prefixPadding: number;
    silenceDuration: number;
    semanticEagerness: string;
    noiseReduction: string;
    transcriptModel: string;
  };
}

 