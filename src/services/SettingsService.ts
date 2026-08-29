import { ISettingsService, SettingsOperationResult, ApiKeyValidationResult } from './interfaces/ISettingsService';
import { FilteredModel } from './interfaces/IClient';
import { ClientOperations } from './ClientOperations';
import { ProviderType } from '../types/Provider';
import i18n from '../locales';
import { reportError, reportWarning, describeCause } from '../lib/diagnostics/report';

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
        // Browser Extension: Use Chrome Storage API.
        //
        // `return await` for the same reason as setSetting below: a bare return
        // adopts the promise's rejection without passing through the catch, so a
        // synchronous throw in the executor would skip both the defaultValue
        // fallback and the report, and surface as an unhandled rejection in a
        // caller that reasonably assumed a getter with a default cannot fail.
        return await new Promise<T>((resolve) => {
          // @ts-ignore - Chrome API is defined in global scope for extensions
          chrome.storage.sync.get(key, (result: Record<string, any>) => {
            // @ts-ignore - Chrome API is defined in global scope for extensions
            if (chrome.runtime.lastError) {
              // @ts-ignore - Chrome API is defined in global scope for extensions
              // One key shares the dedupe key with the rest: a storage backend
              // that is down fails for every key in the boot burst at once.
              reportWarning('SettingsService', `Could not read ${key}: ${chrome.runtime.lastError?.message ?? 'unknown error'}`, { dedupeKey: 'settings.get' });
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
          // setSetting stores strings as raw localStorage values. Return them
          // before JSON parsing so opaque values such as API keys "123456",
          // "true", or "null" do not change type across an app restart.
          if (typeof defaultValue === 'string') {
            return value as unknown as T;
          }
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
      reportWarning('SettingsService', `Could not read ${key}: ${describeCause(error)}`, { cause: error, dedupeKey: 'settings.get' });
      return defaultValue;
    }
  }
  
  /**
   * Save a specific setting by key
   */
  async setSetting<T>(key: string, value: T): Promise<SettingsOperationResult> {
    try {
      if (this.usesChromeStorage) {
        // Browser Extension: Use Chrome Storage API.
        //
        // `return await`, not a bare `return`: returning the promise from
        // inside `try` adopts its rejection WITHOUT passing through the catch
        // below, so a synchronous throw in the executor — `chrome.storage`
        // gone after "Extension context invalidated" — used to reject past a
        // signature that promises a result. Callers may not read
        // `result.success` AND catch; the contract has to be one of the two.
        return await new Promise<SettingsOperationResult>((resolve) => {
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
    clientSecret?: string,
    customEndpoint?: string
  ): Promise<{
    validation: ApiKeyValidationResult;
    models: FilteredModel[];
  }> {
    try {
      return await ClientOperations.validateApiKeyAndFetchModels(
        apiKey,
        provider,
        clientSecret,
        customEndpoint
      );
    } catch (error: any) {
      reportError('SettingsService', `Failed to validate the API key for ${provider}: ${describeCause(error)}`, { cause: error });
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
