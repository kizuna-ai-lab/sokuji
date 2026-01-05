// Background script for Sokuji browser extension
// This script handles configuration storage and uninstall feedback

/* global chrome */

// Uninstall feedback URL - placeholder for survey form
const UNINSTALL_FEEDBACK_BASE_URL = 'https://kizuna-ai-lab.github.io/sokuji/uninstall_feedback.html';

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
  'teams.microsoft.com',
  'app.zoom.us',
  'app.gather.town',
  'app.v2.gather.town',
  'whereby.com',
  'discord.com',
  'slack.com'
];

// Track which tabs have the side panel open
const tabsWithSidePanelOpen = new Set();

// Track active tab audio captures
const activeTabCaptures = new Map(); // tabId -> { streamId, active }

// Store PostHog distinct_id received from frontend
let currentDistinctId = null;

// Function to get stored distinct_id
async function getStoredDistinctId() {
  try {
    const result = await chrome.storage.local.get('posthog_distinct_id');
    return result.posthog_distinct_id || null;
  } catch (error) {
    console.error('[Sokuji] [Background] Error getting stored distinct_id:', error);
    return null;
  }
}

// Function to store distinct_id
async function storeDistinctId(distinctId) {
  try {
    await chrome.storage.local.set({ posthog_distinct_id: distinctId });
    currentDistinctId = distinctId;
    console.debug('[Sokuji] [Background] Stored distinct_id');
    return true;
  } catch (error) {
    console.error('[Sokuji] [Background] Error storing distinct_id:', error);
    return false;
  }
}

// Function to update uninstall URL with distinct_id
async function updateUninstallURL(distinctId = null) {
  try {
    // Use provided distinctId or get from storage
    const activeDistinctId = distinctId || currentDistinctId || await getStoredDistinctId();
    let uninstallUrl = UNINSTALL_FEEDBACK_BASE_URL;
    
    if (activeDistinctId) {
      // Add distinct_id as URL parameter
      const url = new URL(uninstallUrl);
      url.searchParams.set('distinct_id', activeDistinctId);
      uninstallUrl = url.toString();
      console.debug('[Sokuji] [Background] Updated uninstall URL with distinct_id');
    } else {
      console.debug('[Sokuji] [Background] No distinct_id available, using base uninstall URL');
    }
    
    if (chrome.runtime.setUninstallURL) {
      chrome.runtime.setUninstallURL(uninstallUrl);
      console.debug('[Sokuji] [Background] Uninstall feedback URL configured');
    }
    
    return true;
  } catch (error) {
    console.error('[Sokuji] [Background] Error updating uninstall URL:', error);
    return false;
  }
}

// Remove automatic side panel opening behavior - now handled by popup
// chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
//   .catch((error) => console.error('[Sokuji] [Background] Error setting panel behavior:', error));

// Initialize configuration in storage if not already set
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const result = await chrome.storage.local.get('config');
    if (!result.config) {
      await chrome.storage.local.set({ config: DEFAULT_CONFIG });
      console.debug('[Sokuji] [Background] Default configuration initialized');
    }
    
    // Set up uninstall URL for feedback collection
    await updateUninstallURL();
  } catch (error) {
    console.error('[Sokuji] [Background] Error initializing configuration:', error);
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
      // Enable side panel for this site (but don't auto-open)
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        path: `fullpage.html?tabId=${tabId}`,
        enabled: true
      });
      console.debug('[Sokuji] [Background] Enabled Sokuji side panel for site:', url.hostname);
    } else {
      // Disable side panel for other sites
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        enabled: false
      });
      // Remove from tracking if URL changed to a non-enabled site
      if (tabsWithSidePanelOpen.has(tabId)) {
        tabsWithSidePanelOpen.delete(tabId);
        console.debug('[Sokuji] [Background] Removed tab from side panel tracking due to URL change:', tabId);
      }
    }
  } catch (error) {
    console.error('[Sokuji] [Background] Error updating side panel for tab:', error);
  }
});

// Listen for tab switching events to update side panel visibility
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tabId = activeInfo.tabId;
    
    // Get tab information to check if it's a supported site
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    
    const url = new URL(tab.url);
    const isEnabledSite = ENABLED_SITES.some(site => 
      url.hostname === site || url.hostname.endsWith('.' + site));
    
    if (isEnabledSite) {
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        path: `fullpage.html?tabId=${tabId}`,
        enabled: true,
      });
      console.debug('[Sokuji] [Background] Maintaining side panel for supported site:', url.hostname);
    } else {
      await chrome.sidePanel.setOptions({
        enabled: false,
      });
    }
  } catch (error) {
    console.error('[Sokuji] [Background] Error updating side panel for switched tab:', error);
  }
});

// Listen for tab closing to clean up tracking
chrome.tabs.onRemoved.addListener((tabId) => {
  // Remove the tab from tracking when it's closed
  if (tabsWithSidePanelOpen.has(tabId)) {
    tabsWithSidePanelOpen.delete(tabId);
    console.debug('[Sokuji] [Background] Removed closed tab from side panel tracking:', tabId);
  }

  // Clean up any active tab audio captures
  if (activeTabCaptures.has(tabId)) {
    activeTabCaptures.delete(tabId);
    console.debug('[Sokuji] [Background] Cleaned up tab capture for closed tab:', tabId);
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
  
  if (message.type === 'OPEN_SIDE_PANEL') {
    handleOpenSidePanel(message.tabId).then(sendResponse);
    return true; // Indicates async response
  }
  
  if (message.type === 'UPDATE_UNINSTALL_URL') {
    // Handle distinct_id from frontend
    const distinctId = message.distinct_id;
    if (distinctId) {
      // Store the distinct_id and update uninstall URL
      storeDistinctId(distinctId).then(() => {
        return updateUninstallURL(distinctId);
      }).then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        console.error('[Sokuji] [Background] Error handling distinct_id update:', error);
        sendResponse({ success: false, error: error.message });
      });
    } else {
      // Just update with existing distinct_id
      updateUninstallURL().then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        console.error('[Sokuji] [Background] Error updating uninstall URL:', error);
        sendResponse({ success: false, error: error.message });
      });
    }
    return true; // Indicates async response
  }

  // Handle START_TAB_CAPTURE message from side panel
  if (message.type === 'START_TAB_CAPTURE') {
    handleStartTabCapture(message.tabId).then(sendResponse);
    return true; // Indicates async response
  }

  // Handle STOP_TAB_CAPTURE message from side panel
  if (message.type === 'STOP_TAB_CAPTURE') {
    handleStopTabCapture(message.tabId || sender.tab?.id).then(sendResponse);
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
    console.error('[Sokuji] [Background] Error getting config:', error);
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
    console.error('[Sokuji] [Background] Error setting config:', error);
    return { success: false, error: error.message };
  }
}

// Handle opening side panel from popup
async function handleOpenSidePanel(tabId) {
  try {
    await chrome.sidePanel.open({ tabId: tabId });
    tabsWithSidePanelOpen.add(tabId);
    console.debug('[Sokuji] [Background] Opened side panel for tab:', tabId);
    return { success: true };
  } catch (error) {
    console.error('[Sokuji] [Background] Error opening side panel:', error);
    return { success: false, error: error.message };
  }
}

// Start tab audio capture and return streamId
async function handleStartTabCapture(tabId) {
  try {
    console.info('[Sokuji] [Background] Starting tab capture for tab:', tabId);

    // Validate tabId
    if (!tabId) {
      return { success: false, error: 'Tab ID is required' };
    }

    // Check if already capturing this tab
    if (activeTabCaptures.has(tabId)) {
      const existing = activeTabCaptures.get(tabId);
      if (existing.active) {
        console.info('[Sokuji] [Background] Tab already being captured, returning existing streamId');
        return { success: true, streamId: existing.streamId };
      }
    }

    // Verify the tab exists
    try {
      await chrome.tabs.get(tabId);
    } catch (error) {
      console.error('[Sokuji] [Background] Tab not found:', tabId);
      return { success: false, error: 'Tab not found' };
    }

    // Request media stream ID for the tab using tabCapture API
    console.info('[Sokuji] [Background] Calling chrome.tabCapture.getMediaStreamId for tabId:', tabId);
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: tabId },
        (streamId) => {
          if (chrome.runtime.lastError) {
            console.error('[Sokuji] [Background] tabCapture.getMediaStreamId failed:', chrome.runtime.lastError.message);
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!streamId) {
            console.error('[Sokuji] [Background] tabCapture.getMediaStreamId returned empty streamId');
            reject(new Error('Failed to get stream ID'));
          } else {
            console.info('[Sokuji] [Background] tabCapture.getMediaStreamId succeeded, streamId:', streamId);
            resolve(streamId);
          }
        }
      );
    });

    // Store the active capture
    activeTabCaptures.set(tabId, { streamId, active: true });

    console.info('[Sokuji] [Background] Tab capture started successfully, streamId:', streamId);
    return { success: true, streamId };

  } catch (error) {
    console.error('[Sokuji] [Background] Failed to start tab capture:', error);
    return { success: false, error: error.message || 'Failed to start tab capture' };
  }
}

// Stop tab audio capture
async function handleStopTabCapture(tabId) {
  try {
    console.info('[Sokuji] [Background] Stopping tab capture for tab:', tabId);

    if (tabId && activeTabCaptures.has(tabId)) {
      activeTabCaptures.delete(tabId);
      console.info('[Sokuji] [Background] Tab capture stopped for tab:', tabId);
    }

    return { success: true };
  } catch (error) {
    console.error('[Sokuji] [Background] Failed to stop tab capture:', error);
    return { success: false, error: error.message };
  }
}
