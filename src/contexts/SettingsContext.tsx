import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export type TurnDetectionMode = 'Normal' | 'Semantic' | 'Disabled';
export type SemanticEagerness = 'Auto' | 'Low' | 'Medium' | 'High';
export type NoiseReductionMode = 'None' | 'Near field' | 'Far field';
export type TranscriptModel = 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1';
export type VoiceOption = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';
export type Model = 'gpt-4o-realtime-preview' | 'gpt-4o-mini-realtime-preview';

export interface Settings {
  turnDetectionMode: TurnDetectionMode;
  threshold: number;
  prefixPadding: number;
  silenceDuration: number;
  semanticEagerness: SemanticEagerness;
  model: Model;
  temperature: number;
  maxTokens: number;
  transcriptModel: TranscriptModel;
  noiseReduction: NoiseReductionMode;
  voice: VoiceOption;
  systemInstructions: string;
  openAIApiKey: string;
}

interface SettingsContextType {
  settings: Settings;
  updateSettings: (newSettings: Partial<Settings>) => void;
  reloadSettings: () => Promise<void>;
  isApiKeyValid: boolean;
  validateApiKey: (apiKey?: string) => Promise<{
    valid: boolean | null;
    message: string;
    validating?: boolean;
  }>;
}

export const defaultSettings: Settings = {
  turnDetectionMode: 'Normal',
  threshold: 0.49,
  prefixPadding: 0.5,
  silenceDuration: 0.5,
  semanticEagerness: 'Auto',
  model: 'gpt-4o-mini-realtime-preview',
  temperature: 0.8,
  maxTokens: 4096,
  transcriptModel: 'gpt-4o-mini-transcribe',
  noiseReduction: 'None',
  voice: 'alloy',
  systemInstructions:
    "You are a professional real-time interpreter.\n" +
    "Your only job is to translate every single user input **literally** from Chinese to Japanese—no exceptions.\n" +
    "- **Never** reply that you don’t know, cannot judge, or ask for clarification.\n" +
    "- **Always** produce a translation in Japanese, even if the input is a question or sounds like chat.\n" +
    "- Preserve all sentence types (declarative, interrogative, etc.) and punctuation.\n" +
    "- Do not add, remove, or alter any content beyond the translation itself.\n" +
    "- Do not mention you are AI or that you are translating.\n" +
    "\n" +
    "**Examples**\n" +
    "- 用户（Chinese）：第十五号任务。\n" +  
    " AI（English）：15th task.\n" +  
    "\n" +
    "- 用户（Chinese）：这句话在日语中有没有类似的话?\n" +
    " AI（English）：Is there a similar expression in Japanese for this sentence?\n",
  openAIApiKey: '',
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [isApiKeyValid, setIsApiKeyValid] = useState<boolean>(false);

  // Comprehensive API key validation
  const validateApiKey = useCallback(async (apiKey?: string) => {
    const keyToValidate = apiKey !== undefined ? apiKey : settings.openAIApiKey;
    
    // First do basic validation
    if (!keyToValidate || keyToValidate.trim() === '') {
      setIsApiKeyValid(false);
      return {
        valid: false,
        message: 'API key cannot be empty',
        validating: false
      };
    }

    // Then do full validation with API call
    try {
      const result = await window.electron.openai.validateApiKey(keyToValidate);
      
      if (result.success && result.valid) {
        const modelCount = result.models?.length || 0;
        setIsApiKeyValid(true);
        return {
          valid: true,
          message: `Valid API key. Found ${modelCount} compatible models.`,
          validating: false
        };
      } else {
        setIsApiKeyValid(false);
        return {
          valid: false,
          message: result.error || 'Invalid API key',
          validating: false
        };
      }
    } catch (error) {
      console.error('Error validating API key:', error);
      setIsApiKeyValid(false);
      return {
        valid: false,
        message: error instanceof Error ? error.message : 'Error validating API key',
        validating: false
      };
    }
  }, [settings.openAIApiKey]);

  // Load settings from config.toml via Electron API
  const loadSettings = useCallback(async () => {
    try {
      const loaded = {
        turnDetectionMode: await window.electron.config.get('settings.turnDetectionMode', defaultSettings.turnDetectionMode),
        threshold: await window.electron.config.get('settings.threshold', defaultSettings.threshold),
        prefixPadding: await window.electron.config.get('settings.prefixPadding', defaultSettings.prefixPadding),
        silenceDuration: await window.electron.config.get('settings.silenceDuration', defaultSettings.silenceDuration),
        semanticEagerness: await window.electron.config.get('settings.semanticEagerness', defaultSettings.semanticEagerness),
        model: await window.electron.config.get('settings.model', defaultSettings.model),
        temperature: await window.electron.config.get('settings.temperature', defaultSettings.temperature),
        maxTokens: await window.electron.config.get('settings.maxTokens', defaultSettings.maxTokens),
        transcriptModel: await window.electron.config.get('settings.transcriptModel', defaultSettings.transcriptModel),
        noiseReduction: await window.electron.config.get('settings.noiseReduction', defaultSettings.noiseReduction),
        voice: await window.electron.config.get('settings.voice', defaultSettings.voice),
        systemInstructions: await window.electron.config.get('settings.systemInstructions', defaultSettings.systemInstructions),
        openAIApiKey: await window.electron.config.get('settings.openAIApiKey', defaultSettings.openAIApiKey),
      };
      setSettings(loaded as Settings);
      
      // Perform basic validation after loading settings
      const apiKey = loaded.openAIApiKey;
      setIsApiKeyValid(Boolean(apiKey && apiKey.trim() !== ''));
      
      // Optionally perform full validation in the background
      // validateApiKey(loaded.openAIApiKey).catch(console.error);
    } catch (error) {
      // Optionally handle error
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Update settings in context and persist to config.toml
  const updateSettings = (newSettings: Partial<Settings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      Object.entries(newSettings).forEach(([key, value]) => {
        window.electron.config.set(`settings.${key}`, value);
      });
      
      // If API key is updated, validate it
      if (newSettings.openAIApiKey !== undefined) {
        validateApiKey(newSettings.openAIApiKey);
      }
      
      return updated;
    });
  };

  const reloadSettings = async () => {
    await loadSettings();
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, reloadSettings, isApiKeyValid, validateApiKey }}>
      {children}
    </SettingsContext.Provider>
  );
};
