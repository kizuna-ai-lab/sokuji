import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ServiceFactory } from '../services/ServiceFactory';
import { ProviderConfigFactory } from '../services/providers/ProviderConfigFactory';
import { ProviderConfig } from '../services/providers/ProviderConfig';
import { FilteredModel } from '../services/interfaces/IClient';
import { ApiKeyValidationResult } from '../services/interfaces/ISettingsService';

// Common Settings - applicable to all providers
export interface CommonSettings {
  provider: 'openai' | 'gemini';
  uiLanguage: string; // UI language setting
  systemInstructions: string;
  templateSystemInstructions: string;
  useTemplateMode: boolean;
}

// OpenAI-specific Settings
export interface OpenAISettings {
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

// Combined Settings interface for backward compatibility
export interface Settings extends CommonSettings {
  // For backward compatibility, we'll maintain the old structure
  // but these will be managed separately internally
  openAIApiKey: string;
  geminiApiKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  
  // Current provider's settings (for backward compatibility)
  turnDetectionMode: OpenAISettings['turnDetectionMode'];
  threshold: number;
  prefixPadding: number;
  silenceDuration: number;
  semanticEagerness: OpenAISettings['semanticEagerness'];
  model: string;
  temperature: number;
  maxTokens: number | 'inf';
  transcriptModel: OpenAISettings['transcriptModel'];
  noiseReduction: OpenAISettings['noiseReduction'];
  voice: string;
}

interface SettingsContextType {
  // Common settings
  commonSettings: CommonSettings;
  updateCommonSettings: (newSettings: Partial<CommonSettings>) => void;
  
  // Provider-specific settings
  openAISettings: OpenAISettings;
  geminiSettings: GeminiSettings;
  updateOpenAISettings: (newSettings: Partial<OpenAISettings>) => void;
  updateGeminiSettings: (newSettings: Partial<GeminiSettings>) => void;
  
  // Current provider settings (computed from provider-specific settings)
  getCurrentProviderSettings: () => OpenAISettings | GeminiSettings;
  
  // Legacy settings interface for backward compatibility
  settings: Settings;
  updateSettings: (newSettings: Partial<Settings>) => void;
  
  // Other context methods
  reloadSettings: () => Promise<void>;
  isApiKeyValid: boolean;
  validateApiKey: () => Promise<{
    valid: boolean | null;
    message: string;
    validating?: boolean;
  }>;
  getProcessedSystemInstructions: () => string;
  availableModels: FilteredModel[];
  loadingModels: boolean;
  fetchAvailableModels: () => Promise<void>;
  clearAvailableModels: () => void;
  getCurrentProviderConfig: () => ProviderConfig;
}

// Language code to full name mapping for system instructions
const getLanguageName = (code: string): string => {
  const languageMap: { [key: string]: string } = {
    'ar': 'Arabic',
    'am': 'Amharic',
    'bg': 'Bulgarian',
    'bn': 'Bengali',
    'ca': 'Catalan',
    'cs': 'Czech',
    'da': 'Danish',
    'de': 'German',
    'el': 'Greek',
    'en': 'English',
    'en_AU': 'English (Australia)',
    'en_GB': 'English (Great Britain)',
    'en_US': 'English (USA)',
    'es': 'Spanish',
    'es_419': 'Spanish (Latin America and Caribbean)',
    'et': 'Estonian',
    'fa': 'Persian',
    'fi': 'Finnish',
    'fil': 'Filipino',
    'fr': 'French',
    'gu': 'Gujarati',
    'he': 'Hebrew',
    'hi': 'Hindi',
    'hr': 'Croatian',
    'hu': 'Hungarian',
    'id': 'Indonesian',
    'it': 'Italian',
    'ja': 'Japanese',
    'kn': 'Kannada',
    'ko': 'Korean',
    'lt': 'Lithuanian',
    'lv': 'Latvian',
    'ml': 'Malayalam',
    'mr': 'Marathi',
    'ms': 'Malay',
    'nl': 'Dutch',
    'no': 'Norwegian',
    'pl': 'Polish',
    'pt_BR': 'Portuguese (Brazil)',
    'pt_PT': 'Portuguese (Portugal)',
    'ro': 'Romanian',
    'ru': 'Russian',
    'sk': 'Slovak',
    'sl': 'Slovenian',
    'sr': 'Serbian',
    'sv': 'Swedish',
    'sw': 'Swahili',
    'ta': 'Tamil',
    'te': 'Telugu',
    'th': 'Thai',
    'tr': 'Turkish',
    'uk': 'Ukrainian',
    'vi': 'Vietnamese',
    'zh_CN': 'Chinese (China)',
    'zh_TW': 'Chinese (Taiwan)',
  };
  
  return languageMap[code] || code;
};

// Default common settings
export const defaultCommonSettings: CommonSettings = {
  provider: 'openai',
  uiLanguage: 'en',
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

// Default OpenAI settings
export const defaultOpenAISettings: OpenAISettings = {
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

// Default Gemini settings
export const defaultGeminiSettings: GeminiSettings = {
  apiKey: '',
  model: 'gemini-2.0-flash-exp',
  voice: 'Aoede',
  sourceLanguage: 'en-US',
  targetLanguage: 'cmn-CN',
  temperature: 0.8,
  maxTokens: 4096,
};

// Legacy default settings for backward compatibility
export const defaultSettings: Settings = {
  ...defaultCommonSettings,
  openAIApiKey: defaultOpenAISettings.apiKey,
  geminiApiKey: defaultGeminiSettings.apiKey,
  sourceLanguage: defaultOpenAISettings.sourceLanguage,
  targetLanguage: defaultOpenAISettings.targetLanguage,
  model: defaultOpenAISettings.model,
  voice: defaultOpenAISettings.voice,
  turnDetectionMode: defaultOpenAISettings.turnDetectionMode,
  threshold: defaultOpenAISettings.threshold,
  prefixPadding: defaultOpenAISettings.prefixPadding,
  silenceDuration: defaultOpenAISettings.silenceDuration,
  semanticEagerness: defaultOpenAISettings.semanticEagerness,
  temperature: defaultOpenAISettings.temperature,
  maxTokens: defaultOpenAISettings.maxTokens,
  transcriptModel: defaultOpenAISettings.transcriptModel,
  noiseReduction: defaultOpenAISettings.noiseReduction,
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
  
  // Separate state management for different settings categories
  const [commonSettings, setCommonSettings] = useState<CommonSettings>(defaultCommonSettings);
  const [openAISettings, setOpenAISettings] = useState<OpenAISettings>(defaultOpenAISettings);
  const [geminiSettings, setGeminiSettings] = useState<GeminiSettings>(defaultGeminiSettings);
  
  const [isApiKeyValid, setIsApiKeyValid] = useState(false);
  const [availableModels, setAvailableModels] = useState<FilteredModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  
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
      return ProviderConfigFactory.getConfig('openai');
    }
  }, [commonSettings.provider]);

  // Get current provider's settings
  const getCurrentProviderSettings = useCallback((): OpenAISettings | GeminiSettings => {
    return commonSettings.provider === 'openai' ? openAISettings : geminiSettings;
  }, [commonSettings.provider, openAISettings, geminiSettings]);

  // Get current API key based on provider
  const getCurrentApiKey = useCallback((): string => {
    return commonSettings.provider === 'openai' ? openAISettings.apiKey : geminiSettings.apiKey;
  }, [commonSettings.provider, openAISettings.apiKey, geminiSettings.apiKey]);

  // Generate cache key for current provider and API key
  const getCacheKey = useCallback((): string => {
    const apiKey = getCurrentApiKey();
    return `${commonSettings.provider}:${apiKey}`;
  }, [commonSettings.provider, getCurrentApiKey]);

  // Check if cache is valid (not older than 5 minutes)
  const isCacheValid = useCallback((timestamp: number): boolean => {
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
    return Date.now() - timestamp < CACHE_DURATION;
  }, []);

  // Validate API key and fetch models in a single request with caching
  const validateApiKeyAndFetchModels = useCallback(async (): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> => {
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
      const result = await settingsService.validateApiKeyAndFetchModels(apiKey, commonSettings.provider);
      
      // Cache the result
      const newCache = new Map(modelsCache);
      newCache.set(cacheKey, {
        validation: result.validation,
        models: result.models,
        timestamp: Date.now()
      });
      setModelsCache(newCache);
      
      return result;
    } catch (error) {
      console.error('[Settings] Error validating API key and fetching models:', error);
      const result = {
        validation: {
          valid: false,
          message: error instanceof Error ? error.message : 'Error validating API key',
          validating: false
        } as ApiKeyValidationResult,
        models: [] as FilteredModel[]
      };
      return result;
    }
  }, [commonSettings.provider, getCurrentApiKey, getCacheKey, modelsCache, isCacheValid, settingsService]);

  // Create legacy settings object for backward compatibility
  const legacySettings: Settings = {
    ...commonSettings,
    openAIApiKey: openAISettings.apiKey,
    geminiApiKey: geminiSettings.apiKey,
    ...(commonSettings.provider === 'openai' ? {
      sourceLanguage: openAISettings.sourceLanguage,
      targetLanguage: openAISettings.targetLanguage,
      model: openAISettings.model,
      voice: openAISettings.voice,
      turnDetectionMode: openAISettings.turnDetectionMode,
      threshold: openAISettings.threshold,
      prefixPadding: openAISettings.prefixPadding,
      silenceDuration: openAISettings.silenceDuration,
      semanticEagerness: openAISettings.semanticEagerness,
      temperature: openAISettings.temperature,
      maxTokens: openAISettings.maxTokens,
      transcriptModel: openAISettings.transcriptModel,
      noiseReduction: openAISettings.noiseReduction,
    } : {
      sourceLanguage: geminiSettings.sourceLanguage,
      targetLanguage: geminiSettings.targetLanguage,
      model: geminiSettings.model,
      voice: geminiSettings.voice,
      temperature: geminiSettings.temperature,
      maxTokens: geminiSettings.maxTokens,
      // Provide default values for OpenAI-specific settings when using Gemini
      turnDetectionMode: 'Normal' as const,
      threshold: 0.49,
      prefixPadding: 0.5,
      silenceDuration: 0.5,
      semanticEagerness: 'Auto' as const,
      transcriptModel: 'gpt-4o-mini-transcribe' as const,
      noiseReduction: 'None' as const,
    }),
  };
  
  // Process system instructions based on the selected mode
  const getProcessedSystemInstructions = useCallback(() => {
    if (commonSettings.useTemplateMode) {
      const currentSettings = commonSettings.provider === 'openai' ? openAISettings : geminiSettings;
      return commonSettings.templateSystemInstructions
        .replace(/\{\{SOURCE_LANGUAGE\}\}/g, getLanguageName(currentSettings.sourceLanguage || 'SOURCE_LANGUAGE'))
        .replace(/\{\{TARGET_LANGUAGE\}\}/g, getLanguageName(currentSettings.targetLanguage || 'TARGET_LANGUAGE'));
    } else {
      return commonSettings.systemInstructions;
    }
  }, [commonSettings.useTemplateMode, commonSettings.templateSystemInstructions, commonSettings.systemInstructions, commonSettings.provider, openAISettings.sourceLanguage, openAISettings.targetLanguage, geminiSettings.sourceLanguage, geminiSettings.targetLanguage]);

  // Validate the API key for current provider
  const validateApiKey = useCallback(async () => {
    try {
      const result = await validateApiKeyAndFetchModels();
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

  // Legacy update function for backward compatibility
  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    // Split the settings update based on categories
    const commonUpdates: Partial<CommonSettings> = {};
    const openAIUpdates: Partial<OpenAISettings> = {};
    const geminiUpdates: Partial<GeminiSettings> = {};

    // Map legacy settings to new structure
    Object.entries(newSettings).forEach(([key, value]) => {
      switch (key) {
        case 'provider':
        case 'uiLanguage':
        case 'systemInstructions':
        case 'templateSystemInstructions':
        case 'useTemplateMode':
          (commonUpdates as any)[key] = value;
          break;
        case 'sourceLanguage':
        case 'targetLanguage':
          // Language settings are now provider-specific
          if (commonSettings.provider === 'openai') {
            (openAIUpdates as any)[key] = value;
          } else {
            (geminiUpdates as any)[key] = value;
          }
          break;
        case 'openAIApiKey':
          openAIUpdates.apiKey = value as string;
          break;
        case 'geminiApiKey':
          geminiUpdates.apiKey = value as string;
          break;
        case 'model':
        case 'voice':
        case 'temperature':
        case 'maxTokens':
          if (commonSettings.provider === 'openai') {
            (openAIUpdates as any)[key] = value;
          } else {
            (geminiUpdates as any)[key] = value;
          }
          break;
        case 'turnDetectionMode':
        case 'threshold':
        case 'prefixPadding':
        case 'silenceDuration':
        case 'semanticEagerness':
        case 'transcriptModel':
        case 'noiseReduction':
          // These are OpenAI-specific
          if (commonSettings.provider === 'openai') {
            (openAIUpdates as any)[key] = value;
          }
          break;
      }
    });

    // Apply updates
    if (Object.keys(commonUpdates).length > 0) {
      updateCommonSettings(commonUpdates);
    }
    if (Object.keys(openAIUpdates).length > 0) {
      updateOpenAISettings(openAIUpdates);
    }
    if (Object.keys(geminiUpdates).length > 0) {
      updateGeminiSettings(geminiUpdates);
    }
  }, [commonSettings.provider, updateCommonSettings, updateOpenAISettings, updateGeminiSettings]);

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

      // Load Gemini settings
      const loadedGemini: Partial<GeminiSettings> = {};
      for (const key of Object.keys(defaultGeminiSettings)) {
        const fullKey = `settings.gemini.${key}`;
        const defaultValue = (defaultGeminiSettings as any)[key];
        (loadedGemini as any)[key] = await settingsService.getSetting(fullKey, defaultValue);
      }
      setGeminiSettings(loadedGemini as GeminiSettings);

      console.info('[Settings] Loaded settings successfully');
      
      // Note: Auto-validation will be handled by the useEffect that monitors provider/API key changes
      // This prevents duplicate API requests during initialization
    } catch (error) {
      console.error('[Settings] Error loading settings:', error);
    }
  }, [settingsService]);

  // Fetch available models from current provider
  const fetchAvailableModels = useCallback(async () => {
    try {
      setLoadingModels(true);
      const result = await validateApiKeyAndFetchModels();
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
          setIsApiKeyValid(false);
          setAvailableModels([]);
        } finally {
          setLoadingModels(false);
        }
      }, 1000); // 1 second debounce
      
      return () => clearTimeout(timeoutId);
    } else {
      console.info('[Settings] No API key found, clearing validation state');
      setIsApiKeyValid(false);
      setAvailableModels([]);
      setModelsCache(new Map()); // Clear cache when no API key
    }
  }, [commonSettings.provider, openAISettings.apiKey, geminiSettings.apiKey, getCurrentApiKey, validateApiKeyAndFetchModels]);

  return (
    <SettingsContext.Provider
      value={{
        // New structured settings
        commonSettings,
        updateCommonSettings,
        openAISettings,
        geminiSettings,
        updateOpenAISettings,
        updateGeminiSettings,
        getCurrentProviderSettings,
        
        // Legacy settings interface
        settings: legacySettings,
        updateSettings,
        
        // Other context methods
        reloadSettings: loadSettings,
        isApiKeyValid,
        validateApiKey,
        getProcessedSystemInstructions,
        availableModels,
        loadingModels,
        fetchAvailableModels,
        clearAvailableModels,
        getCurrentProviderConfig
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};
