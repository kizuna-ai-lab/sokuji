import { FilteredModel } from './IClient';
import { ProviderType } from '../../types/Provider';

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
   * Validate API key and fetch available models in a single request
   * @param apiKey The API key to validate and use for fetching models
   * @param provider The service provider to validate against
   * @param clientSecret The client secret for PalabraAI (optional)
   */
  validateApiKeyAndFetchModels(
    apiKey: string, 
    provider: ProviderType,
    clientSecret?: string
  ): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }>;
}
