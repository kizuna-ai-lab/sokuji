/* global chrome, browser */

// Universal content script for the Sokuji browser extension
// This script injects the core virtual microphone functionality
// and provides a plugin system for site-specific features

// Get extension URL in a browser-compatible way
function getExtensionURL(path) {
  let url = '';
  try {
    // Try Chrome API first
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      url = chrome.runtime.getURL(path);
    } 
    // Then try Firefox API
    else if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getURL) {
      url = browser.runtime.getURL(path);
    }
    // Fallback for other browsers or testing environments
    else {
      console.warn('[Sokuji] [Content] Browser extension API not available, using relative path');
      url = path;
    }
  } catch (error) {
    console.error('[Sokuji] [Content] Error getting extension URL:', error);
    url = path;
  }
  return url;
}

// Inject the virtual microphone script as early as possible
function injectVirtualMicrophoneScript() {
  // Get the URL of the script
  const scriptURL = getExtensionURL('content/virtual-microphone.js');
  
  // Create a script element
  const script = document.createElement('script');
  script.src = scriptURL;
  script.async = false; // Ensure it's loaded synchronously
  script.id = 'sokuji-virtual-microphone-script';
  
  // Insert the script as early as possible
  // Try to insert it at the beginning of the head or document
  if (document.head) {
    document.head.insertBefore(script, document.head.firstChild);
  } else if (document.documentElement) {
    // If head isn't available yet, insert at the beginning of the HTML element
    document.documentElement.insertBefore(script, document.documentElement.firstChild);
  } else {
    // Last resort: append to document
    document.appendChild(script);
  }
  
  console.info('[Sokuji] [Content] Virtual microphone script injected into page');
}

// Inject site plugins script (includes plugin initialization)
function injectSitePluginsScript() {
  // Get i18n messages for plugins
  const i18nMessages = {
    gatherTownTitle: chrome.i18n.getMessage('gatherTownTitle'),
    gatherTownGuidance: chrome.i18n.getMessage('gatherTownGuidance'),
    gotIt: chrome.i18n.getMessage('gotIt'),
    remindLater: chrome.i18n.getMessage('remindLater')
  };
  
  // Safely encode i18n messages using Base64 to handle all Unicode characters
  const i18nParams = new URLSearchParams();
  for (const [key, value] of Object.entries(i18nMessages)) {
    if (value) {
      try {
        // Use Base64 encoding to safely handle all Unicode characters
        const encodedValue = btoa(unescape(encodeURIComponent(value)));
        i18nParams.set(key, encodedValue);
      } catch (error) {
        console.warn(`[Sokuji] [Content] Failed to encode i18n message for ${key}:`, error);
        // Fallback to direct encoding if Base64 fails
        i18nParams.set(key, encodeURIComponent(value));
      }
    }
  }
  
  // Get the URL of the site plugins script with i18n parameters
  const baseScriptURL = getExtensionURL('content/site-plugins.js');
  const scriptURL = `${baseScriptURL}?${i18nParams.toString()}`;
  
  // Create a script element
  const script = document.createElement('script');
  script.src = scriptURL;
  script.async = false;
  script.id = 'sokuji-site-plugins-script';
  
  // Insert the script
  if (document.head) {
    document.head.appendChild(script);
  } else if (document.documentElement) {
    document.documentElement.appendChild(script);
  } else {
    document.appendChild(script);
  }
  
  console.info('[Sokuji] [Content] Site plugins script injected into page with i18n parameters (Base64 encoded)');
}

// Function to inject permission iframe
function injectPermissionIframe() {
  // Check if an iframe with this ID already exists
  const existingIframe = document.getElementById('sokujiPermissionsIFrame');
  if (existingIframe) {
    // Remove it if it exists
    existingIframe.remove();
  }

  // Create a hidden iframe to request permission
  const iframe = document.createElement('iframe');
  iframe.hidden = true;
  iframe.id = 'sokujiPermissionsIFrame';
  iframe.allow = 'microphone';
  iframe.src = getExtensionURL('permission.html');
  
  // Remove the iframe after a delay to avoid keeping it in the DOM
  setTimeout(() => {
    if (iframe && iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  }, 5000); // 5 second timeout should be enough for the permission request
  
  // Append the iframe to the document body or other available parent
  if (document.body) {
    document.body.appendChild(iframe);
  } else if (document.documentElement) {
    document.documentElement.appendChild(iframe);
  } else {
    console.error('[Sokuji] [Content] Cannot inject permission iframe - no suitable parent element found');
    return; // Exit the function if we can't inject the iframe
  }
  
  console.info('[Sokuji] [Content] Permission iframe injected into page');
}

// Run script injections immediately (before DOMContentLoaded)
injectVirtualMicrophoneScript();
injectSitePluginsScript();

// Wait for DOM to be ready before injecting permission iframe
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  // If DOM is already ready, inject immediately
  injectPermissionIframe();
} else {
  // Otherwise wait for DOMContentLoaded
  document.addEventListener('DOMContentLoaded', injectPermissionIframe);
}

// Listen for messages from the extension side panel script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle new PCM_DATA message
  if (message.type === 'PCM_DATA') {
    console.debug(`[Sokuji] [Content] Received PCM data from side panel script: chunk ${message.chunkIndex + 1}/${message.totalChunks}`);
    
    // Forward PCM data to page's virtual microphone with same format
    window.postMessage(message, '*');
    
    // Acknowledge receipt
    if (sendResponse) {
      sendResponse({ success: true });
    }
    return true; // Keep message channel open for async response
  }
  
  return false;
});

// Content script loaded
console.info('[Sokuji] [Content] Universal content script loaded and ready for audio bridging');

// Expose API for debugging in content script context
window.sokujiContentScript = {
  version: '2.0.0',
  context: 'content',
  getStatus: () => ({
    initialized: true,
    context: 'content',
    canInjectScripts: true,
    permissionIframeInjected: !!document.getElementById('sokujiPermissionsIFrame'),
    virtualMicScriptInjected: !!document.getElementById('sokuji-virtual-microphone-script'),
    pluginsScriptInjected: !!document.getElementById('sokuji-site-plugins-script')
  }),
  // Helper function to check page context status
  getPageContextStatus: () => {
    // Try to access page context API
    try {
      const pageContext = window.wrappedJSObject ? window.wrappedJSObject.sokujiPageContext : null;
      return pageContext ? pageContext.getStatus() : { error: 'Page context not accessible from content script' };
    } catch (e) {
      return { error: 'Cannot access page context: ' + e.message };
    }
  },
  // Helper function to get i18n messages (for debugging)
  getI18nMessages: () => {
    try {
      return {
        gatherTownTitle: chrome.i18n.getMessage('gatherTownTitle'),
        gatherTownGuidance: chrome.i18n.getMessage('gatherTownGuidance'),
        gotIt: chrome.i18n.getMessage('gotIt'),
        remindLater: chrome.i18n.getMessage('remindLater')
      };
    } catch (e) {
      return { error: 'Cannot access i18n messages: ' + e.message };
    }
  }
};