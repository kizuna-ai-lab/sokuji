const fetch = require('node-fetch');
const { getConfig } = require('./config-utils');

/**
 * Generate a token for OpenAI Realtime API
 * @param {Object} options - Options for token generation
 * @param {string} options.model - The model to use
 * @param {string} options.voice - The voice to use
 * @returns {Promise<Object>} The token response
 */
async function generateToken(options = {}) {
  try {
    // Get API key from config
    const apiKey = await getConfig('openai.apiKey', '');
    
    if (!apiKey) {
      throw new Error('OpenAI API key not found in configuration');
    }

    // Set default options
    const model = options.model || 'gpt-4o-realtime-preview';
    const voice = options.voice || 'alloy';

    // Make request to OpenAI API
    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          voice,
        }),
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
