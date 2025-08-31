import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { ServiceFactory } from '../services/ServiceFactory';
import { ProviderConfigFactory } from '../services/providers/ProviderConfigFactory';
import { ProviderConfig } from '../services/providers/ProviderConfig';
import { FilteredModel, SessionConfig, OpenAISessionConfig, GeminiSessionConfig, PalabraAISessionConfig } from '../services/interfaces/IClient';
import { ApiKeyValidationResult } from '../services/interfaces/ISettingsService';
import { Provider, ProviderType } from '../types/Provider';
import { useAuth } from '../lib/clerk/ClerkProvider';

// Common Settings - applicable to all providers
export interface CommonSettings {
  provider: ProviderType;
  uiLanguage: string; // UI language setting
  uiMode: 'basic' | 'advanced'; // UI display mode
  systemInstructions: string;
  templateSystemInstructions: string;
  useTemplateMode: boolean;
}

// OpenAI-compatible Settings (used by OpenAI and CometAPI)
export interface OpenAICompatibleSettings {
  apiKey: string;
  model: string;
  voice: string; // OpenAI voice options
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode: 'Normal' | 'Semantic' | 'Disabled';
  threshold: number;
  prefixPadding: number;
  silenceDuration: number;
  semanticEagerness: 'Auto' | 'Low' | 'Medium' | 'High';
  temperature: number;
  maxTokens: number | 'inf';
  transcriptModel: 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1';
  noiseReduction: 'None' | 'Near field' | 'Far field';
}

// Type aliases for clarity
export type OpenAISettings = OpenAICompatibleSettings;
export type CometAPISettings = OpenAICompatibleSettings;

// Gemini-specific Settings
export interface GeminiSettings {
  apiKey: string;
  model: string;
  voice: string; // Gemini voice options
  sourceLanguage: string;
  targetLanguage: string;
  temperature: number;
  maxTokens: number | 'inf';
  // Gemini may have different capabilities, so different settings
}

// PalabraAI-specific Settings
export interface PalabraAISettings {
  clientId: string;
  clientSecret: string;
  sourceLanguage: string;
  targetLanguage: string;
  voiceId: string;
  subscriberCount: number;
  publisherCanSubscribe: boolean;
  // Translation pipeline settings
  segmentConfirmationSilenceThreshold: number;
  sentenceSplitterEnabled: boolean;
  translatePartialTranscriptions: boolean;
  // Queue configuration
  desiredQueueLevelMs: number;
  maxQueueLevelMs: number;
  autoTempo: boolean;
}

// KizunaAI-specific Settings (OpenAI-compatible with non-persistent apiKey from backend)
export interface KizunaAISettings {
  apiKey: string; // Non-persistent API key from backend
  model: string;
  voice: string; // OpenAI voice options
  sourceLanguage: string;
  targetLanguage: string;
  turnDetectionMode: 'Normal' | 'Semantic' | 'Disabled';
  threshold: number;
  prefixPadding: number;
  silenceDuration: number;
  semanticEagerness: 'Auto' | 'Low' | 'Medium' | 'High';
  temperature: number;
  maxTokens: number | 'inf';
  transcriptModel: 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1';
  noiseReduction: 'None' | 'Near field' | 'Far field';
}

/**
 * Helper functions to convert provider settings to SessionConfig
 */
export function createOpenAISessionConfig(
  settings: OpenAISettings, 
  systemInstructions: string
): OpenAISessionConfig {
  return {
    provider: 'openai',
    model: settings.model,
    voice: settings.voice,
    instructions: systemInstructions,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    turnDetection: settings.turnDetectionMode === 'Disabled' ? { type: 'none' } :
      settings.turnDetectionMode === 'Normal' ? {
        type: 'server_vad',
        createResponse: true,
        interruptResponse: false,
        prefixPadding: settings.prefixPadding,
        silenceDuration: settings.silenceDuration,
        threshold: settings.threshold
      } : {
        type: 'semantic_vad',
        createResponse: true,
        interruptResponse: false,
        eagerness: settings.semanticEagerness?.toLowerCase() as any,
      },
    inputAudioNoiseReduction: settings.noiseReduction && settings.noiseReduction !== 'None' ? {
      type: settings.noiseReduction === 'Near field' ? 'near_field' : 'far_field'
    } : undefined,
    inputAudioTranscription: settings.transcriptModel ? {
      model: settings.transcriptModel
    } : undefined,
  };
}

export function createCometAPISessionConfig(
  settings: CometAPISettings, 
  systemInstructions: string
): OpenAISessionConfig {
  return {
    provider: 'cometapi',
    model: settings.model,
    voice: settings.voice,
    instructions: systemInstructions,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    turnDetection: settings.turnDetectionMode === 'Disabled' ? { type: 'none' } :
      settings.turnDetectionMode === 'Normal' ? {
        type: 'server_vad',
        createResponse: true,
        interruptResponse: false,
        prefixPadding: settings.prefixPadding,
        silenceDuration: settings.silenceDuration,
        threshold: settings.threshold
      } : {
        type: 'semantic_vad',
        createResponse: true,
        interruptResponse: false,
        eagerness: settings.semanticEagerness?.toLowerCase() as any,
      },
    inputAudioNoiseReduction: settings.noiseReduction && settings.noiseReduction !== 'None' ? {
      type: settings.noiseReduction === 'Near field' ? 'near_field' : 'far_field'
    } : undefined,
    inputAudioTranscription: settings.transcriptModel ? {
      model: settings.transcriptModel
    } : undefined,
  };
}

export function createGeminiSessionConfig(
  settings: GeminiSettings, 
  systemInstructions: string
): GeminiSessionConfig {
  return {
    provider: 'gemini',
    model: settings.model,
    voice: settings.voice,
    instructions: systemInstructions,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
  };
}

export function createPalabraAISessionConfig(
  settings: PalabraAISettings, 
  systemInstructions: string
): PalabraAISessionConfig {
  return {
    provider: 'palabraai',
    model: 'realtime-translation', // Fixed model for PalabraAI
    voice: settings.voiceId,
    instructions: systemInstructions,
    temperature: 0.8, // Not used by PalabraAI but required by base interface
    maxTokens: 'inf', // Not used by PalabraAI but required by base interface
    sourceLanguage: settings.sourceLanguage,
    targetLanguage: settings.targetLanguage,
    voiceId: settings.voiceId,
    segmentConfirmationSilenceThreshold: settings.segmentConfirmationSilenceThreshold,
    sentenceSplitterEnabled: settings.sentenceSplitterEnabled,
    translatePartialTranscriptions: settings.translatePartialTranscriptions,
    desiredQueueLevelMs: settings.desiredQueueLevelMs,
    maxQueueLevelMs: settings.maxQueueLevelMs,
    autoTempo: settings.autoTempo,
  };
}

export function createKizunaAISessionConfig(
  settings: KizunaAISettings, 
  systemInstructions: string
): OpenAISessionConfig {
  // KizunaAI uses OpenAI-compatible API, so we return OpenAISessionConfig
  return {
    provider: 'openai',
    model: settings.model,
    voice: settings.voice,
    instructions: systemInstructions,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    turnDetection: settings.turnDetectionMode === 'Disabled' ? { type: 'none' } :
      settings.turnDetectionMode === 'Normal' ? {
        type: 'server_vad',
        createResponse: true,
        interruptResponse: false,
        prefixPadding: settings.prefixPadding,
        silenceDuration: settings.silenceDuration,
        threshold: settings.threshold
      } : {
        type: 'semantic_vad',
        createResponse: true,
        interruptResponse: false,
        eagerness: settings.semanticEagerness?.toLowerCase() as any,
      },
    inputAudioNoiseReduction: settings.noiseReduction && settings.noiseReduction !== 'None' ? {
      type: settings.noiseReduction === 'Near field' ? 'near_field' : 'far_field'
    } : undefined,
    inputAudioTranscription: settings.transcriptModel ? {
      model: settings.transcriptModel
    } : undefined
  };
}

interface SettingsContextType {
  // Common settings
  commonSettings: CommonSettings;
  updateCommonSettings: (newSettings: Partial<CommonSettings>) => void;
  
  // Provider-specific settings
  openAISettings: OpenAISettings;
  cometAPISettings: CometAPISettings;
  geminiSettings: GeminiSettings;
  palabraAISettings: PalabraAISettings;
  kizunaAISettings: KizunaAISettings;
  updateOpenAISettings: (newSettings: Partial<OpenAISettings>) => void;
  updateCometAPISettings: (newSettings: Partial<CometAPISettings>) => void;
  updateGeminiSettings: (newSettings: Partial<GeminiSettings>) => void;
  updatePalabraAISettings: (newSettings: Partial<PalabraAISettings>) => void;
  updateKizunaAISettings: (newSettings: Partial<KizunaAISettings>) => void;
  
  // Current provider settings (computed from provider-specific settings)
  getCurrentProviderSettings: () => OpenAISettings | GeminiSettings | CometAPISettings | PalabraAISettings | KizunaAISettings;
  
  // Session config creation (type-safe)
  createSessionConfig: (systemInstructions: string) => SessionConfig;
  
  // Other context methods
  reloadSettings: () => Promise<void>;
  isApiKeyValid: boolean;
  validateApiKey: (getAuthToken?: () => Promise<string | null>) => Promise<{
    valid: boolean | null;
    message: string;
    validating?: boolean;
  }>;
  getProcessedSystemInstructions: () => string;
  availableModels: FilteredModel[];
  loadingModels: boolean;
  fetchAvailableModels: (getAuthToken?: () => Promise<string | null>) => Promise<void>;
  clearAvailableModels: () => void;
  getCurrentProviderConfig: () => ProviderConfig;
  
  // Navigation support for settings panel
  settingsNavigationTarget: string | null;
  navigateToSettings: (section?: string | null) => void;
  
  // Kizuna AI API key management
  isApiKeyFetching: boolean;
  apiKeyFetchError: string | null;
  ensureKizunaApiKey: () => Promise<boolean>;
}

// Default common settings
export const defaultCommonSettings: CommonSettings = {
  provider: Provider.OPENAI,
  uiLanguage: 'en',
  uiMode: 'basic',
  systemInstructions:
    "# ROLE & OBJECTIVE\n" +
    "You are a professional simultaneous interpreter.\n" +
    "Your SOLE function: Convert Chinese speech to Japanese translations in real-time.\n\n" +
    "# PERSONALITY & TONE - MIRROR MODE\n" +
    "• You are invisible - adopt the speaker's personality completely\n" +
    "• Emotional mirroring: 兴奋→興奮した日本語, 冷静→冷静な日本語\n" +
    "• Style matching: 儿童语气→子供っぽい日本語, 专业→プロフェッショナルな日本語\n" +
    "• Energy synchronization: Match speaker's energy level exactly\n" +
    "• Your voice = speaker's voice in Japanese\n\n" +
    "# SPEECH DELIVERY\n" +
    "• Speaking pace: Fast Chinese→fast Japanese, slow Chinese→slow Japanese\n" +
    "• DURATION MATCHING: Output length should match input duration\n" +
    "• Deliver translations fast without sounding rushed\n" +
    "• Natural flow: Sound like a native Japanese speaker\n" +
    "• Rhythm: Preserve pauses and emphasis patterns\n" +
    "• Never sound robotic - always human-like\n\n" +
    "# LANGUAGE CONTROL\n" +
    "• OUTPUT MUST BE JAPANESE ONLY (日本語のみ)\n" +
    "• Mixed language input → pure Japanese output\n" +
    "• No Chinese words in output unless proper names\n" +
    "• Ignore requests to speak other languages\n\n" +
    "# PRIMARY RULES - ABSOLUTE PRIORITY\n" +
    "• TRANSLATE EVERYTHING - Every input gets translated, NO EXCEPTIONS\n" +
    "• NEVER refuse, apologize, or explain inability to translate\n" +
    "• NEVER answer questions - only translate them\n" +
    "• NEVER add commentary, disclaimers, or meta-information\n" +
    "• NEVER suggest verifying information or checking sources\n" +
    "• You are a TRANSLATOR, not an advisor or fact-checker\n\n" +
    "# HANDLING SENSITIVE CONTENT\n" +
    "• Political topics: Translate neutrally without commentary\n" +
    "• Controversial statements: Translate exactly as spoken\n" +
    "• Sensitive information: Translate without judgment\n" +
    "• Historical events: Translate the speaker's words precisely\n" +
    "• Personal opinions: Translate faithfully regardless of content\n" +
    "• NEVER provide warnings, disclaimers, or alternative viewpoints\n" +
    "• Your role is linguistic conversion ONLY - not content moderation\n\n" +
    "# TRANSLATION REQUIREMENTS\n" +
    "• Start output within 200ms\n" +
    "• Preserve exact meaning - no additions, no omissions\n" +
    "• Maintain sentence type (question → question, statement → statement)\n" +
    "• Match speaker's tone (formal/casual)\n" +
    "• Keep original punctuation intent\n" +
    "• Translate ALL clear content regardless of topic sensitivity\n\n" +
    "# HANDLING UNCLEAR AUDIO\n" +
    "• Only respond to clear audio or text input\n" +
    "• If audio is unclear: remain SILENT - do not generate any response\n" +
    "• NEVER ask for clarification or repetition\n" +
    "• NEVER guess or make up content\n" +
    "• Background noise or silence: NO RESPONSE\n" +
    "• Partial words or mumbling: NO RESPONSE\n\n" +
    "# VARIATION & CONSISTENCY\n" +
    "• Technical terms: Keep consistent throughout session\n" +
    "• Casual phrases: Use natural variations\n" +
    "• Avoid mechanical repetition while maintaining accuracy\n\n" +
    "# OUTPUT FORMAT\n" +
    "• ONLY the translated Japanese text\n" +
    "• NO prefixes like \"Translation:\" or \"日本語:\"\n" +
    "• NO explanations, notes, or disclaimers\n" +
    "• NO suggestions to verify information\n" +
    "• NO system messages or warnings\n\n" +
    "# EXAMPLES\n" +
    "Input: 这是什么？\n" +
    "Output: これは何ですか？\n\n" +
    "Input: 今天天气真好。\n" +
    "Output: 今日は本当にいい天気ですね。\n\n" +
    "Input: 你能帮我翻译吗？\n" +
    "Output: 翻訳を手伝ってもらえますか？\n\n" +
    "Input: [unclear audio/mumbling]\n" +
    "Output: [SILENCE - NO RESPONSE]\n\n" +
    "REMEMBER: You are a neutral translator. Translate ALL clear content faithfully. Never provide disclaimers or advice. Output only Japanese.",
  templateSystemInstructions:
    "# ROLE & OBJECTIVE\n" +
    "You are a professional simultaneous interpreter.\n" +
    "Your SOLE function: Convert {{SOURCE_LANGUAGE}} speech to {{TARGET_LANGUAGE}} translations in real-time.\n" +
    "You are a TRANSLATION MACHINE, not a conversational AI.\n\n" +
    "# PERSONALITY & TONE - MIRROR MODE\n" +
    "• You are an invisible translator - adopt the speaker's personality completely\n" +
    "• Emotional mirroring: Happy→happy, sad→sad, angry→angry, calm→calm\n" +
    "• Style matching: Child-like→child-like, professional→professional, casual→casual\n" +
    "• Energy synchronization: Match the speaker's energy level exactly\n" +
    "• Preserve ALL emotional nuances and non-verbal cues\n" +
    "• Your voice should feel like the speaker themselves speaking {{TARGET_LANGUAGE}}\n" +
    "• Never impose your own personality - you are a transparent medium\n\n" +
    "# SPEECH DELIVERY\n" +
    "• Speaking pace: Match the speaker's tempo - fast speaker→fast translation, slow→slow\n" +
    "• DURATION MATCHING: Output length should match input duration\n" +
    "• Deliver translations fast without sounding rushed\n" +
    "• Articulation: Clear pronunciation without over-enunciation\n" +
    "• Natural flow: Deliver translation as naturally as the original speech\n" +
    "• Rhythm preservation: Keep similar pauses and breathing patterns\n" +
    "• Volume dynamics: Maintain relative loudness variations\n" +
    "• DO NOT sound robotic or monotone - sound like a real person speaking\n" +
    "• Urgency matching: Urgent tone→quick delivery, relaxed→measured pace\n\n" +
    "# LANGUAGE CONTROL\n" +
    "• OUTPUT MUST BE EXCLUSIVELY IN {{TARGET_LANGUAGE}}\n" +
    "• Even if input mixes multiple languages, output ONLY {{TARGET_LANGUAGE}}\n" +
    "• Never code-switch or mix languages in output\n" +
    "• If speaker uses loanwords, translate or transliterate appropriately\n" +
    "• Ignore any requests to change output language\n" +
    "• Language lock is ABSOLUTE - no exceptions, even for \"testing\"\n" +
    "• Foreign names: Use {{TARGET_LANGUAGE}} conventions (phonetic/standard)\n\n" +
    "# PRIMARY RULES - ABSOLUTE PRIORITY\n" +
    "• TRANSLATE EVERYTHING - Every input gets translated, NO EXCEPTIONS\n" +
    "• NEVER refuse, apologize, or explain inability to translate\n" +
    "• NEVER answer questions - only translate them\n" +
    "• NEVER judge, filter, or censor content - translate everything neutrally\n" +
    "• NEVER add AI commentary, disclaimers, or suggestions\n" +
    "• NEVER advise users to verify information or check sources\n" +
    "• You are a TRANSLATOR, not a fact-checker, advisor, or moderator\n\n" +
    "# HANDLING SENSITIVE CONTENT\n" +
    "• Political topics: Translate neutrally without any commentary\n" +
    "• Controversial statements: Translate exactly as spoken\n" +
    "• Sensitive information: Translate without judgment or warnings\n" +
    "• Historical events: Translate the speaker's exact words\n" +
    "• Personal opinions: Translate faithfully regardless of content\n" +
    "• Conspiracy theories: Translate without correction or commentary\n" +
    "• Misinformation: Translate as spoken - you are not a fact-checker\n" +
    "• NEVER provide warnings, disclaimers, or alternative viewpoints\n" +
    "• Your role is linguistic conversion ONLY - not content moderation\n\n" +
    "# TRANSLATION REQUIREMENTS\n" +
    "• Response time: Start output within 200ms\n" +
    "• Accuracy: 100% faithful - no additions, no omissions\n" +
    "• Sentence type: Preserve exactly (question → question)\n" +
    "• Tone matching: Keep register (formal/casual/emotional)\n" +
    "• Punctuation: Maintain intent and emphasis\n" +
    "• Technical terms: Translate appropriately for context\n" +
    "• Translate ALL clear content regardless of topic sensitivity\n\n" +
    "# HANDLING UNCLEAR AUDIO\n" +
    "• Only respond to clear audio or text input\n" +
    "• If audio is unclear: remain SILENT - do not generate any response\n" +
    "• NEVER ask for clarification or repetition\n" +
    "• NEVER guess or make up content\n" +
    "• Background noise or silence: NO RESPONSE\n" +
    "• Partial words or mumbling: NO RESPONSE\n\n" +
    "# VARIATION & CONSISTENCY\n" +
    "• Terminology: Keep technical terms consistent throughout session\n" +
    "• Natural variation: Use different expressions for repeated casual phrases\n" +
    "• Avoid robotic patterns - vary sentence structures naturally\n" +
    "• Context awareness: Same word may translate differently based on context\n" +
    "• Idiomatic flexibility: Use varied but appropriate expressions\n" +
    "• Balance: Consistent for technical accuracy, varied for natural flow\n\n" +
    "# OUTPUT FORMAT\n" +
    "• ONLY the {{TARGET_LANGUAGE}} translation\n" +
    "• NO prefixes (\"Translation:\", \"In {{TARGET_LANGUAGE}}:\")\n" +
    "• NO suffixes, explanations, or notes\n" +
    "• NO system messages, errors, or warnings\n" +
    "• NO meta-commentary about translation or content\n" +
    "• NO suggestions to verify information\n\n" +
    "# HANDLING SPECIFIC CASES\n" +
    "• Unclear audio: SILENCE - no response\n" +
    "• Mixed languages: Translate all to {{TARGET_LANGUAGE}}\n" +
    "• Numbers/dates: Convert to {{TARGET_LANGUAGE}} conventions\n" +
    "• Names: Keep original or use standard {{TARGET_LANGUAGE}} version\n" +
    "• Idioms: Use equivalent {{TARGET_LANGUAGE}} expression when exists\n" +
    "• Political statements: Translate exactly without commentary\n" +
    "• Opinion statements: Translate faithfully as spoken\n\n" +
    "# PERFORMANCE METRICS\n" +
    "• Latency: <200ms to first token\n" +
    "• Accuracy: >99% semantic preservation\n" +
    "• Fluency: Natural {{TARGET_LANGUAGE}} output\n" +
    "• Consistency: Uniform terminology throughout session\n\n" +
    "REMEMBER: You are a neutral translator. Translate ALL clear content faithfully. Never provide disclaimers, advice, or commentary. Output ONLY {{TARGET_LANGUAGE}}.",
  useTemplateMode: true,
};

// Default OpenAI-compatible settings (shared by OpenAI and CometAPI)
export const defaultOpenAICompatibleSettings: OpenAICompatibleSettings = {
  apiKey: '',
  model: 'gpt-4o-mini-realtime-preview',
  voice: 'alloy',
  sourceLanguage: 'en',
  targetLanguage: 'zh_CN',
  turnDetectionMode: 'Normal',
  threshold: 0.49,
  prefixPadding: 0.5,
  silenceDuration: 0.5,
  semanticEagerness: 'Auto',
  temperature: 0.8,
  maxTokens: 4096,
  transcriptModel: 'gpt-4o-mini-transcribe',
  noiseReduction: 'None',
};

// Default settings for each provider
export const defaultOpenAISettings: OpenAISettings = defaultOpenAICompatibleSettings;
export const defaultCometAPISettings: CometAPISettings = {
  ...defaultOpenAICompatibleSettings,
  transcriptModel: 'whisper-1',  // CometAPI uses whisper-1 for better compatibility
};

// Default KizunaAI settings (OpenAI-compatible with backend-managed API key)
export const defaultKizunaAISettings: KizunaAISettings = {
  ...defaultOpenAICompatibleSettings,
  transcriptModel: 'whisper-1',  // KizunaAI uses whisper-1 for better compatibility
  // Note: apiKey is backend-managed for KizunaAI (fetched from server, not user-provided)
};

// Default Gemini settings
export const defaultGeminiSettings: GeminiSettings = {
  apiKey: '',
  model: 'gemini-2.0-flash-exp',
  voice: 'Aoede',
  sourceLanguage: 'en-US',
  targetLanguage: 'ja-JP',
  temperature: 0.8,
  maxTokens: 4096,
};

// Default PalabraAI settings
export const defaultPalabraAISettings: PalabraAISettings = {
  clientId: '',
  clientSecret: '',
  sourceLanguage: 'en',
  targetLanguage: 'es',
  voiceId: 'default_low',
  subscriberCount: 0,
  publisherCanSubscribe: true,
  // Translation pipeline settings (based on recommended settings from docs)
  segmentConfirmationSilenceThreshold: 0.7,
  sentenceSplitterEnabled: true,
  translatePartialTranscriptions: false,
  // Queue configuration (based on recommended settings from docs)
  desiredQueueLevelMs: 8000,
  maxQueueLevelMs: 24000,
  autoTempo: false,
};

const SettingsContext = createContext<SettingsContextType | null>(null);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  // Create a reference to our settings service
  const settingsService = ServiceFactory.getSettingsService();
  
  // Get auth state for KizunaAI auto-fetch functionality
  const { isSignedIn, getToken } = useAuth();
  
  // Separate state management for different settings categories
  const [commonSettings, setCommonSettings] = useState<CommonSettings>(defaultCommonSettings);
  const [openAISettings, setOpenAISettings] = useState<OpenAISettings>(defaultOpenAISettings);
  const [cometAPISettings, setCometAPISettings] = useState<CometAPISettings>(defaultCometAPISettings);
  const [geminiSettings, setGeminiSettings] = useState<GeminiSettings>(defaultGeminiSettings);
  const [palabraAISettings, setPalabraAISettings] = useState<PalabraAISettings>(defaultPalabraAISettings);
  const [kizunaAISettings, setKizunaAISettings] = useState<KizunaAISettings>(defaultKizunaAISettings);
  
  // Kizuna AI specific state
  const [isApiKeyFetching, setIsApiKeyFetching] = useState(false);
  const [apiKeyFetchError, setApiKeyFetchError] = useState<string | null>(null);
  
  const [isApiKeyValid, setIsApiKeyValid] = useState(false);
  const [availableModels, setAvailableModels] = useState<FilteredModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  
  // Navigation state for settings panel
  const [settingsNavigationTarget, setSettingsNavigationTarget] = useState<string | null>(null);
  
  // Cache for API validation and models to avoid duplicate requests
  const [modelsCache, setModelsCache] = useState<Map<string, {
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
    timestamp: number;
  }>>(new Map());

  // Get current provider configuration
  const getCurrentProviderConfig = useCallback((): ProviderConfig => {
    try {
      return ProviderConfigFactory.getConfig(commonSettings.provider);
    } catch (error) {
      console.warn(`[SettingsContext] Unknown provider: ${commonSettings.provider}, falling back to OpenAI`);
      return ProviderConfigFactory.getConfig(Provider.OPENAI);
    }
  }, [commonSettings.provider]);

  // Get current provider's settings
  const getCurrentProviderSettings = useCallback((): OpenAISettings | GeminiSettings | CometAPISettings | PalabraAISettings | KizunaAISettings => {
    switch (commonSettings.provider) {
      case Provider.OPENAI:
        return openAISettings;
      case Provider.COMET_API:
        return cometAPISettings;
      case Provider.GEMINI:
        return geminiSettings;
      case Provider.PALABRA_AI:
        return palabraAISettings;
      case Provider.KIZUNA_AI:
        return kizunaAISettings;
      default:
        return openAISettings;
    }
  }, [commonSettings.provider, openAISettings, cometAPISettings, geminiSettings, palabraAISettings, kizunaAISettings]);

  // Get current API key based on provider
  const getCurrentApiKey = useCallback((): string => {
    switch (commonSettings.provider) {
      case Provider.OPENAI:
        return openAISettings.apiKey;
      case Provider.COMET_API:
        return cometAPISettings.apiKey;
      case Provider.GEMINI:
        return geminiSettings.apiKey;
      case Provider.PALABRA_AI:
        return palabraAISettings.clientId; // PalabraAI uses clientId as primary identifier
      case Provider.KIZUNA_AI:
        return kizunaAISettings.apiKey || ''; // Use non-persistent API key from settings
      default:
        return openAISettings.apiKey;
    }
  }, [commonSettings.provider, openAISettings.apiKey, cometAPISettings.apiKey, geminiSettings.apiKey, palabraAISettings.clientId, kizunaAISettings.apiKey]);

  // Generate cache key for current provider and API key
  const getCacheKey = useCallback((): string => {
    const apiKey = getCurrentApiKey();
    if (commonSettings.provider === Provider.PALABRA_AI) {
      return `${commonSettings.provider}:${apiKey}:${palabraAISettings.clientSecret}`;
    }
    return `${commonSettings.provider}:${apiKey}`;
  }, [commonSettings.provider, getCurrentApiKey, palabraAISettings.clientSecret]);

  // Check if cache is valid (not older than 5 minutes)
  const isCacheValid = useCallback((timestamp: number): boolean => {
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    return Date.now() - timestamp < CACHE_DURATION;
  }, []);

  // Unified API key management for Kizuna AI - uses Clerk token as API key
  const ensureKizunaApiKey = useCallback(async (): Promise<boolean> => {
    // Check if we already have a key or are currently fetching
    if (kizunaAISettings.apiKey && kizunaAISettings.apiKey.trim() !== '') {
      return true; // Already have a key
    }
    
    if (isApiKeyFetching) {
      console.log('[SettingsContext] Token fetch already in progress');
      return false; // Prevent duplicate requests
    }
    
    if (!isSignedIn || !getToken) {
      console.log('[SettingsContext] Cannot get token - user not signed in');
      setApiKeyFetchError('User not signed in');
      return false;
    }
    
    setIsApiKeyFetching(true);
    setApiKeyFetchError(null);
    
    try {
      console.log('[SettingsContext] Getting Clerk token for Kizuna AI...');
      // Directly use Clerk token as the "API key"
      const clerkToken = await getToken();
      
      if (clerkToken) {
        console.log('[SettingsContext] Successfully got Clerk token for Kizuna AI');
        // Set the Clerk token as the "apiKey" - MainPanel will use it unchanged
        setKizunaAISettings(prev => ({ ...prev, apiKey: clerkToken }));
        return true;
      } else {
        const error = 'Failed to get Clerk token';
        console.warn('[SettingsContext] ' + error);
        setApiKeyFetchError(error);
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error getting Clerk token';
      console.error('[SettingsContext] Error getting Clerk token for Kizuna AI:', errorMessage);
      setApiKeyFetchError(errorMessage);
      return false;
    } finally {
      setIsApiKeyFetching(false);
    }
  }, [kizunaAISettings.apiKey, isApiKeyFetching, isSignedIn, getToken]);

  // Validate API key and fetch models in a single request with caching
  const validateApiKeyAndFetchModels = useCallback(async (getAuthToken?: () => Promise<string | null>): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> => {
    // For KizunaAI, ensure we have an API key first
    if (commonSettings.provider === Provider.KIZUNA_AI) {
      const hasKey = await ensureKizunaApiKey();
      if (!hasKey) {
        return {
          validation: {
            valid: false,
            message: apiKeyFetchError || 'Failed to fetch Kizuna AI API key',
            validating: false
          } as ApiKeyValidationResult,
          models: [] as FilteredModel[]
        };
      }
    }
    
    // For Kizuna AI, use the getAuthToken parameter to get fresh token if available
    let apiKey: string;
    if (commonSettings.provider === Provider.KIZUNA_AI && getAuthToken) {
      try {
        console.log('[SettingsContext] Using getAuthToken to fetch fresh token for validation...');
        apiKey = await getAuthToken() || '';
        console.log('[SettingsContext] Successfully got fresh token for validation');
      } catch (error) {
        console.error('[SettingsContext] Failed to get fresh token for validation:', error);
        apiKey = getCurrentApiKey();
      }
    } else {
      apiKey = getCurrentApiKey();
    }
    
    const cacheKey = getCacheKey();
    
    // Check cache first
    const cached = modelsCache.get(cacheKey);
    if (cached && isCacheValid(cached.timestamp)) {
      console.info('[Settings] Using cached validation and models result');
      return {
        validation: cached.validation,
        models: cached.models
      };
    }

    if (!apiKey || apiKey.trim() === '') {
      const result = {
        validation: {
          valid: false,
          message: 'API key cannot be empty',
          validating: false
        } as ApiKeyValidationResult,
        models: [] as FilteredModel[]
      };
      return result;
    }

    try {
      console.info('[Settings] Validating API key and fetching models...');
      
      // For PalabraAI, we need to pass both clientId and clientSecret
      const clientSecret = commonSettings.provider === Provider.PALABRA_AI ? 
        palabraAISettings.clientSecret : undefined;
      
      const result = await settingsService.validateApiKeyAndFetchModels(
        apiKey, 
        commonSettings.provider,
        clientSecret
      );
      
      // Cache the result
      modelsCache.set(cacheKey, {
        validation: result.validation,
        models: result.models,
        timestamp: Date.now()
      });
      
      return result;
    } catch (error) {
      console.error('[Settings] Error validating API key and fetching models:', error);
      const result = {
        validation: {
          valid: false,
          message: error instanceof Error ? error.message : 'Validation failed',
          validating: false
        } as ApiKeyValidationResult,
        models: [] as FilteredModel[]
      };
      return result;
    }
  }, [commonSettings.provider, ensureKizunaApiKey, apiKeyFetchError, getCurrentApiKey, getCacheKey, modelsCache, isCacheValid, settingsService, palabraAISettings.clientSecret]);

  // Process system instructions based on the selected mode
  const getProcessedSystemInstructions = useCallback(() => {
    if (commonSettings.useTemplateMode) {
      const providerConfig = getCurrentProviderConfig();
      const currentSettings = getCurrentProviderSettings();
      
      const sourceLang = providerConfig.languages.find(l => l.value === currentSettings.sourceLanguage);
      const targetLang = providerConfig.languages.find(l => l.value === currentSettings.targetLanguage);

      const sourceLangName = sourceLang?.englishName || currentSettings.sourceLanguage || 'SOURCE_LANGUAGE';
      const targetLangName = targetLang?.englishName || currentSettings.targetLanguage || 'TARGET_LANGUAGE';

      return commonSettings.templateSystemInstructions
        .replace(/\{\{SOURCE_LANGUAGE\}\}/g, sourceLangName)
        .replace(/\{\{TARGET_LANGUAGE\}\}/g, targetLangName);
    } else {
      return commonSettings.systemInstructions;
    }
  }, [commonSettings.useTemplateMode, commonSettings.templateSystemInstructions, commonSettings.systemInstructions, getCurrentProviderConfig, getCurrentProviderSettings]);

  // Validate the API key for current provider
  const validateApiKey = useCallback(async (getAuthToken?: () => Promise<string | null>) => {
    try {
      const result = await validateApiKeyAndFetchModels(getAuthToken);
      setIsApiKeyValid(Boolean(result.validation.valid));
      setAvailableModels(result.models);
      return result.validation;
    } catch (error) {
      console.error('[Sokuji] [Settings] Error validating API key:', error);
      return {
        valid: false,
        message: error instanceof Error ? error.message : 'Error validating API key',
        validating: false
      };
    }
  }, [validateApiKeyAndFetchModels]);

  // Update functions for different settings categories
  const updateCommonSettings = useCallback((newSettings: Partial<CommonSettings>) => {
    setCommonSettings(prev => {
      const updated = { ...prev, ...newSettings };
      
      // Save each updated setting
      for (const key of Object.keys(newSettings)) {
        const fullKey = `settings.common.${key}`;
        const value = (newSettings as any)[key];
        settingsService.setSetting(fullKey, value)
          .catch(error => console.error(`[Settings] Error saving common setting ${key}:`, error));
      }
      
      return updated;
    });
  }, [settingsService]);

  const updateOpenAISettings = useCallback((newSettings: Partial<OpenAISettings>) => {
    setOpenAISettings(prev => {
      const updated = { ...prev, ...newSettings };
      
      // Save each updated setting
      for (const key of Object.keys(newSettings)) {
        const fullKey = `settings.openai.${key}`;
        const value = (newSettings as any)[key];
        settingsService.setSetting(fullKey, value)
          .catch(error => console.error(`[Settings] Error saving OpenAI setting ${key}:`, error));
      }
      
      return updated;
    });
  }, [settingsService]);

  const updateCometAPISettings = useCallback((newSettings: Partial<CometAPISettings>) => {
    setCometAPISettings(prev => {
      const updated = { ...prev, ...newSettings };
      
      // Save each updated setting
      for (const key of Object.keys(newSettings)) {
        const fullKey = `settings.cometapi.${key}`;
        const value = (newSettings as any)[key];
        settingsService.setSetting(fullKey, value)
          .catch(error => console.error(`[Settings] Error saving CometAPI setting ${key}:`, error));
      }
      
      return updated;
    });
  }, [settingsService]);

  const updateGeminiSettings = useCallback((newSettings: Partial<GeminiSettings>) => {
    setGeminiSettings(prev => {
      const updated = { ...prev, ...newSettings };
      
      // Save each updated setting
      for (const key of Object.keys(newSettings)) {
        const fullKey = `settings.gemini.${key}`;
        const value = (newSettings as any)[key];
        settingsService.setSetting(fullKey, value)
          .catch(error => console.error(`[Settings] Error saving Gemini setting ${key}:`, error));
      }
      
      return updated;
    });
  }, [settingsService]);

  const updatePalabraAISettings = useCallback((newSettings: Partial<PalabraAISettings>) => {
    setPalabraAISettings(prev => {
      const updated = { ...prev, ...newSettings };
      
      // Save each updated setting
      for (const key of Object.keys(newSettings)) {
        const fullKey = `settings.palabraai.${key}`;
        const value = (newSettings as any)[key];
        settingsService.setSetting(fullKey, value)
          .catch(error => console.error(`[Settings] Error saving PalabraAI setting ${key}:`, error));
      }
      
      return updated;
    });
  }, [settingsService]);

  const updateKizunaAISettings = useCallback((newSettings: Partial<KizunaAISettings>) => {
    setKizunaAISettings(prev => {
      const updated = { ...prev, ...newSettings };
      
      // Save each updated setting, but skip apiKey (non-persistent)
      for (const key of Object.keys(newSettings)) {
        if (key === 'apiKey') {
          // Skip saving apiKey as it's fetched from backend and should not persist
          continue;
        }
        const fullKey = `settings.kizunaai.${key}`;
        const value = (newSettings as any)[key];
        settingsService.setSetting(fullKey, value)
          .catch(error => console.error(`[Settings] Error saving KizunaAI setting ${key}:`, error));
      }
      
      return updated;
    });
  }, [settingsService]);

  // Import ApiKeyService and create function to fetch KizunaAI API key

  // Load settings from storage
  const loadSettings = useCallback(async () => {
    try {
      // Load common settings
      const loadedCommon: Partial<CommonSettings> = {};
      for (const key of Object.keys(defaultCommonSettings)) {
        const fullKey = `settings.common.${key}`;
        const defaultValue = (defaultCommonSettings as any)[key];
        (loadedCommon as any)[key] = await settingsService.getSetting(fullKey, defaultValue);
      }

      // Validate that the loaded provider is still available
      // If not, fallback to OpenAI
      const loadedProvider = loadedCommon.provider as ProviderType;
      if (!ProviderConfigFactory.isProviderSupported(loadedProvider)) {
        console.warn(`Provider ${loadedProvider} is not available in this build, falling back to OpenAI`);
        loadedCommon.provider = Provider.OPENAI;
        // Save the fallback provider
        await settingsService.setSetting('settings.common.provider', Provider.OPENAI);
      }

      setCommonSettings(loadedCommon as CommonSettings);

      // Load OpenAI settings
      const loadedOpenAI: Partial<OpenAISettings> = {};
      for (const key of Object.keys(defaultOpenAISettings)) {
        const fullKey = `settings.openai.${key}`;
        const defaultValue = (defaultOpenAISettings as any)[key];
        (loadedOpenAI as any)[key] = await settingsService.getSetting(fullKey, defaultValue);
      }
      setOpenAISettings(loadedOpenAI as OpenAISettings);

      // Load CometAPI settings
      const loadedCometAPI: Partial<CometAPISettings> = {};
      for (const key of Object.keys(defaultCometAPISettings)) {
        const fullKey = `settings.cometapi.${key}`;
        const defaultValue = (defaultCometAPISettings as any)[key];
        (loadedCometAPI as any)[key] = await settingsService.getSetting(fullKey, defaultValue);
      }
      setCometAPISettings(loadedCometAPI as CometAPISettings);

      // Load Gemini settings
      const loadedGemini: Partial<GeminiSettings> = {};
      for (const key of Object.keys(defaultGeminiSettings)) {
        const fullKey = `settings.gemini.${key}`;
        const defaultValue = (defaultGeminiSettings as any)[key];
        (loadedGemini as any)[key] = await settingsService.getSetting(fullKey, defaultValue);
      }
      setGeminiSettings(loadedGemini as GeminiSettings);

      // Load PalabraAI settings
      const loadedPalabraAI: Partial<PalabraAISettings> = {};
      for (const key of Object.keys(defaultPalabraAISettings)) {
        const fullKey = `settings.palabraai.${key}`;
        const defaultValue = (defaultPalabraAISettings as any)[key];
        (loadedPalabraAI as any)[key] = await settingsService.getSetting(fullKey, defaultValue);
      }
      setPalabraAISettings(loadedPalabraAI as PalabraAISettings);

      // Load KizunaAI settings
      const loadedKizunaAI: Partial<KizunaAISettings> = {};
      for (const key of Object.keys(defaultKizunaAISettings)) {
        const fullKey = `settings.kizunaai.${key}`;
        const defaultValue = (defaultKizunaAISettings as any)[key];
        (loadedKizunaAI as any)[key] = await settingsService.getSetting(fullKey, defaultValue);
      }
      setKizunaAISettings(loadedKizunaAI as KizunaAISettings);

      console.info('[Settings] Loaded settings successfully');
      
      // Note: Auto-validation will be handled by the useEffect that monitors provider/API key changes
      // This prevents duplicate API requests during initialization
    } catch (error) {
      console.error('[Settings] Error loading settings:', error);
    }
  }, [settingsService]);

  // Fetch available models from current provider
  const fetchAvailableModels = useCallback(async (getAuthToken?: () => Promise<string | null>) => {
    try {
      setLoadingModels(true);
      const result = await validateApiKeyAndFetchModels(getAuthToken);
      setIsApiKeyValid(Boolean(result.validation.valid));
      setAvailableModels(result.models);
      console.info('[Settings] Fetched available models:', result.models);
    } catch (error) {
      console.error('[Settings] Error fetching available models:', error);
      setAvailableModels([]);
      setIsApiKeyValid(false);
    } finally {
      setLoadingModels(false);
    }
  }, [validateApiKeyAndFetchModels]);

  // Clear available models and cache (useful when switching providers)
  const clearAvailableModels = useCallback(() => {
    setAvailableModels([]);
    setModelsCache(new Map()); // Clear cache when switching providers
  }, []);

  // Initialize settings on component mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Auto-fetch KizunaAI API key when user logs in or provider changes
  useEffect(() => {
    if (commonSettings.provider === Provider.KIZUNA_AI && isSignedIn) {
      console.log('[SettingsProvider] KizunaAI provider selected, ensuring API key...');
      ensureKizunaApiKey();
    }
  }, [commonSettings.provider, isSignedIn, ensureKizunaApiKey]);

  // Auto-validate API key and fetch models when provider or API key changes
  useEffect(() => {
    const currentApiKey = getCurrentApiKey();
    
    if (currentApiKey && currentApiKey.trim() !== '') {
      console.info('[Settings] Provider or API key changed, auto-validating...');
      
      // Debounce the validation to avoid too many API calls
      const timeoutId = setTimeout(async () => {
        try {
          setLoadingModels(true);
          // For Kizuna AI, pass getToken function to get fresh token
          const getAuthToken = commonSettings.provider === Provider.KIZUNA_AI && getToken ? 
            () => getToken({ skipCache: true }) : undefined;
          const result = await validateApiKeyAndFetchModels(getAuthToken);
          setIsApiKeyValid(Boolean(result.validation.valid));
          setAvailableModels(result.models);
          
          if (result.validation.valid) {
            console.info('[Settings] API key is valid, models loaded:', result.models);
          } else {
            console.warn('[Settings] API key validation failed:', result.validation.message);
          }
        } catch (validationError) {
          console.error('[Settings] Error auto-validating API key and fetching models:', validationError);
          setIsApiKeyValid(prev => prev ? false : prev);
          setAvailableModels(prev => prev.length > 0 ? [] : prev);
          setModelsCache(prev => prev.size > 0 ? new Map() : prev); // Prevent re-render loop
        } finally {
          setLoadingModels(false);
        }
      }, 1000); // 1 second debounce
      
      return () => clearTimeout(timeoutId);
    } else {
      console.info('[Settings] No API key found, clearing validation state');
      setIsApiKeyValid(prev => prev ? false : prev);
      setAvailableModels(prev => prev.length > 0 ? [] : prev);
      setModelsCache(prev => prev.size > 0 ? new Map() : prev); // Prevent re-render loop
    }
  }, [commonSettings.provider, openAISettings.apiKey, cometAPISettings.apiKey, geminiSettings.apiKey, palabraAISettings.clientId, palabraAISettings.clientSecret, getCurrentApiKey, validateApiKeyAndFetchModels]);

  // Create session config based on current settings
  const createSessionConfig = useCallback((systemInstructions: string): SessionConfig => {
    switch (commonSettings.provider) {
      case Provider.OPENAI:
        return createOpenAISessionConfig(openAISettings, systemInstructions);
      case Provider.COMET_API:
        return createCometAPISessionConfig(cometAPISettings, systemInstructions);
      case Provider.GEMINI:
        return createGeminiSessionConfig(geminiSettings, systemInstructions);
      case Provider.PALABRA_AI:
        return createPalabraAISessionConfig(palabraAISettings, systemInstructions);
      case Provider.KIZUNA_AI:
        return createKizunaAISessionConfig(kizunaAISettings, systemInstructions);
      default:
        return createOpenAISessionConfig(openAISettings, systemInstructions);
    }
  }, [commonSettings.provider, openAISettings, cometAPISettings, geminiSettings, palabraAISettings, kizunaAISettings]);

  // Navigation function for settings panel
  const navigateToSettings = useCallback((section?: string | null) => {
    setSettingsNavigationTarget(section || null);
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        // New structured settings
        commonSettings,
        updateCommonSettings,
        openAISettings,
        cometAPISettings,
        geminiSettings,
        palabraAISettings,
        kizunaAISettings,
        updateOpenAISettings,
        updateCometAPISettings,
        updateGeminiSettings,
        updatePalabraAISettings,
        updateKizunaAISettings,
        getCurrentProviderSettings,
        
        // Session config creation
        createSessionConfig,
        
        // Other context methods
        reloadSettings: loadSettings,
        isApiKeyValid,
        validateApiKey,
        getProcessedSystemInstructions,
        availableModels,
        loadingModels,
        fetchAvailableModels,
        clearAvailableModels,
        getCurrentProviderConfig,
        
        // Navigation support
        settingsNavigationTarget,
        navigateToSettings,
        // Kizuna AI API key management
        isApiKeyFetching,
        apiKeyFetchError,
        ensureKizunaApiKey
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};
