import { ISettingsService, SettingsOperationResult, ApiKeyValidationResult, AvailableModel } from '../interfaces/ISettingsService';
import { ApiKeyValidator } from '../utils/ApiKeyValidator';
import i18n from '../../locales';

/**
 * Browser implementation of the Settings Service
 * Uses Chrome Storage API for settings persistence in browser extensions
 */
export class BrowserSettingsService implements ISettingsService {
  /**
   * Load a specific setting by key using Chrome Storage API
   */
  async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    try {
      return new Promise<T>((resolve) => {
        // @ts-ignore - Chrome API is defined in global scope for extensions
        chrome.storage.sync.get(key, (result: Record<string, any>) => {
          // @ts-ignore - Chrome API is defined in global scope for extensions
          if (chrome.runtime.lastError) {
            // @ts-ignore - Chrome API is defined in global scope for extensions
            console.error(`[Sokuji] [BrowserSettings] Error getting setting ${key}:`, chrome.runtime.lastError);
            resolve(defaultValue);
          } else {
            resolve(result[key] !== undefined ? result[key] : defaultValue);
          }
        });
      });
    } catch (error) {
      console.error(`[Sokuji] [BrowserSettings] Error getting setting ${key}:`, error);
      return defaultValue;
    }
  }
  
  /**
   * Save a specific setting by key using Chrome Storage API
   */
  async setSetting<T>(key: string, value: T): Promise<SettingsOperationResult> {
    try {
      return new Promise<SettingsOperationResult>((resolve) => {
        // @ts-ignore - Chrome API is defined in global scope for extensions
        chrome.storage.sync.set({ [key]: value }, () => {
          // @ts-ignore - Chrome API is defined in global scope for extensions
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              // @ts-ignore - Chrome API is defined in global scope for extensions
              error: chrome.runtime.lastError.message || i18n.t('settings.failedToSaveSetting', { key })
            });
          } else {
            resolve({
              success: true,
              message: i18n.t('settings.settingSavedSuccessfully', { key })
            });
          }
        });
      });
    } catch (error: any) {
      return {
        success: false,
        error: error.message || i18n.t('settings.failedToSaveSetting', { key })
      };
    }
  }
  
  /**
   * Load all settings at once from Chrome Storage
   */
  async loadAllSettings<T extends object>(defaultSettings: T): Promise<T> {
    try {
      // Create array of keys with the 'settings.' prefix
      const keys = Object.keys(defaultSettings).map(key => `settings.${key}`);
      
      return new Promise<T>((resolve) => {
        // @ts-ignore - Chrome API is defined in global scope for extensions
        chrome.storage.sync.get(keys, (result: Record<string, any>) => {
          // @ts-ignore - Chrome API is defined in global scope for extensions
          if (chrome.runtime.lastError) {
            // @ts-ignore - Chrome API is defined in global scope for extensions
            console.error('[Sokuji] [BrowserSettings] Error loading all settings:', chrome.runtime.lastError);
            resolve(defaultSettings);
          } else {
            const settings = { ...defaultSettings };
            
            // Map from 'settings.key' back to just 'key' in our result object
            for (const key of Object.keys(defaultSettings)) {
              const fullKey = `settings.${key}`;
              const defaultValue = (defaultSettings as any)[key];
              (settings as any)[key] = result[fullKey] !== undefined ? result[fullKey] : defaultValue;
            }
            
            resolve(settings);
          }
        });
      });
    } catch (error) {
      console.error('[Sokuji] [BrowserSettings] Error loading all settings:', error);
      return defaultSettings;
    }
  }
  
  /**
   * Save all settings at once to Chrome Storage
   */
  async saveAllSettings<T extends object>(settings: T): Promise<SettingsOperationResult> {
    try {
      // Convert to object with 'settings.' prefix on keys
      const storageObject: Record<string, any> = {};
      for (const key of Object.keys(settings)) {
        storageObject[`settings.${key}`] = (settings as any)[key];
      }
      
      return new Promise<SettingsOperationResult>((resolve) => {
        // @ts-ignore - Chrome API is defined in global scope for extensions
        chrome.storage.sync.set(storageObject, () => {
          // @ts-ignore - Chrome API is defined in global scope for extensions
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              // @ts-ignore - Chrome API is defined in global scope for extensions
              error: chrome.runtime.lastError.message || i18n.t('settings.failedToSaveSettings')
            });
          } else {
            resolve({
              success: true,
              message: i18n.t('settings.settingsSavedSuccessfully')
            });
          }
        });
      });
    } catch (error: any) {
      return {
        success: false,
        error: error.message || i18n.t('settings.failedToSaveSettings')
      };
    }
  }
  
  /**
   * Get the path to the settings file (not applicable in browser extensions)
   */
  async getSettingsPath(): Promise<{ configDir: string; configFile: string }> {
    // Browser extensions don't have access to the file system
    return { configDir: 'chrome-storage', configFile: 'sync-storage' };
  }
  
  /**
   * Validate an OpenAI API key by making a direct API call
   */
  async validateApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
    return ApiKeyValidator.validateApiKey(apiKey);
  }

  /**
   * Get available models from OpenAI API
   */
  async getAvailableModels(apiKey: string): Promise<AvailableModel[]> {
    try {
      const models = await ApiKeyValidator.fetchAvailableModels(apiKey);
      return ApiKeyValidator.filterRelevantModels(models);
    } catch (error: any) {
      console.error('[Sokuji] [BrowserSettings] Error fetching available models:', error);
      return [];
    }
  }
}
