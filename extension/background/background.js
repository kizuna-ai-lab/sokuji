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

// Define sites where the side panel should be enabled
// You can modify this array to include any domains you want
const ENABLED_SITES = [
  'meet.google.com',
  'teams.live.com',
  'zoom.us',
  'teams.microsoft.com'
];

// Track which tabs have the side panel open
const tabsWithSidePanelOpen = new Set();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Error setting panel behavior:', error));

// Initialize configuration in storage if not already set
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const result = await chrome.storage.local.get('config');
    if (!result.config) {
      await chrome.storage.local.set({ config: DEFAULT_CONFIG });
      console.debug('Default configuration initialized');
    }
  } catch (error) {
    console.error('Error initializing configuration:', error);
  }
});

// Listen for tab URL updates to manage site-specific side panel visibility
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process when URL changes or when the tab is complete
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  
  try {
    const url = new URL(tab.url);
    
    // Check if the current site is in the enabled sites list
    const isEnabledSite = ENABLED_SITES.some(site => 
      url.hostname === site || url.hostname.endsWith('.' + site));
    
    if (isEnabledSite) {
      // Enable side panel for this site
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        path: `fullpage.html?tabId=${tabId}&debug=true`,
        enabled: true
      });
      tabsWithSidePanelOpen.add(tabId);
      console.debug('Enabled Sokuji side panel for site:', url.hostname);
    } else {
      // Disable side panel for other sites
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        enabled: false
      });
      // Remove from tracking if URL changed to a non-enabled site
      if (tabsWithSidePanelOpen.has(tabId)) {
        tabsWithSidePanelOpen.delete(tabId);
        console.debug('Removed tab from side panel tracking due to URL change:', tabId);
      }
    }
  } catch (error) {
    console.error('Error updating side panel for tab:', error);
  }
});

// Listen for tab switching events to update side panel visibility
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tabId = activeInfo.tabId;
    
    // If the panel isn't actually open for this tab, close it
    if (!tabsWithSidePanelOpen.has(tabId)) {
      await chrome.sidePanel.setOptions({
        enabled: false,
      });
    } else {
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        path: `fullpage.html?tabId=${tabId}&debug=true`,
        enabled: true, // Keep it enabled but don't show it
      });
      console.debug('Maintaining side panel for tab:', tabId);
    }
  } catch (error) {
    console.error('Error updating side panel for switched tab:', error);
  }
});

// Listen for tab closing to clean up tracking
chrome.tabs.onRemoved.addListener((tabId) => {
  // Remove the tab from tracking when it's closed
  if (tabsWithSidePanelOpen.has(tabId)) {
    tabsWithSidePanelOpen.delete(tabId);
    console.debug('Removed closed tab from side panel tracking:', tabId);
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
