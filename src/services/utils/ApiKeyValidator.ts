import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import i18n from '../../locales';

/**
 * Utility class for validating OpenAI API keys
 * Contains shared logic for both Electron and Browser implementations
 */
export class ApiKeyValidator {
  private static readonly OPENAI_MODELS_ENDPOINT = 'https://api.openai.com/v1/models';
  
  /**
   * Validate an OpenAI API key by making a request to the models endpoint
   * @param apiKey The API key to validate
   * @returns Promise<ApiKeyValidationResult> Validation result with status and message
   */
  static async validateApiKey(apiKey: string): Promise<ApiKeyValidationResult> {
    try {
      // Check if API key is empty or invalid
      if (!apiKey || apiKey.trim() === '') {
        return {
          valid: false,
          message: i18n.t('settings.errorValidatingApiKey'),
          validating: false
        };
      }
      
      // Make request to OpenAI API models endpoint
      const response = await fetch(this.OPENAI_MODELS_ENDPOINT, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Handle non-200 responses
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          valid: false,
          message: errorData.error?.message || i18n.t('settings.errorValidatingApiKey'),
          validating: false
        };
      }
      
      // Parse successful response
      const data = await response.json();
      const availableModels = data.data || [];
      
      // Check for realtime models availability
      const hasRealtimeModel = this.checkRealtimeModelAvailability(availableModels);
      
      console.info("[Sokuji] [ApiKeyValidator] Available models:", availableModels);
      console.info("[Sokuji] [ApiKeyValidator] Has realtime model:", hasRealtimeModel);
      
      // Return validation result based on realtime model availability
      return this.buildValidationResult(hasRealtimeModel);
      
    } catch (error: any) {
      console.error("[Sokuji] [ApiKeyValidator] API key validation error:", error);
      return {
        valid: false,
        message: error.message || i18n.t('settings.errorValidatingApiKey'),
        validating: false
      };
    }
  }
  
  /**
   * Check if realtime models are available in the models list
   * @param models Array of available models
   * @returns boolean True if realtime models are available
   */
  private static checkRealtimeModelAvailability(models: any[]): boolean {
    return models.some((model: any) => {
      const modelName = model.id?.toLowerCase() || '';
      return modelName.includes('realtime') && modelName.includes('4o');
    });
  }
  
  /**
   * Build validation result based on realtime model availability
   * @param hasRealtimeModel Whether realtime models are available
   * @returns ApiKeyValidationResult Formatted validation result
   */
  private static buildValidationResult(hasRealtimeModel: boolean): ApiKeyValidationResult {
    if (!hasRealtimeModel) {
      return {
        valid: false,
        message: i18n.t('settings.realtimeModelNotAvailable'),
        validating: false,
        hasRealtimeModel: false
      };
    }
    
    const message = i18n.t('settings.apiKeyValidationCompleted') + ' ' + i18n.t('settings.realtimeModelAvailable');
    
    return {
      valid: true,
      message: message,
      validating: false,
      hasRealtimeModel: true
    };
  }
} 