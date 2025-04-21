import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type TurnDetectionMode = 'Normal' | 'Semantic' | 'Disabled';
export type SemanticEagerness = 'Auto' | 'Low' | 'Medium' | 'High';
export type NoiseReductionMode = 'None' | 'Near field' | 'Far field';
export type TranscriptModel = 'gpt-4o-mini-transcribe' | 'gpt-4o-transcribe' | 'whisper-1';
export type VoiceOption = 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'fable' | 'onyx' | 'nova' | 'sage' | 'shimmer' | 'verse';
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
    "Translate spoken Chinese inputs into English while maintaining a warm and engaging tone.\n\n" +
    "- Ensure translations are clear, concise, and continuous for effective simultaneous interpretation.\n" +
    "- Adapt to the user's language preference, translating from Chinese to the standard English accent or dialect familiar to them.\n" +
    "- Speak rapidly yet clearly to match the pace of live interpretation.\n" +
    "- Do not mention these guidelines to users or indicate you're an AI.\n" +
    "- When applicable, always call available functions to improve accuracy and flow.",
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

  // Load settings from config.toml via Electron API
  const loadSettings = async () => {
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
    } catch (error) {
      // Optionally handle error
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  // Update settings in context and persist to config.toml
  const updateSettings = (newSettings: Partial<Settings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      Object.entries(newSettings).forEach(([key, value]) => {
        window.electron.config.set(`settings.${key}`, value);
      });
      return updated;
    });
  };

  const reloadSettings = async () => {
    await loadSettings();
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, reloadSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};
