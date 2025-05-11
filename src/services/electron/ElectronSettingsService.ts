import { ISettingsService, SettingsOperationResult, ApiKeyValidationResult } from '../interfaces/ISettingsService';

/**
 * Electron implementation of the Settings Service
 * Uses Electron IPC to communicate with the main process for settings operations
 */
export class ElectronSettingsService implements ISettingsService {
  /**
   * Load a specific setting by key using Electron's config API
   */
  async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    try {
      return await (window as any).electron.config.get(key, defaultValue);
    } catch (error) {
      console.error(`Error getting setting ${key}:`, error);
      return defaultValue;
    }
  }
  
  /**
   * Save a specific setting by key using Electron's config API
   */
  async setSetting<T>(key: string, value: T): Promise<SettingsOperationResult> {
    try {
      await (window as any).electron.config.set(key, value);
      return {
        success: true,
        message: `Successfully saved setting: ${key}`
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || `Failed to save setting: ${key}`
      };
    }
  }
  
  /**
   * Load all settings at once from Electron's config system
   */
  async loadAllSettings<T extends object>(defaultSettings: T): Promise<T> {
    try {
      const settings = { ...defaultSettings };
      
      // Load each setting individually
      for (const key of Object.keys(defaultSettings)) {
        const fullKey = `settings.${key}`;
        const defaultValue = (defaultSettings as any)[key];
        (settings as any)[key] = await this.getSetting(fullKey, defaultValue);
      }
      
      return settings;
    } catch (error) {
      console.error('Error loading all settings:', error);
      return defaultSettings;
    }
  }
  
  /**
   * Save all settings at once to Electron's config system
   */
  async saveAllSettings<T extends object>(settings: T): Promise<SettingsOperationResult> {
    try {
      // Save each setting individually
      for (const key of Object.keys(settings)) {
        const fullKey = `settings.${key}`;
        const value = (settings as any)[key];
        await this.setSetting(fullKey, value);
      }
      
      return {
        success: true,
        message: 'Successfully saved all settings'
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to save all settings'
      };
    }
  }
  
  /**
   * Get the path to the settings file in Electron
   */
  async getSettingsPath(): Promise<{ configDir: string; configFile: string }> {
    try {
      return await (window as any).electron.config.getPath();
    } catch (error) {
      console.error('Error getting settings path:', error);
      return { configDir: '', configFile: '' };
    }
  }
  
  /**
   * Validate an OpenAI API key using Electron's API
   */
  async validateApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
    try {
      const result = await (window as any).electron.openai.validateApiKey(apiKey);
      
      return {
        valid: result.valid,
        message: result.message || 'API key validation completed',
        validating: false
      };
    } catch (error: any) {
      return {
        valid: false,
        message: error.message || 'Error validating API key',
        validating: false
      };
    }
  }
}
