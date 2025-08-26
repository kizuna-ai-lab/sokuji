import { ISettingsService, SettingsOperationResult, ApiKeyValidationResult } from './interfaces/ISettingsService';
import { FilteredModel } from './interfaces/IClient';
import { ClientOperations } from './ClientOperations';
import { ProviderType } from '../types/Provider';
import i18n from '../locales';

/**
 * Unified Settings Service implementation
 * Uses Chrome Storage API for browser extensions and localStorage for Electron
 */
export class SettingsService implements ISettingsService {
  private readonly usesChromeStorage: boolean;
  
  constructor() {
    // Check if Chrome Storage API is available (browser extension environment)
    this.usesChromeStorage = typeof chrome !== 'undefined' && 
                             chrome?.storage?.sync !== undefined;
    
    console.info(`[Sokuji] [SettingsService] Using ${this.usesChromeStorage ? 'Chrome Storage' : 'localStorage'} for settings persistence`);
  }
  
  /**
   * Load a specific setting by key
   */
  async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    try {
      if (this.usesChromeStorage) {
        // Browser Extension: Use Chrome Storage API
        return new Promise<T>((resolve) => {
          // @ts-ignore - Chrome API is defined in global scope for extensions
          chrome.storage.sync.get(key, (result: Record<string, any>) => {
            // @ts-ignore - Chrome API is defined in global scope for extensions
            if (chrome.runtime.lastError) {
              // @ts-ignore - Chrome API is defined in global scope for extensions
              console.error(`[Sokuji] [SettingsService] Error getting setting ${key}:`, chrome.runtime.lastError);
              resolve(defaultValue);
            } else {
              resolve(result[key] !== undefined ? result[key] : defaultValue);
            }
          });
        });
      } else {
        // Electron: Use localStorage
        const value = localStorage.getItem(key);
        if (value !== null) {
          try {
            return JSON.parse(value);
          } catch {
            // If parsing fails, return the raw string value
            return value as unknown as T;
          }
        }
        return defaultValue;
      }
    } catch (error) {
      console.error(`[Sokuji] [SettingsService] Error getting setting ${key}:`, error);
      return defaultValue;
    }
  }
  
  /**
   * Save a specific setting by key
   */
  async setSetting<T>(key: string, value: T): Promise<SettingsOperationResult> {
    try {
      if (this.usesChromeStorage) {
        // Browser Extension: Use Chrome Storage API
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
      } else {
        // Electron: Use localStorage
        const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        localStorage.setItem(key, stringValue);
        return {
          success: true,
          message: i18n.t('settings.settingSavedSuccessfully', { key })
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || i18n.t('settings.failedToSaveSetting', { key })
      };
    }
  }
  
  /**
   * Load all settings at once
   */
  async loadAllSettings<T extends object>(defaultSettings: T): Promise<T> {
    try {
      if (this.usesChromeStorage) {
        // Browser Extension: Use Chrome Storage API
        const keys = Object.keys(defaultSettings).map(key => `settings.${key}`);
        
        return new Promise<T>((resolve) => {
          // @ts-ignore - Chrome API is defined in global scope for extensions
          chrome.storage.sync.get(keys, (result: Record<string, any>) => {
            // @ts-ignore - Chrome API is defined in global scope for extensions
            if (chrome.runtime.lastError) {
              // @ts-ignore - Chrome API is defined in global scope for extensions
              console.error('[Sokuji] [SettingsService] Error loading all settings:', chrome.runtime.lastError);
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
      } else {
        // Electron: Use localStorage
        const settings = { ...defaultSettings };
        
        for (const key of Object.keys(defaultSettings)) {
          const fullKey = `settings.${key}`;
          const defaultValue = (defaultSettings as any)[key];
          (settings as any)[key] = await this.getSetting(fullKey, defaultValue);
        }
        
        return settings;
      }
    } catch (error) {
      console.error('[Sokuji] [SettingsService] Error loading all settings:', error);
      return defaultSettings;
    }
  }
  
  /**
   * Save all settings at once
   */
  async saveAllSettings<T extends object>(settings: T): Promise<SettingsOperationResult> {
    try {
      if (this.usesChromeStorage) {
        // Browser Extension: Use Chrome Storage API
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
      } else {
        // Electron: Use localStorage
        for (const key of Object.keys(settings)) {
          const fullKey = `settings.${key}`;
          const value = (settings as any)[key];
          await this.setSetting(fullKey, value);
        }
        
        return {
          success: true,
          message: i18n.t('settings.settingsSavedSuccessfully')
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message || i18n.t('settings.failedToSaveSettings')
      };
    }
  }
  
  /**
   * Get the path to the settings file (if applicable to the platform)
   */
  async getSettingsPath(): Promise<{ configDir: string; configFile: string }> {
    if (this.usesChromeStorage) {
      // Browser extensions don't have access to the file system
      return { configDir: 'chrome-storage', configFile: 'sync-storage' };
    } else {
      // Electron uses localStorage, which is stored in the app's user data directory
      return { configDir: 'localStorage', configFile: 'Local Storage' };
    }
  }
  
  /**
   * Validate API key and fetch available models in a single request
   */
  async validateApiKeyAndFetchModels(
    apiKey: string, 
    provider: ProviderType,
    clientSecret?: string
  ): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    try {
      return await ClientOperations.validateApiKeyAndFetchModels(apiKey, provider, clientSecret);
    } catch (error: any) {
      console.error(`[Sokuji] [SettingsService] Error validating API key and fetching models for ${provider}:`, error);
      return {
        validation: {
          valid: false,
          message: error.message || 'Validation failed',
          validating: false
        },
        models: []
      };
    }
  }
}