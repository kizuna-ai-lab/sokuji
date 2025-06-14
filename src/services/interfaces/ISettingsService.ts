import { FilteredModel } from './IClient';

// Settings service interface definition
export interface SettingsOperationResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface ApiKeyValidationResult {
  valid: boolean | null;
  message: string;
  validating?: boolean;
  hasRealtimeModel?: boolean;
}

export interface ISettingsService {
  /**
   * Load a specific setting by key
   * @param key The setting key to retrieve
   * @param defaultValue Default value if the setting doesn't exist
   */
  getSetting<T>(key: string, defaultValue: T): Promise<T>;
  
  /**
   * Save a specific setting by key
   * @param key The setting key to save
   * @param value The value to save
   */
  setSetting<T>(key: string, value: T): Promise<SettingsOperationResult>;
  
  /**
   * Load all settings at once
   * @param defaultSettings Default settings object to use for missing values
   */
  loadAllSettings<T extends object>(defaultSettings: T): Promise<T>;
  
  /**
   * Save all settings at once
   * @param settings The complete settings object to save
   */
  saveAllSettings<T extends object>(settings: T): Promise<SettingsOperationResult>;
  
  /**
   * Get the path to the settings file (if applicable to the platform)
   */
  getSettingsPath(): Promise<{ configDir: string; configFile: string }>;
  
  /**
   * Validate an API key for the specified provider
   * @param apiKey The API key to validate
   * @param provider The service provider to validate against ('openai' | 'gemini')
   */
  validateApiKey(apiKey: string, provider: 'openai' | 'gemini'): Promise<ApiKeyValidationResult>;

  /**
   * Get available models from the specified provider's API
   * @param apiKey The API key to use for authentication
   * @param provider The service provider to fetch models from ('openai' | 'gemini')
   */
  getAvailableModels(apiKey: string, provider: 'openai' | 'gemini'): Promise<FilteredModel[]>;
}
