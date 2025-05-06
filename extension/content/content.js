/* global chrome, browser */

// Content script for the Sokuji browser extension
// This script injects the UI elements and the code to override mediaDevices methods

// UI Elements
let sokujiIframe = null;
let toggleButton = null;
let isExpanded = false;

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

// Create and insert the Sokuji iframe
function createSokujiIframe() {
  // Create iframe element
  sokujiIframe = document.createElement('iframe');
  sokujiIframe.id = 'sokuji-iframe';
  sokujiIframe.src = getExtensionURL('fullpage.html');
  
  // Add permissions for microphone access
  sokujiIframe.allow = "microphone *; camera *";
  
  // Set iframe styles
  Object.assign(sokujiIframe.style, {
    position: 'fixed',
    top: '0',
    right: '0',
    width: '400px',
    height: '100%',
    zIndex: '9999',
    border: 'none',
    boxShadow: '-2px 0 5px rgba(0,0,0,0.3)',
    transition: 'transform 0.3s ease-in-out',
    transform: 'translateX(100%)', // Start hidden
    backgroundColor: '#ffffff'
  });
  
  // Add iframe to the page
  document.body.appendChild(sokujiIframe);
  
  console.log('[Sokuji] Iframe created and inserted');
  return sokujiIframe;
}

// Create toggle button
function createToggleButton() {
  // Create button element
  toggleButton = document.createElement('div');
  toggleButton.id = 'sokuji-toggle';
  
  // Set button styles
  Object.assign(toggleButton.style, {
    position: 'fixed',
    top: '20px',
    right: '0',
    width: '40px',
    height: '40px',
    backgroundColor: '#4285f4',
    borderRadius: '4px 0 0 4px',
    cursor: 'pointer',
    zIndex: '10000',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    boxShadow: '-2px 0 5px rgba(0,0,0,0.2)',
    transition: 'right 0.3s ease-in-out'
  });
  
  // Add icon to button
  toggleButton.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  `;
  
  // Add click event listener
  toggleButton.addEventListener('click', toggleSokujiPanel);
  
  // Add button to the page
  document.body.appendChild(toggleButton);
  
  console.log('[Sokuji] Toggle button created and inserted');
  return toggleButton;
}

// Toggle Sokuji panel visibility
function toggleSokujiPanel() {
  if (!sokujiIframe) {
    console.error('[Sokuji] Iframe not found');
    return;
  }
  
  isExpanded = !isExpanded;
  
  if (isExpanded) {
    // Show iframe
    sokujiIframe.style.transform = 'translateX(0)';
    // Update toggle button icon and position
    toggleButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    `;
    toggleButton.style.right = '400px';
  } else {
    // Hide iframe
    sokujiIframe.style.transform = 'translateX(100%)';
    // Update toggle button icon and position
    toggleButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
    `;
    toggleButton.style.right = '0';
  }
  
  console.log(`[Sokuji] Panel ${isExpanded ? 'expanded' : 'collapsed'}`);
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

// Initialize UI elements when the page loads
window.addEventListener('load', () => {
  console.log('[Sokuji] Content script loaded');
  
  // Create UI elements
  createSokujiIframe();
  createToggleButton();
});

// Expose API for debugging
window.sokujiContentScript = {
  togglePanel: toggleSokujiPanel
};