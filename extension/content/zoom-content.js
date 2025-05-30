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

// Determine if we're in the webclient iframe
const isWebclientIframe = window !== window.top && window.self.frameElement && window.self.frameElement.id === 'webclient';

console.info(`[Sokuji] [Zoom] Initializing: isWebclientIframe=${isWebclientIframe}`);

// Only proceed if we're in the webclient iframe
if (!isWebclientIframe) {
  console.info('[Sokuji] [Zoom] Not in webclient iframe, exiting');
  // Exit early if not in webclient iframe
} else {
  // Inject the virtual microphone script as early as possible
  function injectVirtualMicrophoneScript() {
    // Get the URL of the script
    const scriptURL = getExtensionURL('virtual-microphone.js');
    
    // Create a script element
    const script = document.createElement('script');
    script.src = scriptURL;
    script.async = false; // Ensure it's loaded synchronously
    script.id = 'sokuji-virtual-microphone-script';
    
    // Inject directly into the webclient iframe
    if (document.head) {
      document.head.insertBefore(script, document.head.firstChild);
    } else if (document.documentElement) {
      document.documentElement.insertBefore(script, document.documentElement.firstChild);
    } else {
      document.appendChild(script);
    }
    console.info('[Sokuji] [Zoom] Virtual microphone script injected into Zoom webclient iframe');
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
      console.error('[Sokuji] [Zoom] Cannot inject permission iframe - no suitable parent element found');
      return; // Exit the function if we can't inject the iframe
    }
    
    console.info('[Sokuji] [Zoom] Permission iframe injected into page');
  }

  // Function to show Audio Profile settings notification
  function showAudioProfileNotification() {
    console.log('showAudioProfileNotification');
    // Check if notification already exists
    const existingNotification = document.getElementById('sokuji-zoom-audio-profile-notification');
    if (existingNotification) {
      return; // Notification already shown
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.id = 'sokuji-zoom-audio-profile-notification';
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      max-width: 350px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.4;
      border: 1px solid rgba(255, 255, 255, 0.2);
    `;

    // Create notification content
    notification.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <div style="flex-shrink: 0; margin-top: 2px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
          </svg>
        </div>
        <div style="flex: 1;">
          <div style="font-weight: 600; margin-bottom: 8px; color: #fff;">
            Sokuji Audio Settings Recommendation
          </div>
          <div style="margin-bottom: 12px; color: rgba(255, 255, 255, 0.9);">
            For optimal audio quality, please set <strong>Background noise suppression</strong> to <strong>"Browser built-in noise suppression"</strong> in your Audio Profile settings. This prevents audio stuttering and ensures smooth transmission.
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button id="sokuji-zoom-audio-profile-dismiss" style="
              background: rgba(255, 255, 255, 0.2);
              border: 1px solid rgba(255, 255, 255, 0.3);
              color: white;
              padding: 6px 12px;
              border-radius: 4px;
              font-size: 12px;
              cursor: pointer;
              transition: all 0.2s ease;
            ">
              Got it
            </button>
            <button id="sokuji-zoom-audio-profile-remind-later" style="
              background: transparent;
              border: none;
              color: rgba(255, 255, 255, 0.7);
              padding: 6px 8px;
              font-size: 12px;
              cursor: pointer;
              text-decoration: underline;
              transition: color 0.2s ease;
            ">
              Remind me later
            </button>
          </div>
        </div>
      </div>
    `;

    // Add event listeners for buttons
    const dismissBtn = notification.querySelector('#sokuji-zoom-audio-profile-dismiss');
    const remindLaterBtn = notification.querySelector('#sokuji-zoom-audio-profile-remind-later');

    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        notification.remove();
        // Store dismissal in localStorage to not show again for this session
        try {
          localStorage.setItem('sokuji-zoom-audio-profile-dismissed', 'true');
        } catch (e) {
          console.warn('[Sokuji] [Zoom] Could not store dismissal state:', e);
        }
      });

      // Add hover effect
      dismissBtn.addEventListener('mouseenter', () => {
        dismissBtn.style.background = 'rgba(255, 255, 255, 0.3)';
      });
      dismissBtn.addEventListener('mouseleave', () => {
        dismissBtn.style.background = 'rgba(255, 255, 255, 0.2)';
      });
    }

    if (remindLaterBtn) {
      remindLaterBtn.addEventListener('click', () => {
        notification.remove();
        // Show again after 10 minutes
        setTimeout(() => {
          showAudioProfileNotification();
        }, 10 * 60 * 1000); // 10 minutes
      });

      // Add hover effect
      remindLaterBtn.addEventListener('mouseenter', () => {
        remindLaterBtn.style.color = 'rgba(255, 255, 255, 1)';
      });
      remindLaterBtn.addEventListener('mouseleave', () => {
        remindLaterBtn.style.color = 'rgba(255, 255, 255, 0.7)';
      });
    }

    // Auto-dismiss after 30 seconds if no interaction
    const autoDismissTimer = setTimeout(() => {
      if (notification && notification.parentNode) {
        notification.remove();
      }
    }, 30000);

    // Clear auto-dismiss timer if user interacts with notification
    notification.addEventListener('click', () => {
      clearTimeout(autoDismissTimer);
    });

    // Append notification to the document body or other available parent
    if (document.body) {
      document.body.appendChild(notification);
    } else if (document.documentElement) {
      document.documentElement.appendChild(notification);
    } else {
      console.error('[Sokuji] [Zoom] Cannot show audio profile notification - no suitable parent element found');
      return;
    }

    console.info('[Sokuji] [Zoom] Audio profile notification shown');
  }

  // Run script injection immediately (before DOMContentLoaded)
  injectVirtualMicrophoneScript();

  // Wait for DOM to be ready before injecting permission iframe
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // If DOM is already ready, inject immediately
    injectPermissionIframe();
    // Start monitoring microphone selection
    monitorMicrophoneSelection();
    // Show audio profile notification after a short delay
    setTimeout(() => {
      // Check if notification was already dismissed in this session
      try {
        const dismissed = localStorage.getItem('sokuji-zoom-audio-profile-dismissed');
        if (!dismissed) {
          showAudioProfileNotification();
        }
      } catch (e) {
        // If localStorage is not available, show notification anyway
        showAudioProfileNotification();
      }
    }, 3000); // 3 second delay to let Zoom load
  } else {
    // Otherwise wait for DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
      injectPermissionIframe();
      // Start monitoring microphone selection
      monitorMicrophoneSelection();
      // Show audio profile notification after a short delay
      setTimeout(() => {
        // Check if notification was already dismissed in this session
        try {
          const dismissed = localStorage.getItem('sokuji-zoom-audio-profile-dismissed');
          if (!dismissed) {
            showAudioProfileNotification();
          }
        } catch (e) {
          // If localStorage is not available, show notification anyway
          showAudioProfileNotification();
        }
      }, 3000); // 3 second delay to let Zoom load
    });
  }

  // Listen for messages from the extension side panel script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle new PCM_DATA message
    if (message.type === 'PCM_DATA') {
      console.debug(`[Sokuji] [Zoom] Received PCM data from side panel script: chunk ${message.chunkIndex + 1}/${message.totalChunks}`);
      
      // Post message directly to this window (webclient iframe)
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
  console.info('[Sokuji] [Zoom] Zoom-specific content script loaded and ready for audio bridging');

  // Expose API for debugging
  window.sokujiZoomContent = {
    version: '1.0.0',
    getStatus: () => ({
      initialized: true,
      isWebclientIframe,
      hasVirtualMic: !!window.sokujiVirtualMic,
      canInjectAudio: true,
      microphoneMonitorActive: true,
      audioProfileNotificationDismissed: (() => {
        try {
          return localStorage.getItem('sokuji-zoom-audio-profile-dismissed') === 'true';
        } catch (e) {
          return false;
        }
      })()
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
    },
    // Helper function to manually show audio profile notification
    showAudioProfileNotification: () => {
      showAudioProfileNotification();
    },
    // Helper function to reset audio profile notification dismissal
    resetAudioProfileNotificationDismissal: () => {
      try {
        localStorage.removeItem('sokuji-zoom-audio-profile-dismissed');
        return { success: true, message: 'Audio profile notification dismissal reset' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  };
} 