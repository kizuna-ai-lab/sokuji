/* global chrome */

// Import PostHog from installed package
import posthog from 'posthog-js/dist/module.full.no-external';

// Analytics configuration - matches main app config
const ANALYTICS_CONFIG = {
  POSTHOG_KEY: 'phc_EMOuUDTntTI5SuzKQATy11qHgxVrlhJsgNFbBaWEhet',
  POSTHOG_HOST: 'https://us.i.posthog.com'
};

// PostHog instance
let posthogInstance = null;

// Initialize PostHog
function initializePostHog() {
  if (posthogInstance || typeof window === 'undefined') return;
  
  try {
    // Initialize PostHog with configuration
    posthog.init(ANALYTICS_CONFIG.POSTHOG_KEY, {
      api_host: ANALYTICS_CONFIG.POSTHOG_HOST,
      loaded: function(posthogLoaded) {
        posthogInstance = posthogLoaded;
        
        // Set super properties
        posthogInstance.register({
          app_version: chrome.runtime.getManifest().version,
          environment: isDevelopment() ? 'development' : 'production',
          platform: 'extension',
          component: 'popup'
        });
        
        console.debug('[Sokuji] [Popup] PostHog initialized');
      }
    });
    
    // Store reference to posthog instance immediately
    posthogInstance = posthog;
  } catch (error) {
    console.error('[Sokuji] [Popup] Error initializing PostHog:', error);
  }
}

// Check if we're in development mode
function isDevelopment() {
  return !chrome.runtime.getManifest().update_url;
}

// Track events with PostHog
function trackEvent(eventName, properties = {}) {
  try {
    if (posthogInstance) {
      // Sanitize properties by removing sensitive data
      const sanitizedProperties = sanitizeProperties(properties);
      posthogInstance.capture(eventName, sanitizedProperties);
      console.debug('[Sokuji] [Popup] Event tracked:', eventName, sanitizedProperties);
    }
  } catch (error) {
    console.error('[Sokuji] [Popup] Error tracking event:', error);
  }
}

// Sanitize properties to remove sensitive information
function sanitizeProperties(properties) {
  const sanitized = { ...properties };
  
  // Remove or mask sensitive fields
  const sensitiveFields = ['apiKey', 'password', 'token', 'secret', 'private'];
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      delete sanitized[field];
    }
  });
  
  return sanitized;
}

// Define the same enabled sites as in background.js
const ENABLED_SITES = [
  'meet.google.com',
  'teams.live.com',
  'app.zoom.us',
  'app.gather.town'
];

// Site information with display names and icons
const SITE_INFO = {
  'meet.google.com': {
    name: 'Google Meet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCA4Ny41IDcyIj4NCgk8cGF0aCBmaWxsPSIjMDA4MzJkIiBkPSJNNDkuNSAzNmw4LjUzIDkuNzUgMTEuNDcgNy4zMyAyLTE3LjAyLTItMTYuNjQtMTEuNjkgNi40NHoiLz4NCgk8cGF0aCBmaWxsPSIjMDA2NmRhIiBkPSJNMCA1MS41VjY2YzAgMy4zMTUgMi42ODUgNiA2IDZoMTQuNWwzLTEwLjk2LTMtOS41NC05Ljk1LTN6Ii8+DQoJPHBhdGggZmlsbD0iI2U5NDIzNSIgZD0iTTIwLjUgMEwwIDIwLjVsMTAuNTUgMyA5Ljk1LTMgMi45NS05LjQxeiIvPg0KCTxwYXRoIGZpbGw9IiMyNjg0ZmMiIGQ9Ik0yMC41IDIwLjVIMHYzMWgyMC41eiIvPg0KCTxwYXRoIGZpbGw9IiMwMGFjNDciIGQ9Ik04Mi42IDguNjhMNjkuNSAxOS40MnYzMy42NmwxMy4xNiAxMC43OWMxLjk3IDEuNTQgNC44NS4xMzUgNC44NS0yLjM3VjExYzAtMi41MzUtMi45NDUtMy45MjUtNC45MS0yLjMyek00OS41IDM2djE1LjVoLTI5VjcyaDQzYzMuMzE1IDAgNi0yLjY4NSA2LTZWNTMuMDh6Ii8+DQoJPHBhdGggZmlsbD0iI2ZmYmEwMCIgZD0iTTYzLjUgMGgtNDN2MjAuNWgyOVYzNmwyMC0xNi41N1Y2YzAtMy4zMTUtMi42ODUtNi02LTZ6Ii8+DQo8L3N2Zz4='
  },
  'teams.live.com': {
    name: 'Microsoft Teams Live',
    icon: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMjI4LjgzMyAyMDczLjMzMyI+CiAgPHBhdGggZmlsbD0iIzUwNTlDOSIgZD0iTTE1NTQuNjM3LDc3Ny41aDU3NS43MTNjNTQuMzkxLDAsOTguNDgzLDQ0LjA5Miw5OC40ODMsOTguNDgzYzAsMCwwLDAsMCwwdjUyNC4zOTgJYzAsMTk5LjkwMS0xNjIuMDUxLDM2MS45NTItMzYxLjk1MiwzNjEuOTUyaDBoLTEuNzExYy0xOTkuOTAxLDAuMDI4LTM2MS45NzUtMTYyLTM2Mi4wMDQtMzYxLjkwMWMwLTAuMDE3LDAtMC4wMzQsMC0wLjA1MlY4MjguOTcxCUMxNTAzLjE2Nyw4MDAuNTQ0LDE1MjYuMjExLDc3Ny41LDE1NTQuNjM3LDc3Ny41TDE1NTQuNjM3LDc3Ny41eiIvPgogIDxjaXJjbGUgZmlsbD0iIzUwNTlDOSIgY3g9IjE5NDMuNzUiIGN5PSI0NDAuNTgzIiByPSIyMzMuMjUiLz4KICA8Y2lyY2xlIGZpbGw9IiM3QjgzRUIiIGN4PSIxMjE4LjA4MyIgY3k9IjMzNi45MTciIHI9IjMzNi45MTciLz4KICA8cGF0aCBmaWxsPSIjN0I4M0VCIiBkPSJNMTY2Ny4zMjMsNzc3LjVINzE3LjAxYy01My43NDMsMS4zMy05Ni4yNTcsNDUuOTMxLTk1LjAxLDk5LjY3NnY1OTguMTA1CWMtNy41MDUsMzIyLjUxOSwyNDcuNjU3LDU5MC4xNiw1NzAuMTY3LDU5OC4wNTNjMzIyLjUxLTcuODkzLDU3Ny42NzEtMjc1LjUzNCw1NzAuMTY3LTU5OC4wNTNWODc3LjE3NglDMTc2My41NzksODIzLjQzMSwxNzIxLjA2Niw3NzguODMsMTY2Ny4zMjMsNzc3LjV6Ii8+CiAgPHBhdGggb3BhY2l0eT0iLjEiIGQ9Ik0xMjQ0LDc3Ny41djgzOC4xNDVjLTAuMjU4LDM4LjQzNS0yMy41NDksNzIuOTY0LTU5LjA5LDg3LjU5OAljLTExLjMxNiw0Ljc4Ny0yMy40NzgsNy4yNTQtMzUuNzY1LDcuMjU3SDY2Ny42MTNjLTYuNzM4LTE3LjEwNS0xMi45NTgtMzQuMjEtMTguMTQyLTUxLjgzMwljLTE4LjE0NC01OS40NzctMjcuNDAyLTEyMS4zMDctMjcuNDcyLTE4My40OVY4NzcuMDJjLTEuMjQ2LTUzLjY1OSw0MS4xOTgtOTguMTksOTQuODU1LTk5LjUySDEyNDR6Ii8+CiAgPHBhdGggb3BhY2l0eT0iLjIiIGQ9Ik0xMTkyLjE2Nyw3NzcuNXY4ODkuOTc4Yy0wLjAwMiwxMi4yODctMi40NywyNC40NDktNy4yNTcsMzUuNzY1CWMtMTQuNjM0LDM1LjU0MS00OS4xNjMsNTguODMzLTg3LjU5OCw1OS4wOUg2OTEuOTc1Yy04LjgxMi0xNy4xMDUtMTcuMTA1LTM0LjIxLTI0LjM2Mi01MS44MzMJYy03LjI1Ny0xNy42MjMtMTIuOTU4LTM0LjIxLTE4LjE0Mi01MS44MzNjLTE4LjE0NC01OS40NzYtMjcuNDAyLTEyMS4zMDctMjcuNDcyLTE4My40OVY4NzcuMDIJYy0xLjI0Ni01My42NTksNDEuMTk4LTk4LjE5LDk0Ljg1NS05OS41MkgxMTkyLjE2N3oiLz4KICA8cGF0aCBvcGFjaXR5PSIuMiIgZD0iTTExOTIuMTY3LDc3Ny41djc4Ni4zMTJjLTAuMzk1LDUyLjIyMy00Mi42MzIsOTQuNDYtOTQuODU1LDk0Ljg1NWgtNDQ3Ljg0CWMtMTguMTQ0LTU5LjQ3Ni0yNy40MDItMTIxLjMwNy0yNy40NzItMTgzLjQ5Vjg3Ny4wMmMtMS4yNDYtNTMuNjU5LDQxLjE5OC05OC4xOSw5NC44NTUtOTkuNTJIMTE5Mi4xNjd6Ii8+CiAgPHBhdGggb3BhY2l0eT0iLjIiIGQ9Ik0xMTQwLjMzMyw3NzcuNXY3ODYuMzEyYy0wLjM5NSw1Mi4yMjMtNDIuNjMyLDk0LjQ2LTk0Ljg1NSw5NC44NTVINjQ5LjQ3MgljLTE4LjE0NC01OS40NzYtMjcuNDAyLTEyMS4zMDctMjcuNDcyLTE4My40OVY4NzcuMDJjLTEuMjQ2LTUzLjY1OSw0MS4xOTgtOTguMTksOTQuODU1LTk5LjUySDExNDAuMzMzeiIvPgogIDxwYXRoIG9wYWNpdHk9Ii4xIiBkPSJNMTI0NCw1MDkuNTIydjE2My4yNzVjLTguODEyLDAuNTE4LTE3LjEwNSwxLjAzNy0yNS45MTcsMS4wMzcJYy04LjgxMiwwLTE3LjEwNS0wLjUxOC0yNS45MTctMS4wMzdjLTE3LjQ5Ni0xLjE2MS0zNC44NDgtMy45MzctNTEuODMzLTguMjkzYy0xMDQuOTYzLTI0Ljg1Ny0xOTEuNjc5LTk4LjQ2OS0yMzMuMjUtMTk4LjAwMwljLTcuMTUzLTE2LjcxNS0xMi43MDYtMzQuMDcxLTE2LjU4Ny01MS44MzNoMjU4LjY0OEMxMjAxLjQ0OSw0MTQuODY2LDEyNDMuODAxLDQ1Ny4yMTcsMTI0NCw1MDkuNTIyeiIvPgogIDxwYXRoIG9wYWNpdHk9Ii4yIiBkPSJNMTE5Mi4xNjcsNTYxLjM1NXYxMTEuNDQyYy0xNy40OTYtMS4xNjEtMzQuODQ4LTMuOTM3LTUxLjgzMy04LjI5MwljLTEwNC45NjMtMjQuODU3LTE5MS42NzktOTguNDY5LTIzMy4yNS0xOTguMDAzaDE5MC4yMjhDMTE0OS42MTYsNDY2LjY5OSwxMTkxLjk2OCw1MDkuMDUxLDExOTIuMTY3LDU2MS4zNTV6Ii8+CiAgPHBhdGggb3BhY2l0eT0iLjIiIGQ9Ik0xMTkyLjE2Nyw1NjEuMzU1djExMS40NDJjLTE3LjQ5Ni0xLjE2MS0zNC44NDgtMy45MzctNTEuODMzLTguMjkzCWMtMTA0Ljk2My0yNC44NTctMTkxLjY3OS05OC40NjktMjMzLjI1LTE5OC4wMDNoMTkwLjIyOEMxMTQ5LjYxNiw0NjYuNjk5LDExOTEuOTY4LDUwOS4wNTEsMTE5Mi4xNjcsNTYxLjM1NXoiLz4KICA8cGF0aCBvcGFjaXR5PSIuMiIgZD0iTTExNDAuMzMzLDU2MS4zNTV2MTAzLjE0OGMtMTA0Ljk2My0yNC44NTctMTkxLjY3OS05OC40NjktMjMzLjI1LTE5OC4wMDMJaDEzOC4zOTVDMTA5Ny43ODMsNDY2LjY5OSwxMTQwLjEzNCw1MDkuMDUxLDExNDAuMzMzLDU2MS4zNTV6Ii8+CiAgPGxpbmVhckdyYWRpZW50IGlkPSJhIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeDE9IjE5OC4wOTkiIHkxPSIxNjgzLjA3MjYiIHgyPSI5NDIuMjM0NCIgeTI9IjM5NC4yNjA3IiBncmFkaWVudFRyYW5zZm9ybT0ibWF0cml4KDEgMCAwIC0xIDAgMjA3NS4zMzMzKSI+CiAgICA8c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM1YTYyYzMiLz4KICAgIDxzdG9wIG9mZnNldD0iLjUiIHN0b3AtY29sb3I9IiM0ZDU1YmQiLz4KICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzM5NDBhYiIvPgogIDwvbGluZWFyR3JhZGllbnQ+CiAgPHBhdGggZmlsbD0idXJsKCNhKSIgZD0iTTk1LjAxLDQ2Ni41aDk1MC4zMTJjNTIuNDczLDAsOTUuMDEsNDIuNTM4LDk1LjAxLDk1LjAxdjk1MC4zMTJjMCw1Mi40NzMtNDIuNTM4LDk1LjAxLTk1LjAxLDk1LjAxCUg5NS4wMWMtNTIuNDczLDAtOTUuMDEtNDIuNTM4LTk1LjAxLTk1LjAxVjU2MS41MUMwLDUwOS4wMzgsNDIuNTM4LDQ2Ni41LDk1LjAxLDQ2Ni41eiIvPgogIDxwYXRoIGZpbGw9IiNGRkYiIGQ9Ik04MjAuMjExLDgyOC4xOTNINjMwLjI0MXY1MTcuMjk3SDUwOS4yMTFWODI4LjE5M0gzMjAuMTIzVjcyNy44NDRoNTAwLjA4OFY4MjguMTkzeiIvPgo8L3N2Zz4K'
  },
  'app.zoom.us': {
    name: 'Zoom',
    icon: 'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz48IS0tIFVwbG9hZGVkIHRvOiBTVkcgUmVwbywgd3d3LnN2Z3JlcG8uY29tLCBHZW5lcmF0b3I6IFNWRyBSZXBvIE1peGVyIFRvb2xzIC0tPgo8c3ZnIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIKYXJpYS1sYWJlbD0iWm9vbSIgcm9sZT0iaW1nIgp2aWV3Qm94PSIwIDAgNTEyIDUxMiI+PHJlY3QKd2lkdGg9IjUxMiIgaGVpZ2h0PSI1MTIiCnJ4PSIxNSUiCmZpbGw9IiMyRDhDRkYiLz48cGF0aCBmaWxsPSIjZmZmZmZmIiBkPSJNNDI4IDM1N2M4IDIgMTUtMiAxOS04IDItMyAyLTggMi0xOVYxNzljMC0xMSAwLTE1LTItMTktMy04LTExLTExLTE5LTgtMjEgMTQtNjcgNTUtNjggNzItLjggMy0uOCA4LS44IDE1djM4YzAgOCAwIDExIC44IDE1IDEgOCA0IDE1IDggMTkgMTIgOSA1MiA0NSA2MSA0NXpNNjQgMTg3YzAtMTUgMC0yMyAzLTI3IDItNCA4LTggMTEtMTEgNC0zIDExLTMgMjctM2gxMjljMzggMCA1NyAwIDcyIDggMTEgOCAyMyAxNSAzMCAzMCA4IDE1IDggMzQgOCA3MnY2OGMwIDE1IDAgMjMtMyAyNy0yIDQtOCA4LTExIDExLTQgMy0xMSAzLTI3IDNIMTc0Yy0zOCAwLTU3IDAtNzItOC0xMS04LTIzLTE1LTMwLTMwLTgtMTUtOC0zNC04LTcyeiIvPjwvc3ZnPg=='
  },
  'app.gather.town': {
    name: 'Gather Town',
    icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iOCIgZmlsbD0iIzY2NjZGRiIvPgo8cGF0aCBkPSJNMTIgMTJIMjhWMjhIMTJWMTJaIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiIGZpbGw9Im5vbmUiLz4KPGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMiIgZmlsbD0id2hpdGUiLz4KPGNpcmNsZSBjeD0iMjQiIGN5PSIxNiIgcj0iMiIgZmlsbD0id2hpdGUiLz4KPGNpcmNsZSBjeD0iMTYiIGN5PSIyNCIgcj0iMiIgZmlsbD0id2hpdGUiLz4KPGNpcmNsZSBjeD0iMjQiIGN5PSIyNCIgcj0iMiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+Cg=='
  }
};

// Helper function to get localized message
function getMessage(key, substitutions = []) {
  return chrome.i18n.getMessage(key, substitutions);
}

// Browser detection utility
function detectBrowser() {
  const userAgent = navigator.userAgent;
  
  // Check for Edge (both Chromium-based and legacy)
  if (userAgent.includes('Edg/') || userAgent.includes('Edge/')) {
    return 'edge';
  }
  
  // Check for Chrome
  if (userAgent.includes('Chrome/') && !userAgent.includes('Edg/')) {
    return 'chrome';
  }
  
  // Default to chrome for other Chromium-based browsers
  return 'chrome';
}

// Get appropriate store information based on browser
function getStoreInfo() {
  const browser = detectBrowser();
  
  if (browser === 'edge') {
    return {
      url: 'https://microsoftedge.microsoft.com/addons/detail/sokuji-aipowered-live-/dcmmcdkeibkalgdjlahlembodjhijhkm',
      textKey: 'edgeAddons'
    };
  } else {
    return {
      url: 'https://chromewebstore.google.com/detail/ppmihnhelgfpjomhjhpecobloelicnak',
      textKey: 'chromeWebStore'
    };
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Initialize PostHog first
    initializePostHog();
    
    // Initialize localization
    initializeLocalization();
    
    // Initialize popup
    await initializePopup();
  } catch (error) {
    console.error('[Sokuji] [Popup] Error initializing popup:', error);
    showErrorState();
  }
});

// Initialize localization for static elements
function initializeLocalization() {
  // Update title
  document.title = getMessage('popupTitle');
  
  // Update elements with data-i18n attributes
  const elementsToLocalize = document.querySelectorAll('[data-i18n]');
  elementsToLocalize.forEach(element => {
    const key = element.getAttribute('data-i18n');
    element.textContent = getMessage(key);
  });
  
  // Update store link with appropriate text and URL
  const storeLink = document.getElementById('storeLink');
  if (storeLink) {
    const storeInfo = getStoreInfo();
    storeLink.href = storeInfo.url;
    storeLink.textContent = getMessage(storeInfo.textKey);
  }
}

async function initializePopup() {
  // Get current tab information
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab || !tab.url) {
    showErrorState();
    
    // Track popup opened on error state
    trackEvent('popup_opened', {
      is_supported_site: false,
      hostname: null,
      error_type: 'no_tab_info'
    });
    return;
  }

  const url = new URL(tab.url);
  const hostname = url.hostname;
  
  // Check if current site is supported
  const isSupported = ENABLED_SITES.some(site => 
    hostname === site || hostname.endsWith('.' + site)
  );

  // Track popup opened event
  trackEvent('popup_opened', {
    is_supported_site: isSupported,
    hostname: hostname,
    full_url: url.origin,
    browser_type: detectBrowser(),
    supported_site_match: isSupported ? ENABLED_SITES.find(site => 
      hostname === site || hostname.endsWith('.' + site)
    ) : null
  });

  if (isSupported) {
    showSupportedState(hostname);
  } else {
    showUnsupportedState(hostname);
  }

  // Set up event listeners
  setupEventListeners(tab.id, isSupported);
}

function showSupportedState(hostname) {
  const content = document.getElementById('content');
  const openButton = document.getElementById('openSidePanel');
  
  const siteInfo = SITE_INFO[hostname] || { name: hostname, icon: '' };
  
  // Track supported state shown
  trackEvent('popup_supported_state_shown', {
    hostname: hostname,
    site_name: siteInfo.name
  });
  
  content.innerHTML = `
    <div class="status-message status-supported">
      <strong>${getMessage('sokujiAvailable', [siteInfo.name])}</strong><br>
      ${getMessage('clickToStart')}
    </div>
    
    <div class="instructions">
      <p><strong>${getMessage('quickStart')}</strong> ${getMessage('quickStartInstructions')}</p>
    </div>
  `;
  
  openButton.style.display = 'block';
}

function showUnsupportedState(hostname) {
  const content = document.getElementById('content');
  
  // Track unsupported state shown
  trackEvent('popup_unsupported_state_shown', {
    hostname: hostname,
    supported_sites_count: ENABLED_SITES.length
  });
  
  content.innerHTML = `
    <div class="status-message status-unsupported">
      <strong>${getMessage('notSupported')}</strong><br>
      ${getMessage('currentlyOn', [`<code>${hostname}</code>`])}
    </div>
    
    <div class="supported-sites">
      <ul class="sites-list">
        ${ENABLED_SITES.map(site => {
          const info = SITE_INFO[site];
          return `
            <li class="site-item">
              <img src="${info.icon}" alt="${info.name}" class="site-icon" onerror="this.style.display='none'">
              <div class="site-info">
                <div class="site-name">${info.name}</div>
                <div class="site-url">${site}</div>
              </div>
            </li>
          `;
        }).join('')}
      </ul>
    </div>
    
    <div class="instructions">
      <p><strong>${getMessage('needMoreSites')}</strong> ${getMessage('contactUs')} <a href="mailto:support@kizuna.ai" target="_blank">support@kizuna.ai</a> ${getMessage('contributeCode')} <a href="https://github.com/kizuna-ai-lab/sokuji" target="_blank">${getMessage('openSourceProject')}</a>.</p>
    </div>
  `;
}

function showErrorState() {
  const content = document.getElementById('content');
  
  // Track error state shown
  trackEvent('popup_error_state_shown', {
    error_type: 'unable_to_detect_site'
  });
  
  content.innerHTML = `
    <div class="status-message status-unsupported">
      <strong>${getMessage('unableToDetect')}</strong><br>
      ${getMessage('refreshAndTry')}
    </div>
    
    <div class="supported-sites">
      <ul class="sites-list">
        ${ENABLED_SITES.map(site => {
          const info = SITE_INFO[site];
          return `
            <li class="site-item">
              <img src="${info.icon}" alt="${info.name}" class="site-icon" onerror="this.style.display='none'">
              <div class="site-info">
                <div class="site-name">${info.name}</div>
                <div class="site-url">${site}</div>
              </div>
            </li>
          `;
        }).join('')}
      </ul>
    </div>
    
    <div class="instructions">
      <p><strong>${getMessage('needMoreSitesShort')}</strong> <a href="mailto:support@kizuna.ai" target="_blank">${getMessage('contactUsShort')}</a> ${getMessage('contributeCode')} <a href="https://github.com/kizuna-ai-lab/sokuji" target="_blank">${getMessage('contributeCodeShort')}</a>.</p>
    </div>
  `;
}

function setupEventListeners(tabId, isSupported) {
  const openButton = document.getElementById('openSidePanel');
  
  if (isSupported && openButton) {
    openButton.addEventListener('click', async () => {
      // Track open side panel clicked
      trackEvent('popup_open_sidepanel_clicked', {
        tab_id: tabId,
        is_supported_site: isSupported
      });
      
      try {
        // Open the side panel for the current tab
        await chrome.sidePanel.open({ tabId: tabId });
        
        // Track successful side panel open
        trackEvent('sidepanel_opened_from_popup', {
          tab_id: tabId,
          method: 'direct_api'
        });
        
        // Close the popup
        window.close();
      } catch (error) {
        console.error('[Sokuji] [Popup] Error opening side panel:', error);
        
        // Track side panel open error
        trackEvent('sidepanel_open_error', {
          tab_id: tabId,
          error_type: 'direct_api_failed',
          error_message: error.message
        });
        
        // Fallback: try to send a message to background script
        try {
          await chrome.runtime.sendMessage({
            type: 'OPEN_SIDE_PANEL',
            tabId: tabId
          });
          
          // Track successful fallback
          trackEvent('sidepanel_opened_from_popup', {
            tab_id: tabId,
            method: 'background_message'
          });
          
          window.close();
        } catch (fallbackError) {
          console.error('[Sokuji] [Popup] Fallback failed:', fallbackError);
          
          // Track fallback error
          trackEvent('sidepanel_open_error', {
            tab_id: tabId,
            error_type: 'background_message_failed',
            error_message: fallbackError.message
          });
          
          alert('Unable to open Sokuji. Please try refreshing the page.');
        }
      }
    });
  }

  // Handle site item clicks (navigate to supported sites)
  const siteItems = document.querySelectorAll('.site-item');
  siteItems.forEach(item => {
    item.addEventListener('click', () => {
      const siteUrl = item.querySelector('.site-url').textContent;
      const siteName = item.querySelector('.site-name').textContent;
      
      // Track site navigation
      trackEvent('popup_site_navigation_clicked', {
        target_site: siteUrl,
        target_site_name: siteName,
        is_supported_site: isSupported
      });
      
      chrome.tabs.create({ url: `https://${siteUrl}` });
      window.close();
    });
  });

  // Handle store link clicks
  const storeLink = document.getElementById('storeLink');
  if (storeLink) {
    storeLink.addEventListener('click', () => {
      const storeInfo = getStoreInfo();
      const browser = detectBrowser();
      
      // Track store link clicked
      trackEvent('popup_store_link_clicked', {
        browser_type: browser,
        store_type: browser === 'edge' ? 'edge_addons' : 'chrome_webstore',
        store_url: storeInfo.url,
        is_supported_site: isSupported
      });
    });
  }
} 