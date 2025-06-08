import { ISettingsService, SettingsOperationResult, ApiKeyValidationResult } from '../interfaces/ISettingsService';
import i18n from '../../locales';

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
      console.error(`[Sokuji] [ElectronSettings] Error getting setting ${key}:`, error);
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
        message: i18n.t('settings.settingSavedSuccessfully', { key })
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || i18n.t('settings.failedToSaveSetting', { key })
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
      console.error('[Sokuji] [ElectronSettings] Error loading all settings:', error);
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
        message: i18n.t('settings.settingsSavedSuccessfully')
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || i18n.t('settings.failedToSaveSettings')
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
      console.error('[Sokuji] [ElectronSettings] Error getting settings path:', error);
      return { configDir: '', configFile: '' };
    }
  }
  
  /**
   * Validate an OpenAI API key by making a direct API call
   */
  async validateApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
    try {
      if (!apiKey || apiKey.trim() === '') {
        return {
          valid: false,
          message: i18n.t('settings.errorValidatingApiKey'),
          validating: false
        };
      }
      
      // Make request to OpenAI API models endpoint
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Parse the response
      const data = await response.json();
      
      if (!response.ok) {
        return {
          valid: false,
          message: data.error?.message || i18n.t('settings.errorValidatingApiKey'),
          validating: false
        };
      }
      
      // Check if the models we need are available
      const availableModels = data.data || [];
      
      // Filter realtime models that contain both "realtime" and "4o"
      const realtimeModels = availableModels.filter((model: any) => {
        const modelName = model.id.toLowerCase();
        return modelName.includes('realtime') && modelName.includes('4o');
      });
      
      const hasRealtimeModel = realtimeModels.length > 0;

      console.info("[Sokuji] [ElectronSettings] Available models:", availableModels);
      console.info("[Sokuji] [ElectronSettings] Has realtime model:", hasRealtimeModel);
      
      // If no realtime models are available, consider the validation as failed
      if (!hasRealtimeModel) {
        return {
          valid: false,
          message: i18n.t('settings.realtimeModelNotAvailable'),
          validating: false,
          hasRealtimeModel: hasRealtimeModel
        };
      }
      
      let message = i18n.t('settings.apiKeyValidationCompleted');
      message += ' ' + i18n.t('settings.realtimeModelAvailable');
      
      return {
        valid: true,
        message: message,
        validating: false,
        hasRealtimeModel: hasRealtimeModel
      };
    } catch (error: any) {
      console.error("[Sokuji] [ElectronSettings] API key validation error:", error);
      return {
        valid: false,
        message: error.message || i18n.t('settings.errorValidatingApiKey'),
        validating: false
      };
    }
  }
}
