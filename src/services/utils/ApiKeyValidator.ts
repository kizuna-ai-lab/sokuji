import { ApiKeyValidationResult } from '../interfaces/ISettingsService';
import i18n from '../../locales';

/**
 * OpenAI model information interface
 */
export interface OpenAIModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

/**
 * Filtered model information for UI display
 */
export interface FilteredModel {
  id: string;
  displayName: string;
  type: 'realtime' | 'audio';
  created: number;
}

/**
 * Utility class for validating OpenAI API keys and fetching available models
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

      console.info("[Sokuji] [ApiKeyValidator] Response:", response);
      
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

  /**
   * Fetch available models from OpenAI API
   * @param apiKey The API key to use for authentication
   * @returns Promise<OpenAIModel[]> Array of available models
   */
  static async fetchAvailableModels(apiKey: string): Promise<OpenAIModel[]> {
    try {
      if (!apiKey || apiKey.trim() === '') {
        throw new Error('API key is required');
      }

      const response = await fetch(this.OPENAI_MODELS_ENDPOINT, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || 'Failed to fetch models');
      }

      const data = await response.json();
      return data.data || [];
    } catch (error: any) {
      console.error("[Sokuji] [ApiKeyValidator] Error fetching models:", error);
      throw error;
    }
  }

  /**
   * Filter models to get only realtime and audio models
   * @param models Array of all available models
   * @returns FilteredModel[] Array of filtered models suitable for the application
   */
  static filterRelevantModels(models: OpenAIModel[]): FilteredModel[] {
    const relevantModels: FilteredModel[] = [];

    models.forEach(model => {
      const modelName = model.id.toLowerCase();
      
      // Check for realtime models (both 4o and mini variants)
      if (modelName.includes('realtime') && (modelName.includes('4o') || modelName.includes('gpt-4'))) {
        relevantModels.push({
          id: model.id,
          displayName: model.id,
          type: 'realtime',
          created: model.created
        });
      }
      // Check for audio models (both 4o and mini variants)
      else if (modelName.includes('audio') && (modelName.includes('4o') || modelName.includes('gpt-4'))) {
        relevantModels.push({
          id: model.id,
          displayName: model.id,
          type: 'audio',
          created: model.created
        });
      }
    });

    // Sort by creation date (newest first) and then by name
    return relevantModels.sort((a, b) => {
      if (b.created !== a.created) {
        return b.created - a.created;
      }
      return a.id.localeCompare(b.id);
    });
  }

  /**
   * Get the latest realtime model from the filtered models
   * @param filteredModels Array of filtered models
   * @returns string The ID of the latest realtime model, or default fallback
   */
  static getLatestRealtimeModel(filteredModels: FilteredModel[]): string {
    const realtimeModels = filteredModels.filter(model => model.type === 'realtime');
    
    if (realtimeModels.length > 0) {
      // Return the first one (newest due to sorting)
      return realtimeModels[0].id;
    }
    
    // Fallback to default if no realtime models found
    return 'gpt-4o-mini-realtime-preview';
  }
} 