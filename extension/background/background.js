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

// Side panel activation strategy:
// For supported sites (Meet/Teams/Zoom/etc), we need to capture tab audio via
// chrome.tabCapture, which requires the `activeTab` permission. activeTab is
// only granted when the user explicitly invokes the extension on the current
// page — specifically, when chrome.action.onClicked fires.
//
// `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` causes
// Chrome to open the side panel DIRECTLY on action click without firing
// onClicked, so activeTab is never granted and tabCapture fails with
// "Extension has not been invoked for the current page".
//
// Fix: disable the popup per-tab on supported sites (so onClicked fires), and
// manually open the side panel via chrome.sidePanel.open({ tabId }) inside the
// onClicked handler. On other sites we re-enable the popup so the icon click
// shows the popup as before.

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
      // Enable side panel for this tab with the correct URL params
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        path: `fullpage.html?tabId=${tabId}&trigger=action_click&site=${encodeURIComponent(url.hostname)}`,
        enabled: true,
      });
      // Clear the popup so chrome.action.onClicked fires on icon click.
      // This is essential for activeTab to be granted to the target tab
      // (tabCapture requires a real action invocation, not the implicit
      // setPanelBehavior({ openPanelOnActionClick: true }) path).
      await chrome.action.setPopup({ tabId: tabId, popup: '' });
      console.debug('[Sokuji] [Background] Enabled side panel (onClicked mode) for site:', url.hostname);
    } else {
      // Disable side panel for this tab and restore the popup
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        enabled: false,
      });
      await chrome.action.setPopup({ tabId: tabId, popup: 'popup.html' });
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
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;

    const url = new URL(tab.url);
    const isEnabledSite = ENABLED_SITES.some(site =>
      url.hostname === site || url.hostname.endsWith('.' + site));

    if (isEnabledSite) {
      await chrome.sidePanel.setOptions({
        tabId: tabId,
        path: `fullpage.html?tabId=${tabId}&trigger=action_click&site=${encodeURIComponent(url.hostname)}`,
        enabled: true,
      });
      await chrome.action.setPopup({ tabId: tabId, popup: '' });
      console.debug('[Sokuji] [Background] Maintaining side panel (onClicked mode) for supported site:', url.hostname);
    } else {
      // Reset the GLOBAL default to disabled so any currently-open side panel
      // actually closes when the user switches to an unsupported tab. Per-tab
      // `enabled: false` alone does not reliably hide a panel that is already
      // visible in the window.
      await chrome.sidePanel.setOptions({
        enabled: false,
      });
      await chrome.action.setPopup({ tabId: tabId, popup: 'popup.html' });
    }
  } catch (error) {
    console.error('[Sokuji] [Background] Error updating side panel for switched tab:', error);
  }
});

// On icon click (fires only when popup is cleared — i.e. for supported
// sites, where updateActionBehaviorForTab() removed the popup): call
// chrome.sidePanel.open() synchronously.
//
// IMPORTANT: `chrome.sidePanel.open()` may only be called in response to
// a user gesture. Any `await` before it drops the gesture and causes
// "may only be called in response to a user gesture". That's why this
// handler is a plain non-async function — setOptions has already been
// called in onUpdated/onActivated, so the tab-specific side panel path
// is already configured by the time the user clicks the action.
chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id || !tab.url) return;

  let url;
  try {
    url = new URL(tab.url);
  } catch {
    return;
  }
  const isEnabledSite = ENABLED_SITES.some(site =>
    url.hostname === site || url.hostname.endsWith('.' + site));
  if (!isEnabledSite) return;

  // Synchronous call — do NOT await anything before this.
  chrome.sidePanel.open({ tabId: tab.id }).then(() => {
    tabsWithSidePanelOpen.add(tab.id);
    console.debug('[Sokuji] [Background] Opened side panel on action click for:', url.hostname);
  }).catch((error) => {
    console.error('[Sokuji] [Background] Error opening side panel on action click:', error);
  });
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

// ─── Edge TTS declarativeNetRequest header injection ──────────────────────
// Edge TTS requires specific headers to connect to Bing's TTS WebSocket endpoint.
// We use declarativeNetRequest to inject these headers for the extension context.
const EDGE_TTS_DNR_RULE_ID_BASE = 3000;
const EDGE_TTS_WS_HOST = 'speech.platform.bing.com';
const EDGE_TTS_CHROMIUM_VERSION = '143.0.3650.75';
const EDGE_TTS_CHROMIUM_MAJOR = EDGE_TTS_CHROMIUM_VERSION.split('.')[0];

const BING_TRANSLATOR_DNR_RULE_ID = 9301;
const BING_TRANSLATOR_HOST = 'www.bing.com';
const BING_TRANSLATOR_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'
  + `${EDGE_TTS_CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CHROMIUM_MAJOR}.0.0.0`;

async function edgeTtsSetDNRHeaders() {
  // Bing TTS WebSocket requires an Edge browser User-Agent to accept the
  // connection (Chrome UA returns 403). Browser WebSocket API cannot set
  // custom headers, so we inject it via declarativeNetRequest.
  //
  // IMPORTANT: For DNR to actually modify WebSocket upgrade headers, the
  // host_permissions must include `wss://` explicitly — `*://` covers
  // http/https but NOT ws/wss, and Chrome silently ignores DNR rules that
  // target hosts outside the permission scope.
  const rules = [
    {
      id: EDGE_TTS_DNR_RULE_ID_BASE,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'User-Agent', operation: 'set', value: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_TTS_CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CHROMIUM_MAJOR}.0.0.0` },
        ],
      },
      condition: {
        urlFilter: `||${EDGE_TTS_WS_HOST}`,
        resourceTypes: ['websocket'],
      },
    },
  ];

  // Remove any existing Edge TTS rules first
  const existingRuleIds = (await chrome.declarativeNetRequest.getDynamicRules())
    .filter(r => r.id >= EDGE_TTS_DNR_RULE_ID_BASE && r.id < EDGE_TTS_DNR_RULE_ID_BASE + 10)
    .map(r => r.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRuleIds,
    addRules: rules,
  });

  console.debug('[Sokuji] [Background] Edge TTS DNR rules registered');
}

async function edgeTtsClearDNRHeaders() {
  const existingRuleIds = (await chrome.declarativeNetRequest.getDynamicRules())
    .filter(r => r.id >= EDGE_TTS_DNR_RULE_ID_BASE && r.id < EDGE_TTS_DNR_RULE_ID_BASE + 10)
    .map(r => r.id);

  if (existingRuleIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRuleIds,
    });
    console.debug('[Sokuji] [Background] Edge TTS DNR rules cleared');
  }
}

// ─── Bing Translator declarativeNetRequest header injection ───────────────────
// Bing Translator's /ttranslatev3 endpoint requires browser-like headers or it
// returns 403/empty responses. We inject them via declarativeNetRequest so the
// extension's fetch requests from Workers are treated as legitimate browser traffic.
async function bingTranslatorSetDNRHeaders() {
  const rules = [
    {
      id: BING_TRANSLATOR_DNR_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'User-Agent', operation: 'set', value: BING_TRANSLATOR_UA },
          { header: 'Origin', operation: 'set', value: 'https://www.bing.com' },
          { header: 'Referer', operation: 'set', value: 'https://www.bing.com/translator' },
          { header: 'Accept-Language', operation: 'set', value: 'en-US,en;q=0.9' },
        ],
      },
      condition: {
        urlFilter: `||${BING_TRANSLATOR_HOST}`,
        resourceTypes: ['xmlhttprequest'],
        // Only rewrite requests the extension itself issues (the Bing worker
        // runs in an extension-page context). Prevents interference with the
        // user's own bing.com tabs, which also issue xmlhttprequest.
        initiatorDomains: [chrome.runtime.id],
      },
    },
  ];

  const existingRuleIds = (await chrome.declarativeNetRequest.getDynamicRules())
    .filter(r => r.id === BING_TRANSLATOR_DNR_RULE_ID)
    .map(r => r.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingRuleIds,
    addRules: rules,
  });

  console.debug('[Sokuji] [Background] Bing Translator DNR rules registered');
}

async function bingTranslatorClearDNRHeaders() {
  const existingRuleIds = (await chrome.declarativeNetRequest.getDynamicRules())
    .filter(r => r.id === BING_TRANSLATOR_DNR_RULE_ID)
    .map(r => r.id);

  if (existingRuleIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRuleIds,
    });
    console.debug('[Sokuji] [Background] Bing Translator DNR rules cleared');
  }
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

  // Handle Edge TTS DNR header injection
  if (message.type === 'EDGE_TTS_SET_HEADERS') {
    edgeTtsSetDNRHeaders()
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('[Sokuji] [Background] Failed to set Edge TTS DNR headers:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'EDGE_TTS_CLEAR_HEADERS') {
    edgeTtsClearDNRHeaders()
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('[Sokuji] [Background] Failed to clear Edge TTS DNR headers:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  // Handle Bing Translator DNR header injection
  if (message.type === 'BING_TRANSLATOR_SET_HEADERS') {
    bingTranslatorSetDNRHeaders()
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('[Sokuji] [Background] Failed to set Bing Translator DNR headers:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.type === 'BING_TRANSLATOR_CLEAR_HEADERS') {
    bingTranslatorClearDNRHeaders()
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('[Sokuji] [Background] Failed to clear Bing Translator DNR headers:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
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
