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
  /**
   * Resolves a result; does not reject. Callers read `result.success` — or,
   * better, go through `persistSetting`, which owns both that check and the
   * reporting. (`loadAllSettings`/`saveAllSettings` used to sit here too and
   * were removed: no caller ever used either.)
   */
  setSetting<T>(key: string, value: T): Promise<SettingsOperationResult>;
  
  /**
   * Get the path to the settings file (if applicable to the platform)
   */
  getSettingsPath(): Promise<{ configDir: string; configFile: string }>;
  
  /**
   * Validate API key and fetch available models in a single request
   * @param apiKey The API key to validate and use for fetching models
   * @param provider The service provider to validate against
   * @param clientSecret The client secret for PalabraAI (optional)
   * @param customEndpoint The custom API endpoint for OpenAI Compatible provider (optional)
   */
  validateApiKeyAndFetchModels(
    apiKey: string,
    provider: ProviderType,
    clientSecret?: string,
    customEndpoint?: string
  ): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }>;
}
