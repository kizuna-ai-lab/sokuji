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
  
  console.log('[Sokuji] Virtual microphone script injected into page');
}

// Run script injection immediately (before DOMContentLoaded)
injectVirtualMicrophoneScript();

// Listen for audio chunks from side panel and forward to page script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'AUDIO_CHUNK') {
    // Forward PCM data to page context
    window.postMessage({ type: 'AUDIO_CHUNK', data: message.data }, '*');
  }
});

// Content script loaded
window.addEventListener('load', () => {
  console.log('[Sokuji] Content script loaded');
});

// Expose API for debugging
window.sokujiContentScript = {
  version: '1.0.0',
  getStatus: () => ({
    hasVirtualMic: !!window.sokujiVirtualMic,
    canInjectAudio: !!window.sokujiInjectAudio
  })
};