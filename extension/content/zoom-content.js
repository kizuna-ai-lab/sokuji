/* global chrome, browser */

// Content script specifically for Zoom web client
// This script focuses on injecting the virtual microphone into the webclient iframe

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
      console.warn('[Sokuji] [Zoom] Browser extension API not available, using relative path');
      url = path;
    }
  } catch (error) {
    console.error('[Sokuji] [Zoom] Error getting extension URL:', error);
    url = path;
  }
  return url;
}

// Determine if we're in the main page or the webclient iframe
const isWebclientIframe = window !== window.top && window.self.frameElement && window.self.frameElement.id === 'webclient';
const isMainZoomPage = window === window.top && window.location.href.includes('app.zoom.us');

console.info(`[Sokuji] [Zoom] Initializing: isWebclientIframe=${isWebclientIframe}, isMainZoomPage=${isMainZoomPage}`);

// Inject the virtual microphone script as early as possible
function injectVirtualMicrophoneScript() {
  // Get the URL of the script
  const scriptURL = getExtensionURL('virtual-microphone.js');
  
  // Create a script element
  const script = document.createElement('script');
  script.src = scriptURL;
  script.async = false; // Ensure it's loaded synchronously
  script.id = 'sokuji-virtual-microphone-script';
  
  // Only inject into the webclient iframe or in case we are already in it
  if (isWebclientIframe) {
    // We're already in the webclient iframe, inject directly
    if (document.head) {
      document.head.insertBefore(script, document.head.firstChild);
    } else if (document.documentElement) {
      document.documentElement.insertBefore(script, document.documentElement.firstChild);
    } else {
      document.appendChild(script);
    }
    console.info('[Sokuji] [Zoom] Virtual microphone script injected into Zoom webclient iframe');
  } else if (isMainZoomPage) {
    // We're in the main page, set up observer to wait for the webclient iframe
    console.info('[Sokuji] [Zoom] Detected Zoom main page, waiting for webclient iframe...');
    
    // Function to wait for and inject into the webclient iframe
    const injectIntoWebclientIframe = () => {
      const webclientIframe = document.getElementById('webclient');
      if (webclientIframe && webclientIframe.contentDocument) {
        try {
          // Try to inject into the iframe's document
          if (webclientIframe.contentDocument.head) {
            webclientIframe.contentDocument.head.insertBefore(
              script.cloneNode(true), 
              webclientIframe.contentDocument.head.firstChild
            );
            console.info('[Sokuji] [Zoom] Virtual microphone script injected into Zoom webclient iframe from main page');
            return true;
          }
        } catch (e) {
          console.error('[Sokuji] [Zoom] Error injecting into Zoom webclient iframe:', e);
        }
      }
      return false;
    };
    
    // Try immediately
    if (!injectIntoWebclientIframe()) {
      // Set up a MutationObserver to watch for the iframe to be added
      const observer = new MutationObserver((mutations) => {
        if (injectIntoWebclientIframe()) {
          observer.disconnect();
        }
      });
      
      observer.observe(document.documentElement, { 
        childList: true, 
        subtree: true 
      });
      
      // Also try again after a short delay as backup
      setTimeout(() => {
        if (injectIntoWebclientIframe()) {
          observer.disconnect();
        }
      }, 2000);
    }
  }
}

// Function to monitor and auto-select Sokuji Virtual Microphone
function monitorMicrophoneSelection() {
  // Function to check and update microphone selection
  function checkAndUpdateMicSelection() {
    // Find the audio option menu dropdown
    const audioMenu = document.querySelector('.audio-option-menu__pop-menu');
    if (!audioMenu) {
      return; // Menu not visible, nothing to do
    }

    // Find all microphone items (items between "Select a Microphone" and first divider)
    const microphoneHeader = Array.from(audioMenu.querySelectorAll('.dropdown-header'))
      .find(header => header.textContent.includes('Select a Microphone'));
    
    if (!microphoneHeader) {
      return; // Microphone section not found
    }

    // Get all microphone dropdown items
    const microphoneItems = [];
    let currentElement = microphoneHeader.nextElementSibling;
    
    while (currentElement && !currentElement.classList.contains('common-ui-component__dropdown-divider')) {
      if (currentElement.classList.contains('dropdown-item') && 
          currentElement.getAttribute('aria-label')?.includes('Select a microphone')) {
        microphoneItems.push(currentElement);
      }
      currentElement = currentElement.nextElementSibling;
    }

    // Check if any microphone is currently selected
    const hasSelectedMicrophone = microphoneItems.some(item => 
      item.classList.contains('audio-option-menu__pop-menu--checked')
    );

    // Find our Sokuji Virtual Microphone item
    const sokujiMicItem = microphoneItems.find(item => 
      item.textContent.includes('Sokuji Virtual Microphone')
    );

    if (!hasSelectedMicrophone && sokujiMicItem) {
      // No microphone is selected, auto-select our virtual microphone
      console.info('[Sokuji] [Zoom] No microphone selected, auto-selecting Sokuji Virtual Microphone');
      
      // Remove checked class from all microphone items (just in case)
      microphoneItems.forEach(item => {
        item.classList.remove('audio-option-menu__pop-menu--checked');
        item.setAttribute('aria-selected', 'false');
        item.setAttribute('aria-label', item.getAttribute('aria-label')?.replace(' selected', ' unselect') || '');
      });

      // Add checked class to our virtual microphone
      sokujiMicItem.classList.add('audio-option-menu__pop-menu--checked');
      sokujiMicItem.setAttribute('aria-selected', 'true');
      sokujiMicItem.setAttribute('aria-label', 
        sokujiMicItem.getAttribute('aria-label')?.replace(' unselect', ' selected') || ''
      );
    } else if (hasSelectedMicrophone && sokujiMicItem) {
      // Another microphone is selected, ensure our virtual microphone is not checked
      const isSokujiSelected = sokujiMicItem.classList.contains('audio-option-menu__pop-menu--checked');
      const otherMicSelected = microphoneItems.some(item => 
        item !== sokujiMicItem && item.classList.contains('audio-option-menu__pop-menu--checked')
      );

      if (isSokujiSelected && otherMicSelected) {
        // Both our mic and another mic are selected, uncheck ours
        console.info('[Sokuji] [Zoom] Another microphone is selected, unchecking Sokuji Virtual Microphone');
        sokujiMicItem.classList.remove('audio-option-menu__pop-menu--checked');
        sokujiMicItem.setAttribute('aria-selected', 'false');
        sokujiMicItem.setAttribute('aria-label', 
          sokujiMicItem.getAttribute('aria-label')?.replace(' selected', ' unselect') || ''
        );
      }
    }
  }

  // Set up a MutationObserver to watch for changes in the DOM
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      // Check if any nodes were added that might be the audio menu
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node is or contains the audio menu
            if (node.classList?.contains('audio-option-menu__pop-menu') ||
                node.querySelector?.('.audio-option-menu__pop-menu')) {
              setTimeout(checkAndUpdateMicSelection, 100);
            }
          }
        });
      }
      
      // Also check for attribute changes that might indicate menu visibility
      if (mutation.type === 'attributes' && 
          mutation.target.classList?.contains('audio-option-menu__pop-menu')) {
        setTimeout(checkAndUpdateMicSelection, 100);
      }
    });
  });

  // Start observing
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  });

  // Also run a periodic check as backup
  setInterval(checkAndUpdateMicSelection, 2000);

  console.info('[Sokuji] [Zoom] Microphone selection monitor initialized');
}

// Function to inject permission iframe
function injectPermissionIframe() {
  // Only inject permissions in the webclient iframe or directly if we're in it
  if (isWebclientIframe) {
    // We're already in the webclient iframe, inject directly
    injectPermissionIframeIntoDocument(document);
  } else if (isMainZoomPage) {
    // Check if webclient iframe exists
    const webclientIframe = document.getElementById('webclient');
    if (webclientIframe && webclientIframe.contentDocument) {
      try {
        // Try to inject permission iframe into the Zoom webclient iframe
        injectPermissionIframeIntoDocument(webclientIframe.contentDocument);
      } catch (e) {
        console.error('[Sokuji] [Zoom] Error injecting permission iframe into Zoom webclient:', e);
      }
    } else {
      // Set up an observer to wait for the webclient iframe
      const observer = new MutationObserver((mutations) => {
        const webclientIframe = document.getElementById('webclient');
        if (webclientIframe && webclientIframe.contentDocument) {
          try {
            injectPermissionIframeIntoDocument(webclientIframe.contentDocument);
            observer.disconnect();
          } catch (e) {
            console.error('[Sokuji] [Zoom] Error injecting permission iframe into Zoom webclient:', e);
          }
        }
      });
      
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  }
}

// Helper function to inject permission iframe into a specific document
function injectPermissionIframeIntoDocument(targetDocument) {
  // Check if an iframe with this ID already exists
  const existingIframe = targetDocument.getElementById('sokujiPermissionsIFrame');
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
  if (targetDocument.body) {
    targetDocument.body.appendChild(iframe);
  } else if (targetDocument.documentElement) {
    targetDocument.documentElement.appendChild(iframe);
  } else {
    console.error('[Sokuji] [Zoom] Cannot inject permission iframe - no suitable parent element found');
    return; // Exit the function if we can't inject the iframe
  }
  
  console.info('[Sokuji] [Zoom] Permission iframe injected into page');
}

// Run script injection immediately (before DOMContentLoaded)
injectVirtualMicrophoneScript();

// Wait for DOM to be ready before injecting permission iframe
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  // If DOM is already ready, inject immediately
  injectPermissionIframe();
  // Start monitoring microphone selection
  monitorMicrophoneSelection();
} else {
  // Otherwise wait for DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    injectPermissionIframe();
    // Start monitoring microphone selection
    monitorMicrophoneSelection();
  });
}

// Listen for messages from the extension side panel script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle new PCM_DATA message
  if (message.type === 'PCM_DATA') {
    console.debug(`[Sokuji] [Zoom] Received PCM data from side panel script: chunk ${message.chunkIndex + 1}/${message.totalChunks}`);
    
    if (isWebclientIframe) {
      // We're in the webclient iframe, post message directly to this window
      window.postMessage(message, '*');
    } else if (isMainZoomPage) {
      // We're in the main page, forward to the webclient iframe
      const webclientIframe = document.getElementById('webclient');
      if (webclientIframe && webclientIframe.contentWindow) {
        try {
          webclientIframe.contentWindow.postMessage(message, '*');
        } catch (e) {
          console.error('[Sokuji] [Zoom] Error forwarding PCM data to Zoom webclient iframe:', e);
        }
      } else {
        // Fallback to posting to current window just in case
        window.postMessage(message, '*');
      }
    }
    
    // Acknowledge receipt
    if (sendResponse) {
      sendResponse({ success: true });
    }
    return true; // Keep message channel open for async response
  }
  
  return false;
});

// Content script loaded
console.info('[Sokuji] [Zoom] Zoom-specific content script loaded and ready for audio bridging');

// Expose API for debugging
window.sokujiZoomContent = {
  version: '1.0.0',
  getStatus: () => ({
    initialized: true,
    isWebclientIframe,
    isMainZoomPage,
    hasVirtualMic: !!window.sokujiVirtualMic,
    canInjectAudio: true,
    microphoneMonitorActive: true
  }),
  // Helper function to manually check microphone selection
  checkMicrophoneSelection: () => {
    const audioMenu = document.querySelector('.audio-option-menu__pop-menu');
    if (!audioMenu) {
      return { status: 'menu_not_visible' };
    }
    
    const microphoneHeader = Array.from(audioMenu.querySelectorAll('.dropdown-header'))
      .find(header => header.textContent.includes('Select a Microphone'));
    
    if (!microphoneHeader) {
      return { status: 'microphone_section_not_found' };
    }

    const microphoneItems = [];
    let currentElement = microphoneHeader.nextElementSibling;
    
    while (currentElement && !currentElement.classList.contains('common-ui-component__dropdown-divider')) {
      if (currentElement.classList.contains('dropdown-item') && 
          currentElement.getAttribute('aria-label')?.includes('Select a microphone')) {
        microphoneItems.push({
          text: currentElement.textContent,
          selected: currentElement.classList.contains('audio-option-menu__pop-menu--checked'),
          ariaLabel: currentElement.getAttribute('aria-label')
        });
      }
      currentElement = currentElement.nextElementSibling;
    }

    return {
      status: 'success',
      microphoneItems,
      hasSelectedMicrophone: microphoneItems.some(item => item.selected),
      sokujiMicPresent: microphoneItems.some(item => item.text.includes('Sokuji Virtual Microphone'))
    };
  }
}; 