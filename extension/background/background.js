// Background script for Sokuji browser extension
// This script handles configuration storage and uninstall feedback

/* global chrome */

// Uninstall feedback URL - hosted on backend
const UNINSTALL_FEEDBACK_BASE_URL = 'https://sokuji.kizuna.ai/uninstall-feedback';

// Default configuration values
const DEFAULT_CONFIG = {
  openAIApiKey: '',
  model: 'gpt-realtime-mini',
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
  'teams.cloud.microsoft',
  'app.zoom.us',
  'app.gather.town',
  'app.v2.gather.town',
  'whereby.com',
  'discord.com',
  'slack.com'
];

// Track which tabs have the side panel open
const tabsWithSidePanelOpen = new Set();

// Track active tab audio captures (legacy direct-capture path, kept for reference)
const activeTabCaptures = new Map(); // tabId -> { streamId, active }

// Track side-panel ports waiting for PCM data (keyed by tabId)
const pcmRelayPorts = new Map(); // tabId (number) -> chrome.runtime.Port

// Port from the offscreen document (one at a time)
let offscreenPcmPort = null;

// Whether an offscreen document is currently open
let offscreenDocumentOpen = false;

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

// ─── Volcengine AST2 declarativeNetRequest header injection ───────────────
// Browser WebSocket API cannot send custom headers. We use declarativeNetRequest
// dynamic rules to inject auth headers into the WebSocket upgrade request.
const VOLCENGINE_DNR_RULE_ID_BASE = 2000;
const VOLCENGINE_WS_HOST = 'openspeech.bytedance.com';

let dnrUpdatePromise = Promise.resolve();

async function volcengineSetDNRHeaders(credentials) {
  dnrUpdatePromise = dnrUpdatePromise.then(async () => {
    const { appKey, accessKey, resourceId, connectId } = credentials;

    const headers = [
      { header: 'X-Api-App-Key', value: appKey },
      { header: 'X-Api-Access-Key', value: accessKey },
      { header: 'X-Api-Resource-Id', value: resourceId },
      { header: 'X-Api-Connect-Id', value: connectId },
    ];

    const rules = headers.map((h, i) => ({
      id: VOLCENGINE_DNR_RULE_ID_BASE + i,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: h.header, operation: 'set', value: h.value },
        ],
      },
      condition: {
        urlFilter: `||${VOLCENGINE_WS_HOST}`,
        resourceTypes: ['websocket'],
      },
    }));

    // Remove any existing Volcengine rules first
    const existingRuleIds = (await chrome.declarativeNetRequest.getDynamicRules())
      .filter(r => r.id >= VOLCENGINE_DNR_RULE_ID_BASE && r.id < VOLCENGINE_DNR_RULE_ID_BASE + 10)
      .map(r => r.id);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRuleIds,
      addRules: rules,
    });

    console.debug('[Sokuji] [Background] Volcengine AST2 DNR rules registered:', rules.length);
  });
  return dnrUpdatePromise;
}

async function volgengineClearDNRHeaders() {
  dnrUpdatePromise = dnrUpdatePromise.then(async () => {
    const existingRuleIds = (await chrome.declarativeNetRequest.getDynamicRules())
      .filter(r => r.id >= VOLCENGINE_DNR_RULE_ID_BASE && r.id < VOLCENGINE_DNR_RULE_ID_BASE + 10)
      .map(r => r.id);

    if (existingRuleIds.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRuleIds,
      });
      console.debug('[Sokuji] [Background] Volcengine AST2 DNR rules cleared');
    }
  });
  return dnrUpdatePromise;
}

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

  // Handle Volcengine AST2 DNR header injection
  if (message.type === 'VOLCENGINE_AST2_SET_HEADERS') {
    volcengineSetDNRHeaders(message.credentials)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('[Sokuji] [Background] Failed to set Volcengine DNR headers:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'VOLCENGINE_AST2_CLEAR_HEADERS') {
    volgengineClearDNRHeaders()
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('[Sokuji] [Background] Failed to clear Volcengine DNR headers:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  // Handle START_OFFSCREEN_TAB_CAPTURE from side panel (offscreen-based tab capture)
  if (message.type === 'START_OFFSCREEN_TAB_CAPTURE') {
    handleStartOffscreenTabCapture(message.tabId, message.outputDeviceId).then(sendResponse);
    return true; // Indicates async response
  }

  // Handle STOP_OFFSCREEN_TAB_CAPTURE from side panel
  if (message.type === 'STOP_OFFSCREEN_TAB_CAPTURE') {
    handleStopOffscreenTabCapture(message.tabId).then(sendResponse);
    return true; // Indicates async response
  }

  // Handle START_TAB_CAPTURE message from side panel
  if (message.type === 'START_TAB_CAPTURE') {
    handleStartTabCapture(message.tabId || sender.tab?.id).then(sendResponse);
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

// ─── Offscreen-document-based tab audio capture ────────────────────────────
// The side panel is cross-origin isolated (COOP+COEP in manifest.json), which
// prevents it from calling getUserMedia with chromeMediaSource:'tab'.  We
// work around this by delegating the capture to an offscreen document that is
// not cross-origin isolated, then relaying the resulting PCM frames back to
// the side panel via a pair of long-lived runtime ports.

/**
 * Ensure the offscreen document exists, creating it if necessary.
 */
async function ensureOffscreenDocument() {
  if (offscreenDocumentOpen) return;

  const offscreenUrl = chrome.runtime.getURL('offscreen.html');

  // Chrome 116+ supports chrome.offscreen
  if (!chrome.offscreen) {
    throw new Error('chrome.offscreen API is not available in this Chrome version');
  }

  // Check whether the document already exists (e.g. after SW restart)
  try {
    const existing = await chrome.offscreen.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });
    if (existing && existing.length > 0) {
      offscreenDocumentOpen = true;
      return;
    }
  } catch (_) {
    // getContexts may not be available on all versions; proceed to create
  }

  await chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: ['USER_MEDIA'],
    justification: 'Tab audio capture for participant translation (cross-origin-isolated side panel workaround)',
  });
  offscreenDocumentOpen = true;
  console.info('[Sokuji] [Background] Offscreen document created');
}

/**
 * Close the offscreen document if it is open.
 */
async function closeOffscreenDocument() {
  if (!offscreenDocumentOpen) return;
  try {
    await chrome.offscreen.closeDocument();
    offscreenDocumentOpen = false;
    offscreenPcmPort = null;
    console.info('[Sokuji] [Background] Offscreen document closed');
  } catch (error) {
    console.warn('[Sokuji] [Background] Error closing offscreen document:', error);
    offscreenDocumentOpen = false;
    offscreenPcmPort = null;
  }
}

// Handle ports from both the offscreen document and the side panel
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'offscreen-pcm') {
    // Port from the offscreen document carrying PCM frames
    offscreenPcmPort = port;
    console.info('[Sokuji] [Background] Offscreen PCM port connected');

    port.onMessage.addListener((msg) => {
      if (msg.type === 'PCM_DATA') {
        // Relay PCM frame to the side panel port for this tab
        const sidePort = pcmRelayPorts.get(msg.tabId);
        if (sidePort) {
          try {
            sidePort.postMessage({ type: 'PCM_DATA', buffer: msg.buffer }, [msg.buffer]);
          } catch (err) {
            console.warn('[Sokuji] [Background] Failed to relay PCM to side panel:', err);
          }
        }
      }
    });

    port.onDisconnect.addListener(() => {
      offscreenPcmPort = null;
      offscreenDocumentOpen = false;
      console.info('[Sokuji] [Background] Offscreen PCM port disconnected');
    });

  } else if (port.name.startsWith('pcm-')) {
    // Port from the side panel requesting PCM relay for a specific tab
    const tabId = parseInt(port.name.slice(4), 10);
    if (!isNaN(tabId)) {
      pcmRelayPorts.set(tabId, port);
      console.info('[Sokuji] [Background] Side panel PCM relay port connected for tab:', tabId);

      port.onDisconnect.addListener(() => {
        pcmRelayPorts.delete(tabId);
        console.info('[Sokuji] [Background] Side panel PCM relay port disconnected for tab:', tabId);
      });
    }
  }
});

/**
 * Start offscreen-based tab audio capture.
 * Gets a fresh streamId, spins up the offscreen document, and signals it to
 * begin capturing.  The side panel must already have connected its pcm-{tabId}
 * relay port before calling this (or connect it immediately after).
 */
async function handleStartOffscreenTabCapture(tabId, outputDeviceId) {
  try {
    console.info('[Sokuji] [Background] Starting offscreen tab capture for tab:', tabId);

    if (!tabId) {
      return { success: false, error: 'Tab ID is required' };
    }

    // Verify the tab exists
    try {
      await chrome.tabs.get(tabId);
    } catch (_) {
      console.error('[Sokuji] [Background] Tab not found:', tabId);
      return { success: false, error: 'Tab not found' };
    }

    // Get a fresh stream ID from the tab capture API
    console.info('[Sokuji] [Background] Requesting streamId for tab:', tabId);
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId(
        { targetTabId: tabId },
        (id) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!id) {
            reject(new Error('tabCapture.getMediaStreamId returned empty streamId'));
          } else {
            resolve(id);
          }
        }
      );
    });

    console.info('[Sokuji] [Background] Got streamId:', streamId, 'for tab:', tabId);

    // Ensure the offscreen document is running
    await ensureOffscreenDocument();

    // Ask the offscreen document to start capturing
    const response = await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_START_CAPTURE',
      tabId,
      streamId,
      outputDeviceId: outputDeviceId || null,
    });

    if (!response || !response.success) {
      throw new Error((response && response.error) || 'Offscreen document failed to start capture');
    }

    console.info('[Sokuji] [Background] Offscreen tab capture started for tab:', tabId);
    return { success: true };

  } catch (error) {
    console.error('[Sokuji] [Background] Failed to start offscreen tab capture:', error);
    return { success: false, error: error.message || 'Failed to start offscreen tab capture' };
  }
}

/**
 * Stop offscreen-based tab audio capture for a given tab.
 */
async function handleStopOffscreenTabCapture(tabId) {
  try {
    console.info('[Sokuji] [Background] Stopping offscreen tab capture for tab:', tabId);

    if (offscreenDocumentOpen) {
      try {
        await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_CAPTURE', tabId });
      } catch (err) {
        console.warn('[Sokuji] [Background] Error sending stop to offscreen:', err);
      }

      // Only close the offscreen document if no more side-panel ports are waiting
      if (pcmRelayPorts.size === 0) {
        await closeOffscreenDocument();
      }
    }

    return { success: true };
  } catch (error) {
    console.error('[Sokuji] [Background] Failed to stop offscreen tab capture:', error);
    return { success: false, error: error.message };
  }
}
