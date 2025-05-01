// Background script for Sokuji browser extension
// This script handles configuration storage and API communication

/* global chrome */

// Default configuration values
const DEFAULT_CONFIG = {
  openAIApiKey: '',
  model: 'gpt-4o-mini-realtime-preview',
  voice: 'alloy',
  systemInstructions: '',
  temperature: 0.8,
  maxTokens: 'inf',
  turnDetectionMode: 'Normal',
  silenceDuration: 0.5,
  prefixPadding: 0.1,
  threshold: 0.5,
  semanticEagerness: 'Medium',
  noiseReduction: 'None',
  transcriptModel: 'whisper-1'
};

// Initialize configuration in storage if not already set
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const result = await chrome.storage.local.get('config');
    if (!result.config) {
      await chrome.storage.local.set({ config: DEFAULT_CONFIG });
      console.log('Default configuration initialized');
    }
  } catch (error) {
    console.error('Error initializing configuration:', error);
  }
});

// 监听扩展图标点击事件
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: 'fullpage.html' });
});

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CONFIG') {
    handleGetConfig(message.key, message.defaultValue).then(sendResponse);
    return true; // Indicates async response
  }
  
  if (message.type === 'SET_CONFIG') {
    handleSetConfig(message.key, message.value).then(sendResponse);
    return true; // Indicates async response
  }
  
  if (message.type === 'VALIDATE_API_KEY') {
    validateApiKey(message.apiKey).then(sendResponse);
    return true; // Indicates async response
  }
});

// Get configuration value
async function handleGetConfig(key, defaultValue) {
  try {
    const result = await chrome.storage.local.get('config');
    const config = result.config || DEFAULT_CONFIG;
    
    if (key) {
      return { success: true, value: config[key] !== undefined ? config[key] : defaultValue };
    } else {
      return { success: true, value: config };
    }
  } catch (error) {
    console.error('Error getting config:', error);
    return { success: false, error: error.message, value: defaultValue };
  }
}

// Set configuration value
async function handleSetConfig(key, value) {
  try {
    const result = await chrome.storage.local.get('config');
    const config = result.config || DEFAULT_CONFIG;
    
    // Update the config
    config[key] = value;
    
    // Save back to storage
    await chrome.storage.local.set({ config });
    
    return { success: true };
  } catch (error) {
    console.error('Error setting config:', error);
    return { success: false, error: error.message };
  }
}

// Validate OpenAI API key
async function validateApiKey(apiKey) {
  try {
    // Simple validation - check if the key starts with "sk-" and has sufficient length
    if (!apiKey || !apiKey.startsWith('sk-') || apiKey.length < 20) {
      return { 
        valid: false, 
        error: 'Invalid API key format' 
      };
    }
    
    // Make a request to OpenAI API to validate the key
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      return { 
        success: true,
        valid: true, 
        models: data.data.map(model => model.id) 
      };
    } else {
      const errorData = await response.json();
      return { 
        success: false,
        valid: false, 
        error: errorData.error?.message || 'API key validation failed' 
      };
    }
  } catch (error) {
    console.error('Error validating API key:', error);
    return { 
      success: false,
      valid: false, 
      error: error.message || 'Failed to validate API key' 
    };
  }
}
