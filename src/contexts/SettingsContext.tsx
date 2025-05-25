import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ServiceFactory } from '../services/ServiceFactory';

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
  maxTokens: number | 'inf';
  transcriptModel: TranscriptModel;
  noiseReduction: NoiseReductionMode;
  voice: VoiceOption;
  useTemplateMode: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  systemInstructions: string;
  templateSystemInstructions: string;
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
  getProcessedSystemInstructions: () => string;
}

export const defaultSettings: Settings = {
  turnDetectionMode: 'Semantic',
  threshold: 0.49,
  prefixPadding: 0.5,
  silenceDuration: 0.5,
  semanticEagerness: 'Auto',
  model: 'gpt-4o-mini-realtime-preview',
  temperature: 0.6,
  maxTokens: 4096,
  transcriptModel: 'gpt-4o-mini-transcribe',
  noiseReduction: 'None',
  voice: 'alloy',
  useTemplateMode: true,
  sourceLanguage: 'English',
  targetLanguage: 'French',
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
    "You are a professional real-time simultaneous interpreter translating from {{SOURCE_LANGUAGE}} to {{TARGET_LANGUAGE}}. Upon receiving each new speech segment (typically one or two short sentences), begin outputting the translated text immediately, adhering to these rules:\n" +
    "1. **Timeliness**: Start output within 200 ms of end-of-input.  \n" +
    "2. **Accuracy**: Convey every detail faithfully—no omissions, no additions—and preserve original punctuation.  \n" +
    "3. **Fluency**: Produce natural, coherent speech reflecting appropriate pauses and pace.  \n" +
    "4. **Sentence-type preservation**: Maintain the original sentence form—if the input is a question, output it as a question in the target language, with proper interrogative structure and a question mark.  \n" +
    "5. **CRITICAL - Translation ONLY**: You must ONLY translate the content, NEVER answer questions or engage in conversation. If the user asks 'What day is it?' in {{SOURCE_LANGUAGE}}, you must translate it to '{{TARGET_LANGUAGE}}' equivalent of 'What day is it?' and NOT provide an actual answer about the day.  \n" +
    "6. **Non-engagement**: Do **not** answer, explain, or comment on the content—translate only.  \n" +
    "7. **Formatting**: Output **only** the translated text—no tags, notes, or commentary.  \n" +
    "8. **Tone**: Match the speaker's register (formal vs. casual) without over-polishing.",
  openAIApiKey: '',
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
  
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [isApiKeyValid, setIsApiKeyValid] = useState(false);
  
  // Process system instructions based on the selected mode
  const getProcessedSystemInstructions = useCallback(() => {
    if (settings.useTemplateMode) {
      return settings.templateSystemInstructions
        .replace(/\{\{SOURCE_LANGUAGE\}\}/g, settings.sourceLanguage || 'SOURCE_LANGUAGE')
        .replace(/\{\{TARGET_LANGUAGE\}\}/g, settings.targetLanguage || 'TARGET_LANGUAGE');
    } else {
      return settings.systemInstructions;
    }
  }, [settings.useTemplateMode, settings.templateSystemInstructions, settings.sourceLanguage, settings.targetLanguage, settings.systemInstructions]);

  // Validate the API key
  const validateApiKey = useCallback(async (apiKey?: string) => {
    try {
      const keyToValidate = apiKey !== undefined ? apiKey : settings.openAIApiKey;
      
      if (!keyToValidate || keyToValidate.trim() === '') {
        return {
          valid: false,
          message: 'API key cannot be empty',
          validating: false
        };
      }
      
      // Use our settings service to validate the API key
      const result = await settingsService.validateApiKey(keyToValidate);
      
      // Update the valid state if we're validating the current API key
      if (apiKey === undefined || apiKey === settings.openAIApiKey) {
        setIsApiKeyValid(Boolean(result.valid));
      }
      
      return result;
    } catch (error) {
      console.error('Error validating API key:', error);
      return {
        valid: false,
        message: error instanceof Error ? error.message : 'Error validating API key',
        validating: false
      };
    }
  }, [settings.openAIApiKey, settingsService]);

  // Load settings using our settings service
  const loadSettings = useCallback(async () => {
    try {
      // Use the settings service to load all settings at once
      const loaded = await settingsService.loadAllSettings(defaultSettings);
      setSettings(loaded);
      
      // Perform basic validation after loading settings
      const apiKey = loaded.openAIApiKey;
      setIsApiKeyValid(Boolean(apiKey && apiKey.trim() !== ''));
      
      // Optionally perform full validation in the background
      if (apiKey && apiKey.trim() !== '') {
        validateApiKey(apiKey).catch(console.error);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }, [settingsService, validateApiKey]);

  // Save settings using our settings service
  const updateSettings = useCallback((newSettings: Partial<Settings>) => {
    setSettings(prev => {
      const updatedSettings = { ...prev, ...newSettings };
      
      // Save each updated setting using the settings service
      for (const key of Object.keys(newSettings)) {
        const fullKey = `settings.${key}`;
        const value = (newSettings as any)[key];
        settingsService.setSetting(fullKey, value)
          .catch(error => console.error(`Error saving setting ${key}:`, error));
      }
      
      return updatedSettings;
    });
  }, [settingsService]);

  // Initialize settings on component mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings,
        reloadSettings: loadSettings,
        isApiKeyValid,
        validateApiKey,
        getProcessedSystemInstructions
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};
