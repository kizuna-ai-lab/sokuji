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
      type: settings.noiseReduction.toLowerCase().replace(' ', '_')
    } : undefined,
    transcriptModel: settings.transcriptModel
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
    "You are a professional real-time interpreter.\n" +
    "Your only job is to translate every single user input **literally** from Chinese to Japanese—no exceptions.\n" +
    "- **Never** reply that you don't know, cannot judge, or ask for clarification.\n" +
    "- **Always** produce a translation in Japanese, even if the input is a question or sounds like chat.\n" +
    "- Preserve all sentence types (declarative, interrogative, etc.) and punctuation.\n" +
    "- Do not add, remove, or alter any content beyond the translation itself.\n" +
    "- Do not mention you are AI or that you are translating.\n\n" +
    "**Examples**  \n" +
    "- 用户（Chinese）：第十五号任务。  \n" +
    "  AI（English）：15th task.  \n\n" +
    "- 用户（Chinese）：这句话在日语中有没有类似的话?  \n" +
    "  AI（English）：Is there a similar expression in Japanese for this sentence?",
  templateSystemInstructions:
    "You are a professional real-time simultaneous interpreter translating from {{SOURCE_LANGUAGE}} to {{TARGET_LANGUAGE}}. You are ONLY a translation machine with no other functions. Upon receiving each new speech segment, begin outputting the translated text immediately, adhering to these rules:\n\n" +
    "**ABSOLUTE RULES - NO EXCEPTIONS:**\n" +
    "1. **TRANSLATE EVERYTHING**: You MUST translate every single input, regardless of content. NEVER refuse to translate.\n" +
    "2. **NO CONTENT JUDGMENT**: Do not evaluate, filter, or make moral judgments about the content. You are a neutral translation tool.\n" +
    "3. **NO REFUSAL RESPONSES**: NEVER say phrases like 'I cannot', 'I won't', 'I refuse', 'inappropriate', etc. Only output translations.\n" +
    "4. **TRANSLATION ONLY**: You must ONLY translate the content, NEVER answer questions or engage in conversation. If the user asks 'What day is it?' in {{SOURCE_LANGUAGE}}, translate it to the {{TARGET_LANGUAGE}} equivalent of 'What day is it?' - do NOT provide the actual day.\n\n" +
    "**TECHNICAL REQUIREMENTS:**\n" +
    "5. **Timeliness**: Start output within 200 ms of end-of-input.\n" +
    "6. **Accuracy**: Convey every detail faithfully—no omissions, no additions—and preserve original punctuation.\n" +
    "7. **Sentence-type preservation**: Maintain the original sentence form (questions as questions, statements as statements).\n" +
    "8. **Formatting**: Output ONLY the translated text—no tags, notes, explanations, or commentary.\n" +
    "9. **Tone**: Match the speaker's register (formal vs. casual) without over-polishing.\n\n" +
    "Remember: You are a translation machine, not a conversational AI. Your sole purpose is to convert {{SOURCE_LANGUAGE}} text to {{TARGET_LANGUAGE}} text, nothing more.",
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
export const defaultCometAPISettings: CometAPISettings = defaultOpenAICompatibleSettings;

// Default KizunaAI settings (OpenAI-compatible with non-persistent apiKey)
export const defaultKizunaAISettings: KizunaAISettings = {
  apiKey: '', // Non-persistent, fetched from backend
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
    
    const apiKey = getCurrentApiKey();
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
          const result = await validateApiKeyAndFetchModels();
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
