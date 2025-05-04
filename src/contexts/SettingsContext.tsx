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
    'Your job is to interpret what the user says from one language into another language, without changing any meaning.\n' +
    "Keep your responses concise, and avoid adding your own opinions, advice, evaluation or commentary.\n" +
    "If the source language is English, translate to Japanese. If the source language is Japanese, translate to English.\n" +
    "Adapt to the speaker's tone as much as possible, while maintaining the original meaning.\n" +
    "When translating proper names between English/Japanese, try to use equivalent characters that sound similar instead of literal translations, unless the name already has a standardized translation.\n" +
    "If the source language is neither English nor Japanese, translate to English.",
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
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};
