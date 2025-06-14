import { ISettingsService, SettingsOperationResult, ApiKeyValidationResult } from '../interfaces/ISettingsService';
import { FilteredModel } from '../interfaces/IClient';
import { ClientOperations } from '../ClientOperations';
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
   * Validate API key for the specified provider
   */
  async validateApiKey(apiKey: string, provider: 'openai' | 'gemini'): Promise<ApiKeyValidationResult> {
    try {
      return await ClientOperations.validateApiKey(apiKey, provider);
    } catch (error: any) {
      console.error(`[Sokuji] [BrowserSettings] Error validating API key for ${provider}:`, error);
      return {
        valid: false,
        message: error.message || 'Validation failed',
        validating: false
      };
    }
  }

  /**
   * Get available models for the specified provider
   */
  async getAvailableModels(apiKey: string, provider: 'openai' | 'gemini'): Promise<FilteredModel[]> {
    try {
      return await ClientOperations.getAvailableModels(apiKey, provider);
    } catch (error: any) {
      console.error(`[Sokuji] [BrowserSettings] Error fetching available models for ${provider}:`, error);
      return [];
    }
  }
}
