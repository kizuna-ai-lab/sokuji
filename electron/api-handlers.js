const fetch = require('node-fetch');
const { getConfig } = require('./config-utils');

/**
 * Generate a token for OpenAI Realtime API
 * @param {Object} options - Options for token generation
 * @param {string} options.model - The model to use
 * @param {string} options.voice - The voice to use
 * @param {string} options.systemInstructions - The system instructions
 * @param {number} options.temperature - The temperature
 * @param {string} options.maxTokens - The maximum response output tokens
 * @param {string} options.turnDetectionMode - The turn detection mode
 * @param {number} options.threshold - The threshold
 * @param {number} options.prefixPadding - The prefix padding
 * @param {number} options.silenceDuration - The silence duration
 * @param {string} options.semanticEagerness - The semantic eagerness
 * @param {string} options.noiseReduction - The noise reduction
 * @param {string} options.transcriptModel - The transcript model
 * @returns {Promise<Object>} The token response
 */
async function generateToken(options = {}) {
  try {
    // Get API key from config
    const apiKey = await getConfig('settings.openAIApiKey', '');
    
    if (!apiKey) {
      throw new Error('OpenAI API key not found in configuration');
    }

    // Set default options
    const model = options.model || 'gpt-4o-mini-realtime-preview';
    const voice = options.voice || 'alloy';
    const instructions = options.systemInstructions || '';
    const temperature = options.temperature ?? 0.8;
    const max_response_output_tokens = options.maxTokens ?? 'inf';

    // Map turn detection
    let turn_detection = null;
    if (options.turnDetectionMode === 'Disabled') {
      turn_detection = null;
    } else if (options.turnDetectionMode === 'Normal') {
      turn_detection = {
        create_response: true,
        type: 'server_vad',
        interrupt_response: false,
        prefix_padding_ms: options.prefixPadding !== undefined ? Math.round(options.prefixPadding * 1000) : undefined,
        silence_duration_ms: options.silenceDuration !== undefined ? Math.round(options.silenceDuration * 1000) : undefined,
        threshold: options.threshold
      };
    } else if (options.turnDetectionMode === 'Semantic' && options.turnDetectionMode !== 'Disabled') {
      turn_detection = {
        create_response: true,
        type: 'semantic_vad',
        interrupt_response: false,
        eagerness: options.semanticEagerness?.toLowerCase(),
      };
      // Remove undefined fields
      Object.keys(turn_detection).forEach(key => turn_detection[key] === undefined && delete turn_detection[key]);
    }

    // Map noise reduction
    let input_audio_noise_reduction = null;
    if (options.noiseReduction && options.noiseReduction !== 'None') {
      input_audio_noise_reduction = {
        type: options.noiseReduction === 'Near field' ? 'near_field' : options.noiseReduction === 'Far field' ? 'far_field' : undefined
      };
      if (!input_audio_noise_reduction.type) input_audio_noise_reduction = null;
    }

    // Map transcription
    let input_audio_transcription = null;
    if (options.transcriptModel) {
      input_audio_transcription = {
        model: options.transcriptModel
      };
    }

    // Build request body
    const body = {
      model,
      voice,
      instructions,
      temperature,
      max_response_output_tokens,
      ...(turn_detection ? { turn_detection } : {}),
      ...(input_audio_noise_reduction ? { input_audio_noise_reduction } : {}),
      ...(input_audio_transcription ? { input_audio_transcription } : {}),
    };

    // Make request to OpenAI API
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    // Parse and return the response
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'Failed to generate token');
    }
    
    return data;
  } catch (error) {
    console.error("Token generation error:", error);
    throw error;
  }
}

/**
 * Validate an OpenAI API key by checking if it can access the models endpoint
 * @param {string} apiKey - The API key to validate
 * @returns {Promise<Object>} Validation result with available models if successful
 */
async function validateApiKey(apiKey) {
  if (!apiKey || apiKey.trim() === '') {
    return { 
      valid: false, 
      error: 'API key is empty' 
    };
  }

  try {
    // Make request to OpenAI API models endpoint
    const response = await fetch(
      "https://api.openai.com/v1/models",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        }
      }
    );

    // Parse the response
    const data = await response.json();
    
    if (!response.ok) {
      return { 
        valid: false, 
        error: data.error?.message || 'Failed to validate API key' 
      };
    }
    
    // Check if the models we need are available
    const availableModels = data.data || [];
    const realtimeModels = availableModels.filter(model => 
      model.id.includes('realtime') || 
      model.id.includes('gpt-4o')
    );
    
    return { 
      valid: true, 
      models: realtimeModels,
      allModels: availableModels
    };
  } catch (error) {
    console.error("API key validation error:", error);
    return { 
      valid: false, 
      error: error.message || 'Network error during validation'
    };
  }
}

module.exports = {
  generateToken,
  validateApiKey
};
