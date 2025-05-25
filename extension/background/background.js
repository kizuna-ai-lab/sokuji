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

// Track active tabs with side panel
const activePanelTabs = new Set();

// Initialize configuration in storage if not already set
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const result = await chrome.storage.local.get('config');
    if (!result.config) {
      await chrome.storage.local.set({ config: DEFAULT_CONFIG });
      console.info('Default configuration initialized');
    }
    
    // Set up the side panel configuration
    if (chrome.sidePanel) {
      await chrome.sidePanel.setOptions({
        path: 'fullpage.html',
        enabled: false // Default to disabled
      });
      
      // Disable side panel for all existing tabs
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          await chrome.sidePanel.setOptions({
            tabId: tab.id,
            enabled: false
          });
        }
      }
      console.info('Disabled side panel for all existing tabs');
    }
  } catch (error) {
    console.error('Error initializing configuration:', error);
  }
});

// Listen for tab updates to manage side panel visibility
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  if (chrome.sidePanel) {
    const tabId = activeInfo.tabId;
    // If this tab should have the panel open
    if (activePanelTabs.has(tabId)) {
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        enabled: true,
        path: 'fullpage.html?debug=true'
      });
    } else {
      // Disable the panel for tabs that shouldn't have it
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        enabled: false
      });
    }
  }
});

// Listen for extension icon click event
chrome.action.onClicked.addListener((tab) => {
  console.debug('Extension icon clicked', tab.id);
  // Check if the side panel API is available
  if (chrome.sidePanel) {
    const tabId = tab.id;
    
    if (activePanelTabs.has(tabId)) {
      // If panel is already active for this tab, close it
      activePanelTabs.delete(tabId);
      // Simply disable the panel
      chrome.sidePanel.setOptions({
        tabId: tabId,
        enabled: false
      });
      console.info('Closing Sokuji side panel for tab', tabId);
    } else {
      // First enable the panel for this specific tab
      chrome.sidePanel.setOptions({
        tabId: tabId,
        enabled: true,
        path: `fullpage.html?tabId=${tabId}&debug=true`
      });
      
      // Add to active panels list
      activePanelTabs.add(tabId);
      
      // Then open the panel (must be in direct response to user gesture)
      chrome.sidePanel.open({ tabId: tabId });
      console.info('Opening Sokuji in side panel for tab', tabId);
    }
  } else {
    // Fallback for browsers without side panel support
    chrome.tabs.create({ url: 'fullpage.html?debug=true' });
    console.warn('Side panel API not available, opening in new tab');
  }
});

// Handle tab close events to clean up our tracking
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activePanelTabs.has(tabId)) {
    activePanelTabs.delete(tabId);
    console.debug('Tab closed, removing from active panels:', tabId);
  }
});

// Handle new tab creation to ensure side panel is disabled by default
chrome.tabs.onCreated.addListener(async (tab) => {
  if (chrome.sidePanel && tab.id) {
    // Disable side panel for newly created tabs
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      enabled: false
    });
    console.debug('New tab created, side panel disabled by default:', tab.id);
  }
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


