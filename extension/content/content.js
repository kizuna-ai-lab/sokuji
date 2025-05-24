/* global chrome, browser */

// Content script for the Sokuji browser extension
// This script injects the code to override mediaDevices methods
// and communicates with the side panel

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
      console.warn('[Sokuji] Browser extension API not available, using relative path');
      url = path;
    }
  } catch (error) {
    console.error('[Sokuji] Error getting extension URL:', error);
    url = path;
  }
  return url;
}

// Inject the virtual microphone script as early as possible
function injectVirtualMicrophoneScript() {
  // Get the URL of the script
  const scriptURL = getExtensionURL('virtual-microphone.js');
  
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
  
  console.info('[Sokuji] Virtual microphone script injected into page');
}

// Run script injection immediately (before DOMContentLoaded)
injectVirtualMicrophoneScript();

// Wait for DOM to be ready before injecting permission iframe
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  // If DOM is already ready, inject immediately
  injectPermissionIframe();
} else {
  // Otherwise wait for DOMContentLoaded
  document.addEventListener('DOMContentLoaded', injectPermissionIframe);
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
    console.error('[Sokuji] Cannot inject permission iframe - no suitable parent element found');
    return; // Exit the function if we can't inject the iframe
  }
  
  console.info('[Sokuji] Permission iframe injected into page');
}

// Listen for messages from the extension side panel script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle new PCM_DATA message
  if (message.type === 'PCM_DATA') {
    console.debug(`[Sokuji] Received PCM data from side panel script: chunk ${message.chunkIndex + 1}/${message.totalChunks}`);
    
    // Forward PCM data to page's virtual microphone with same format
    window.postMessage(message, '*');
    
    // Acknowledge receipt
    if (sendResponse) {
      sendResponse({ success: true });
    }
    return true; // Keep message channel open for async response
  }
  
  // Handle virtual mic enabled/disabled message
  if (message.type === 'VIRTUAL_MIC_ENABLED') {
    console.log('[Sokuji] Virtual microphone ' + (message.enabled ? 'enabled' : 'disabled'));
    
    // Forward mic state to the page
    window.postMessage({
      type: 'VIRTUAL_MIC_STATE',
      enabled: message.enabled
    }, '*');
    
    if (sendResponse) {
      sendResponse({ success: true });
    }
    return true;
  }
  
  return false;
});

// Listen for messages from the page context
// window.addEventListener('message', (event) => {
//   // Only handle messages from the same window
//   if (event.source !== window) return;
  
//   // // Handle messages from the injected script
//   // if (event.data && event.data.source === 'SOKUJI_VIRTUAL_MIC') {
//   //   // Forward messages to the extension background script
//   //   if (chrome.runtime && chrome.runtime.sendMessage) {
//   //     chrome.runtime.sendMessage(event.data);
//   //   }
//   // }
  
//   // Handle virtual mic status updates
//   if (event.data && event.data.type === 'VIRTUAL_MIC_STATUS') {
//     console.log('[Sokuji] Virtual microphone status:', event.data.active);
    
//     // Forward status to background script
//     if (chrome.runtime && chrome.runtime.sendMessage) {
//       chrome.runtime.sendMessage({
//         type: 'VIRTUAL_MIC_STATUS',
//         active: event.data.active
//       });
//     }
//   }
// });

// Content script loaded
console.info('[Sokuji] Content script loaded and ready for audio bridging');

// Expose API for debugging
window.sokujiContentScript = {
  version: '1.0.0',
  getStatus: () => ({
    initialized: true,
    hasVirtualMic: !!window.sokujiVirtualMic,
    canInjectAudio: true
  })
};