import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { ServiceFactory } from '../services/ServiceFactory';
import { ProviderConfigFactory } from '../services/providers/ProviderConfigFactory';
import { ProviderConfig } from '../services/providers/ProviderConfig';
import { 
  FilteredModel, 
  SessionConfig, 
  OpenAISessionConfig, 
  GeminiSessionConfig, 
  PalabraAISessionConfig 
} from '../services/interfaces/IClient';
import { ApiKeyValidationResult } from '../services/interfaces/ISettingsService';
import { Provider, ProviderType } from '../types/Provider';

// ==================== Type Definitions ====================

// Common Settings
export interface CommonSettings {
  provider: ProviderType;
  uiLanguage: string;
  uiMode: 'basic' | 'advanced';
  systemInstructions: string;
  templateSystemInstructions: string;
  useTemplateMode: boolean;
}

// OpenAI-compatible Settings (used by OpenAI, CometAPI, and KizunaAI)
export interface OpenAICompatibleSettings {
  apiKey: string;
  model: string;
  voice: string;
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

export type OpenAISettings = OpenAICompatibleSettings;
export type CometAPISettings = OpenAICompatibleSettings;
export type KizunaAISettings = OpenAICompatibleSettings;

// Gemini Settings
export interface GeminiSettings {
  apiKey: string;
  model: string;
  voice: string;
  sourceLanguage: string;
  targetLanguage: string;
  temperature: number;
  maxTokens: number | 'inf';
}

// PalabraAI Settings
export interface PalabraAISettings {
  clientId: string;
  clientSecret: string;
  sourceLanguage: string;
  targetLanguage: string;
  voiceId: string;
  subscriberCount: number;
  publisherCanSubscribe: boolean;
  segmentConfirmationSilenceThreshold: number;
  sentenceSplitterEnabled: boolean;
  translatePartialTranscriptions: boolean;
  desiredQueueLevelMs: number;
  maxQueueLevelMs: number;
  autoTempo: boolean;
}

// Cache Entry
interface CacheEntry {
  validation: ApiKeyValidationResult;
  models: FilteredModel[];
  timestamp: number;
}

// ==================== Default Values ====================

const defaultCommonSettings: CommonSettings = {
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

const defaultOpenAICompatibleSettings: OpenAICompatibleSettings = {
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

const defaultOpenAISettings: OpenAISettings = defaultOpenAICompatibleSettings;
const defaultCometAPISettings: CometAPISettings = {
  ...defaultOpenAICompatibleSettings,
  transcriptModel: 'whisper-1',
};
const defaultKizunaAISettings: KizunaAISettings = {
  ...defaultOpenAICompatibleSettings,
  transcriptModel: 'whisper-1',
};

const defaultGeminiSettings: GeminiSettings = {
  apiKey: '',
  model: 'gemini-2.0-flash-exp',
  voice: 'Aoede',
  sourceLanguage: 'en-US',
  targetLanguage: 'ja-JP',
  temperature: 0.8,
  maxTokens: 4096,
};

const defaultPalabraAISettings: PalabraAISettings = {
  clientId: '',
  clientSecret: '',
  sourceLanguage: 'en',
  targetLanguage: 'es',
  voiceId: 'default_low',
  subscriberCount: 0,
  publisherCanSubscribe: true,
  segmentConfirmationSilenceThreshold: 0.7,
  sentenceSplitterEnabled: true,
  translatePartialTranscriptions: false,
  desiredQueueLevelMs: 8000,
  maxQueueLevelMs: 24000,
  autoTempo: false,
};

// ==================== Store Definition ====================

interface SettingsStore {
  // === State ===
  // Common settings
  provider: ProviderType;
  uiLanguage: string;
  uiMode: 'basic' | 'advanced';
  systemInstructions: string;
  templateSystemInstructions: string;
  useTemplateMode: boolean;
  
  // Provider-specific settings
  openai: OpenAISettings;
  gemini: GeminiSettings;
  cometapi: CometAPISettings;
  palabraai: PalabraAISettings;
  kizunaai: KizunaAISettings;
  
  // Validation state
  isApiKeyValid: boolean | null;
  isValidating: boolean;
  validationMessage: string;
  validationCache: Map<string, CacheEntry>;
  
  // Models state
  availableModels: FilteredModel[];
  loadingModels: boolean;
  
  // Kizuna AI state
  isKizunaKeyFetching: boolean;
  kizunaKeyError: string | null;
  
  // Navigation state
  settingsNavigationTarget: string | null;
  
  // Settings loading state
  settingsLoaded: boolean;
  
  // === Actions ===
  // Common settings actions
  setProvider: (provider: ProviderType) => void;
  setUILanguage: (lang: string) => void;
  setUIMode: (mode: 'basic' | 'advanced') => void;
  setSystemInstructions: (instructions: string) => void;
  setTemplateSystemInstructions: (instructions: string) => void;
  setUseTemplateMode: (useTemplate: boolean) => void;
  
  // Provider settings actions
  updateOpenAI: (settings: Partial<OpenAISettings>) => void;
  updateGemini: (settings: Partial<GeminiSettings>) => void;
  updateCometAPI: (settings: Partial<CometAPISettings>) => void;
  updatePalabraAI: (settings: Partial<PalabraAISettings>) => void;
  updateKizunaAI: (settings: Partial<KizunaAISettings>) => void;
  
  // Async actions
  validateApiKey: (getAuthToken?: () => Promise<string | null>) => Promise<ApiKeyValidationResult>;
  fetchAvailableModels: (getAuthToken?: () => Promise<string | null>) => Promise<void>;
  ensureKizunaApiKey: (getToken: () => Promise<string | null>, isSignedIn: boolean) => Promise<boolean>;
  loadSettings: () => Promise<void>;
  clearCache: () => void;
  
  // Helper methods
  getCurrentProviderSettings: () => OpenAISettings | GeminiSettings | CometAPISettings | PalabraAISettings | KizunaAISettings;
  getCurrentProviderConfig: () => ProviderConfig;
  getProcessedSystemInstructions: () => string;
  createSessionConfig: (systemInstructions: string) => SessionConfig;
  navigateToSettings: (target: string | null) => void;
}

// ==================== Helper Functions ====================

function createOpenAISessionConfig(
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

function createGeminiSessionConfig(
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

function createPalabraAISessionConfig(
  settings: PalabraAISettings, 
  systemInstructions: string
): PalabraAISessionConfig {
  return {
    provider: 'palabraai',
    model: 'realtime-translation',
    voice: settings.voiceId,
    instructions: systemInstructions,
    temperature: 0.8,
    maxTokens: 'inf',
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

// ==================== Store Implementation ====================

const useSettingsStore = create<SettingsStore>()(
  subscribeWithSelector((set, get) => ({
    // === Initial State ===
    ...defaultCommonSettings,
    openai: defaultOpenAISettings,
    gemini: defaultGeminiSettings,
    cometapi: defaultCometAPISettings,
    palabraai: defaultPalabraAISettings,
    kizunaai: defaultKizunaAISettings,
    
    isApiKeyValid: null,
    isValidating: false,
    validationMessage: '',
    validationCache: new Map(),
    
    availableModels: [],
    loadingModels: false,
    
    isKizunaKeyFetching: false,
    kizunaKeyError: null,
    
    settingsNavigationTarget: null,
    
    settingsLoaded: false,
    
    // === Common Settings Actions ===
    setProvider: async (provider) => {
      set({ provider });
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.provider', provider);
      
      // Clear cache when switching providers
      const state = get();
      state.clearCache();
      
      // Auto-validate API key for the new provider
      // Note: For KizunaAI, this will be handled by SettingsInitializer
      if (provider !== Provider.KIZUNA_AI) {
        // Small delay to ensure state is updated
        setTimeout(() => {
          state.validateApiKey();
        }, 100);
      }
    },
    
    setUILanguage: async (uiLanguage) => {
      set({ uiLanguage });
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.uiLanguage', uiLanguage);
    },
    
    setUIMode: async (uiMode) => {
      set({ uiMode });
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.uiMode', uiMode);
    },
    
    setSystemInstructions: async (systemInstructions) => {
      set({ systemInstructions });
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.systemInstructions', systemInstructions);
    },
    
    setTemplateSystemInstructions: async (templateSystemInstructions) => {
      set({ templateSystemInstructions });
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.templateSystemInstructions', templateSystemInstructions);
    },
    
    setUseTemplateMode: async (useTemplateMode) => {
      set({ useTemplateMode });
      const service = ServiceFactory.getSettingsService();
      await service.setSetting('settings.common.useTemplateMode', useTemplateMode);
    },
    
    // === Provider Settings Actions ===
    updateOpenAI: async (settings) => {
      set((state) => ({ openai: { ...state.openai, ...settings } }));
      const service = ServiceFactory.getSettingsService();
      for (const [key, value] of Object.entries(settings)) {
        await service.setSetting(`settings.openai.${key}`, value);
      }
    },
    
    updateGemini: async (settings) => {
      set((state) => ({ gemini: { ...state.gemini, ...settings } }));
      const service = ServiceFactory.getSettingsService();
      for (const [key, value] of Object.entries(settings)) {
        await service.setSetting(`settings.gemini.${key}`, value);
      }
    },
    
    updateCometAPI: async (settings) => {
      set((state) => ({ cometapi: { ...state.cometapi, ...settings } }));
      const service = ServiceFactory.getSettingsService();
      for (const [key, value] of Object.entries(settings)) {
        await service.setSetting(`settings.cometapi.${key}`, value);
      }
    },
    
    updatePalabraAI: async (settings) => {
      set((state) => ({ palabraai: { ...state.palabraai, ...settings } }));
      const service = ServiceFactory.getSettingsService();
      for (const [key, value] of Object.entries(settings)) {
        await service.setSetting(`settings.palabraai.${key}`, value);
      }
    },
    
    updateKizunaAI: async (settings) => {
      set((state) => ({ kizunaai: { ...state.kizunaai, ...settings } }));
      const service = ServiceFactory.getSettingsService();
      for (const [key, value] of Object.entries(settings)) {
        if (key === 'apiKey') continue; // Don't persist Kizuna AI API key
        await service.setSetting(`settings.kizunaai.${key}`, value);
      }
    },
    
    // === Async Actions ===
    validateApiKey: async (getAuthToken) => {
      const state = get();
      const provider = state.provider;
      
      // For KizunaAI, ensure we have an API key first
      if (provider === Provider.KIZUNA_AI) {
        const hasKey = await state.ensureKizunaApiKey(getAuthToken!, true);
        if (!hasKey) {
          return {
            valid: false,
            message: state.kizunaKeyError || 'Failed to fetch Kizuna AI API key',
            validating: false
          };
        }
      }
      
      // Get current API key
      const currentSettings = state.getCurrentProviderSettings();
      let apiKey = '';
      
      if (provider === Provider.PALABRA_AI) {
        const palabraSettings = currentSettings as PalabraAISettings;
        apiKey = palabraSettings.clientId;
        
        // Check if both clientId and clientSecret are present for PalabraAI
        if (!palabraSettings.clientId || !palabraSettings.clientSecret) {
          set({
            isApiKeyValid: null,
            availableModels: [],
            validationMessage: '',
            isValidating: false,
            isValidated: false,
            validationError: null
          });
          return { valid: false, message: '', validating: false };
        }
      } else if (provider === Provider.KIZUNA_AI && getAuthToken) {
        apiKey = await getAuthToken() || '';
      } else {
        apiKey = (currentSettings as any).apiKey || '';
      }
      
      // Check if API key is empty for non-PalabraAI providers
      if (!apiKey && provider !== Provider.PALABRA_AI) {
        set({
          isApiKeyValid: null,
          availableModels: [],
          validationMessage: '',
          isValidating: false,
          isValidated: false,
          validationError: null
        });
        return { valid: false, message: '', validating: false };
      }
      
      // Check cache
      const cacheKey = provider === Provider.PALABRA_AI 
        ? `${provider}:${apiKey}:${(currentSettings as PalabraAISettings).clientSecret}`
        : `${provider}:${apiKey}`;
      
      const cached = state.validationCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        set({ 
          isApiKeyValid: Boolean(cached.validation.valid),
          availableModels: cached.models,
          validationMessage: cached.validation.message,
          isValidating: false,
          isValidated: true,
          validationError: cached.validation.valid ? null : cached.validation.message,
          cacheTimestamp: cached.timestamp
        });
        return cached.validation;
      }
      
      // Validate
      set({ isValidating: true, validationMessage: 'Validating...' });
      
      try {
        const service = ServiceFactory.getSettingsService();
        const clientSecret = provider === Provider.PALABRA_AI
          ? (currentSettings as PalabraAISettings).clientSecret 
          : undefined;
        
        const result = await service.validateApiKeyAndFetchModels(apiKey, provider, clientSecret);
        
        // Cache result
        const newCache = new Map(state.validationCache);
        newCache.set(cacheKey, {
          validation: result.validation,
          models: result.models,
          timestamp: Date.now()
        });
        
        set({
          isApiKeyValid: Boolean(result.validation.valid),
          availableModels: result.models,
          validationMessage: result.validation.message,
          validationCache: newCache,
          isValidating: false,
          isValidated: true,
          validationError: result.validation.valid ? null : result.validation.message,
          cacheTimestamp: Date.now()
        });
        
        return result.validation;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Validation failed';
        set({
          isApiKeyValid: false,
          availableModels: [],
          validationMessage: message,
          isValidating: false,
          isValidated: false,
          validationError: message
        });
        return { valid: false, message, validating: false };
      }
    },
    
    fetchAvailableModels: async (getAuthToken) => {
      set({ loadingModels: true });
      const result = await get().validateApiKey(getAuthToken);
      set({ loadingModels: false });
    },
    
    ensureKizunaApiKey: async (getToken, isSignedIn) => {
      const state = get();
      
      if (state.kizunaai.apiKey && state.kizunaai.apiKey.trim() !== '') {
        return true;
      }
      
      if (state.isKizunaKeyFetching) {
        console.log('[SettingsStore] Token fetch already in progress');
        return false;
      }
      
      if (!isSignedIn || !getToken) {
        console.log('[SettingsStore] Cannot get token - user not signed in');
        set({ kizunaKeyError: 'User not signed in' });
        return false;
      }
      
      set({ isKizunaKeyFetching: true, kizunaKeyError: null });
      
      try {
        console.log('[SettingsStore] Getting Clerk token for Kizuna AI...');
        const clerkToken = await getToken();
        
        if (clerkToken) {
          console.log('[SettingsStore] Successfully got Clerk token for Kizuna AI');
          set((state) => ({ 
            kizunaai: { ...state.kizunaai, apiKey: clerkToken },
            isKizunaKeyFetching: false 
          }));
          return true;
        } else {
          const error = 'Failed to get Clerk token';
          console.warn('[SettingsStore] ' + error);
          set({ kizunaKeyError: error, isKizunaKeyFetching: false });
          return false;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error getting Clerk token';
        console.error('[SettingsStore] Error getting Clerk token for Kizuna AI:', errorMessage);
        set({ kizunaKeyError: errorMessage, isKizunaKeyFetching: false });
        return false;
      }
    },
    
    loadSettings: async () => {
      try {
        const service = ServiceFactory.getSettingsService();
        
        // Load common settings
        const provider = await service.getSetting('settings.common.provider', defaultCommonSettings.provider);
        const uiLanguage = await service.getSetting('settings.common.uiLanguage', defaultCommonSettings.uiLanguage);
        const uiMode = await service.getSetting('settings.common.uiMode', defaultCommonSettings.uiMode);
        const systemInstructions = await service.getSetting('settings.common.systemInstructions', defaultCommonSettings.systemInstructions);
        const templateSystemInstructions = await service.getSetting('settings.common.templateSystemInstructions', defaultCommonSettings.templateSystemInstructions);
        const useTemplateMode = await service.getSetting('settings.common.useTemplateMode', defaultCommonSettings.useTemplateMode);
        
        // Validate provider availability
        const validProvider = ProviderConfigFactory.isProviderSupported(provider) ? provider : Provider.OPENAI;
        
        // Load provider settings
        const loadProviderSettings = async <T>(prefix: string, defaults: T): Promise<T> => {
          const settings: any = {};
          for (const key of Object.keys(defaults as any)) {
            settings[key] = await service.getSetting(`${prefix}.${key}`, (defaults as any)[key]);
          }
          return settings as T;
        };
        
        const [openai, gemini, cometapi, palabraai, kizunaai] = await Promise.all([
          loadProviderSettings('settings.openai', defaultOpenAISettings),
          loadProviderSettings('settings.gemini', defaultGeminiSettings),
          loadProviderSettings('settings.cometapi', defaultCometAPISettings),
          loadProviderSettings('settings.palabraai', defaultPalabraAISettings),
          loadProviderSettings('settings.kizunaai', defaultKizunaAISettings),
        ]);
        
        set({
          provider: validProvider,
          uiLanguage,
          uiMode,
          systemInstructions,
          templateSystemInstructions,
          useTemplateMode,
          openai,
          gemini,
          cometapi,
          palabraai,
          kizunaai,
          settingsLoaded: true,
        });
        
        console.info('[SettingsStore] Settings loaded successfully');
      } catch (error) {
        console.error('[SettingsStore] Error loading settings:', error);
      }
    },
    
    clearCache: () => {
      set({ 
        validationCache: new Map(),
        availableModels: [],
        isApiKeyValid: null 
      });
    },
    
    // === Helper Methods ===
    getCurrentProviderSettings: () => {
      const state = get();
      switch (state.provider) {
        case Provider.OPENAI:
          return state.openai;
        case Provider.COMET_API:
          return state.cometapi;
        case Provider.GEMINI:
          return state.gemini;
        case Provider.PALABRA_AI:
          return state.palabraai;
        case Provider.KIZUNA_AI:
          return state.kizunaai;
        default:
          return state.openai;
      }
    },
    
    getCurrentProviderConfig: () => {
      const state = get();
      try {
        return ProviderConfigFactory.getConfig(state.provider);
      } catch (error) {
        console.warn(`[SettingsStore] Unknown provider: ${state.provider}, falling back to OpenAI`);
        return ProviderConfigFactory.getConfig(Provider.OPENAI);
      }
    },
    
    getProcessedSystemInstructions: () => {
      const state = get();
      if (state.useTemplateMode) {
        const providerConfig = state.getCurrentProviderConfig();
        const currentSettings = state.getCurrentProviderSettings();
        
        const sourceLang = providerConfig.languages.find(l => l.value === currentSettings.sourceLanguage);
        const targetLang = providerConfig.languages.find(l => l.value === currentSettings.targetLanguage);
        
        const sourceLangName = sourceLang?.englishName || currentSettings.sourceLanguage || 'SOURCE_LANGUAGE';
        const targetLangName = targetLang?.englishName || currentSettings.targetLanguage || 'TARGET_LANGUAGE';
        
        return state.templateSystemInstructions
          .replace(/\{\{SOURCE_LANGUAGE\}\}/g, sourceLangName)
          .replace(/\{\{TARGET_LANGUAGE\}\}/g, targetLangName);
      } else {
        return state.systemInstructions;
      }
    },
    
    createSessionConfig: (systemInstructions) => {
      const state = get();
      switch (state.provider) {
        case Provider.OPENAI:
          return createOpenAISessionConfig(state.openai, systemInstructions);
        case Provider.COMET_API:
          return createOpenAISessionConfig(state.cometapi, systemInstructions);
        case Provider.GEMINI:
          return createGeminiSessionConfig(state.gemini, systemInstructions);
        case Provider.PALABRA_AI:
          return createPalabraAISessionConfig(state.palabraai, systemInstructions);
        case Provider.KIZUNA_AI:
          return createOpenAISessionConfig(state.kizunaai, systemInstructions);
        default:
          return createOpenAISessionConfig(state.openai, systemInstructions);
      }
    },
    
    navigateToSettings: (target) => {
      set({ settingsNavigationTarget: target });
    },
  }))
);

// ==================== Export Optimized Selectors ====================

// Common settings
export const useProvider = () => useSettingsStore((state) => state.provider);
export const useUILanguage = () => useSettingsStore((state) => state.uiLanguage);
export const useUIMode = () => useSettingsStore((state) => state.uiMode);
export const useSystemInstructions = () => useSettingsStore((state) => state.systemInstructions);
export const useTemplateSystemInstructions = () => useSettingsStore((state) => state.templateSystemInstructions);
export const useUseTemplateMode = () => useSettingsStore((state) => state.useTemplateMode);

// Provider settings
export const useOpenAISettings = () => useSettingsStore((state) => state.openai);
export const useGeminiSettings = () => useSettingsStore((state) => state.gemini);
export const useCometAPISettings = () => useSettingsStore((state) => state.cometapi);
export const usePalabraAISettings = () => useSettingsStore((state) => state.palabraai);
export const useKizunaAISettings = () => useSettingsStore((state) => state.kizunaai);

// Validation state
export const useIsApiKeyValid = () => useSettingsStore((state) => state.isApiKeyValid);
export const useIsValidating = () => useSettingsStore((state) => state.isValidating);
export const useValidationMessage = () => useSettingsStore((state) => state.validationMessage);

// Models state
export const useAvailableModels = () => useSettingsStore((state) => state.availableModels);
export const useLoadingModels = () => useSettingsStore((state) => state.loadingModels);

// Kizuna state
export const useIsKizunaKeyFetching = () => useSettingsStore((state) => state.isKizunaKeyFetching);
export const useKizunaKeyError = () => useSettingsStore((state) => state.kizunaKeyError);

// Navigation
export const useSettingsNavigationTarget = () => useSettingsStore((state) => state.settingsNavigationTarget);

// Settings loading state
export const useSettingsLoaded = () => useSettingsStore((state) => state.settingsLoaded);

// Actions
export const useSetProvider = () => useSettingsStore((state) => state.setProvider);
export const useSetUILanguage = () => useSettingsStore((state) => state.setUILanguage);
export const useSetUIMode = () => useSettingsStore((state) => state.setUIMode);
export const useSetSystemInstructions = () => useSettingsStore((state) => state.setSystemInstructions);
export const useSetTemplateSystemInstructions = () => useSettingsStore((state) => state.setTemplateSystemInstructions);
export const useSetUseTemplateMode = () => useSettingsStore((state) => state.setUseTemplateMode);

export const useUpdateOpenAI = () => useSettingsStore((state) => state.updateOpenAI);
export const useUpdateGemini = () => useSettingsStore((state) => state.updateGemini);
export const useUpdateCometAPI = () => useSettingsStore((state) => state.updateCometAPI);
export const useUpdatePalabraAI = () => useSettingsStore((state) => state.updatePalabraAI);
export const useUpdateKizunaAI = () => useSettingsStore((state) => state.updateKizunaAI);

export const useValidateApiKey = () => useSettingsStore((state) => state.validateApiKey);
export const useFetchAvailableModels = () => useSettingsStore((state) => state.fetchAvailableModels);
export const useEnsureKizunaApiKey = () => useSettingsStore((state) => state.ensureKizunaApiKey);
export const useLoadSettings = () => useSettingsStore((state) => state.loadSettings);
export const useClearCache = () => useSettingsStore((state) => state.clearCache);

export const useGetCurrentProviderSettings = () => useSettingsStore((state) => state.getCurrentProviderSettings);
export const useGetCurrentProviderConfig = () => useSettingsStore((state) => state.getCurrentProviderConfig);
export const useGetProcessedSystemInstructions = () => useSettingsStore((state) => state.getProcessedSystemInstructions);
export const useCreateSessionConfig = () => useSettingsStore((state) => state.createSessionConfig);
export const useNavigateToSettings = () => useSettingsStore((state) => state.navigateToSettings);

export default useSettingsStore;