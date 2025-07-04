/* global chrome, browser */

// Site-specific plugins for Sokuji browser extension
// This file contains plugins for different platforms to provide customized experiences

// Parse i18n messages from URL parameters
function parseI18nFromURL() {
  try {
    // Get current script element to extract URL parameters
    const currentScript = document.currentScript || 
                         document.querySelector('#sokuji-site-plugins-script') ||
                         (function() {
                           const scripts = document.querySelectorAll('script[src*="site-plugins.js"]');
                           return scripts[scripts.length - 1]; // Get the last one
                         })();
    
    if (currentScript && currentScript.src) {
      const url = new URL(currentScript.src);
      const params = url.searchParams;
      
      // Helper function to safely decode Base64 encoded messages
      function decodeMessage(encodedValue, fallback) {
        if (!encodedValue) return fallback;
        
        try {
          // Try to decode as Base64 first
          const decodedValue = decodeURIComponent(escape(atob(encodedValue)));
          return decodedValue;
        } catch (error) {
          try {
            // Fallback to direct URI decoding if Base64 fails
            return decodeURIComponent(encodedValue);
          } catch (error2) {
            console.warn('[Sokuji] [Plugins] Failed to decode i18n message, using fallback:', error2);
            return fallback;
          }
        }
      }
      
      const i18nMessages = {
        title: decodeMessage(
          params.get('title'), 
          'Sokuji'
        ),
        guidance: decodeMessage(
          params.get('guidance'), 
          'To use Sokuji, please select "Sokuji Virtual Microphone" in your microphone settings.'
        ),
        gotIt: decodeMessage(
          params.get('gotIt'), 
          'Got it'
        ),
        remindLater: decodeMessage(
          params.get('remindLater'), 
          'Remind me later'
        )
      };
      
      console.info('[Sokuji] [Plugins] i18n messages parsed from URL parameters (Base64 decoded):', i18nMessages);
      return i18nMessages;
    }
  } catch (error) {
    console.warn('[Sokuji] [Plugins] Error parsing i18n from URL parameters:', error);
  }
  
  // Fallback to default English messages
  return {
    title: 'Sokuji',
    guidance: 'To use Sokuji, please select "Sokuji Virtual Microphone" in your microphone settings.',
    gotIt: 'Got it',
    remindLater: 'Remind me later'
  };
}

// Get i18n messages and make them globally available
window.sokujiI18nMessages = parseI18nFromURL();

// ============================================================================
// Common Guidance Notification System
// ============================================================================

/**
 * Creates and shows a guidance notification for site plugins
 * @param {Object} config - Configuration object for the notification
 * @param {string} config.pluginName - Name of the plugin (e.g., 'Gather', 'Whereby')
 * @param {string} config.hostname - Hostname for localStorage key (e.g., 'app.gather.town')
 * @param {string} config.backgroundColor - CSS background gradient for the notification
 * @param {Object} config.messages - i18n messages object
 * @param {string} config.messages.title - Notification title
 * @param {string} config.messages.guidance - Guidance text
 * @param {string} config.messages.gotIt - "Got it" button text
 * @param {string} config.messages.remindLater - "Remind me later" button text
 */
function showCommonGuidanceNotification(config) {
  const {
    pluginName,
    hostname,
    backgroundColor,
    messages
  } = config;
  
  const notificationId = `sokuji-${pluginName.toLowerCase()}-audio-guidance`;
  const storageKey = `sokuji-${hostname}-guidance-dismissed`;
  
  // Check if notification already exists
  const existingNotification = document.getElementById(notificationId);
  if (existingNotification) {
    return; // Notification already shown
  }

  // Create notification element
  const notification = document.createElement('div');
  notification.id = notificationId;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${backgroundColor};
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
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <div style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 8px; color: #fff;">
          ${messages.title}
        </div>
        <div style="margin-bottom: 12px; color: rgba(255, 255, 255, 0.9);">
          ${messages.guidance}
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button data-action="dismiss" style="
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.3);
            color: white;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
          ">
            ${messages.gotIt}
          </button>
          <button data-action="remind-later" style="
            background: transparent;
            border: none;
            color: rgba(255, 255, 255, 0.7);
            padding: 6px 8px;
            font-size: 12px;
            cursor: pointer;
            text-decoration: underline;
            transition: color 0.2s ease;
          ">
            ${messages.remindLater}
          </button>
        </div>
      </div>
    </div>
  `;

  // Add event listeners for buttons
  const dismissBtn = notification.querySelector('[data-action="dismiss"]');
  const remindLaterBtn = notification.querySelector('[data-action="remind-later"]');

  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      notification.remove();
      // Store dismissal in localStorage to not show again for this session
      try {
        localStorage.setItem(storageKey, 'true');
      } catch (e) {
        console.warn(`[Sokuji] [${pluginName}] Could not store dismissal state:`, e);
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
        showCommonGuidanceNotification(config);
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
    console.error(`[Sokuji] [${pluginName}] Cannot show audio guidance - no suitable parent element found`);
    return;
  }

  console.info(`[Sokuji] [${pluginName}] ${pluginName} audio guidance notification shown`);
}

/**
 * Helper function to get debug info for a site plugin
 * @param {string} hostname - The hostname for localStorage key
 * @returns {Object} Debug information object
 */
function getPluginDebugInfo(hostname) {
  return {
    guidanceDismissed: (() => {
      try {
        return localStorage.getItem(`sokuji-${hostname}-guidance-dismissed`) === 'true';
      } catch (e) {
        return false;
      }
    })()
  };
}

/**
 * Helper function to reset guidance dismissal for a site plugin
 * @param {string} hostname - The hostname for localStorage key
 * @returns {boolean} Success status
 */
function resetPluginGuidanceDismissal(hostname) {
  try {
    localStorage.removeItem(`sokuji-${hostname}-guidance-dismissed`);
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================================
// Site Plugins
// ============================================================================

// Gather Town plugin implementation
const gatherTownPlugin = {
  name: 'Gather Town',
  hostname: 'app.gather.town',
  
  init() {
    console.info('[Sokuji] [Gather] Gather Town plugin initialized');
  },

  showGuidance(messages) {
    // Use provided messages or fallback to default English
    const i18n = messages || {
      title: 'Sokuji for Gather Town',
      guidance: 'To use Sokuji, please select "Sokuji Virtual Microphone" in your microphone settings.',
      gotIt: 'Got it',
      remindLater: 'Remind me later'
    };
    
    showCommonGuidanceNotification({
      pluginName: 'Gather',
      hostname: this.hostname,
      backgroundColor: 'linear-gradient(135deg, #6666FF 0%, #4444CC 100%)',
      messages: i18n
    });
  },

  // Helper functions for debugging
  getDebugInfo() {
    return getPluginDebugInfo(this.hostname);
  },

  resetGuidanceDismissal() {
    return resetPluginGuidanceDismissal(this.hostname);
  }
};

// Whereby plugin implementation
const wherebyPlugin = {
  name: 'Whereby',
  hostname: 'whereby.com',
  
  init() {
    console.info('[Sokuji] [Whereby] Whereby plugin initialized');
  },

  showGuidance(messages) {
    // Use provided messages or fallback to default English
    const i18n = messages || {
      title: 'Sokuji for Whereby',
      guidance: 'To use Sokuji, please select "Sokuji Virtual Microphone" in your microphone settings and disable Noise reduction for better performance.',
      gotIt: 'Got it',
      remindLater: 'Remind me later'
    };
    
    showCommonGuidanceNotification({
      pluginName: 'Whereby',
      hostname: this.hostname,
      backgroundColor: 'linear-gradient(135deg, #006654 0%, #004d40 100%)',
      messages: i18n
    });
  },

  // Helper functions for debugging
  getDebugInfo() {
    return getPluginDebugInfo(this.hostname);
  },

  resetGuidanceDismissal() {
    return resetPluginGuidanceDismissal(this.hostname);
  }
};

// Discord plugin implementation
const discordPlugin = {
  name: 'Discord',
  hostname: 'discord.com',
  
  init() {
    console.info('[Sokuji] [Discord] Discord plugin initialized');
  },

  showGuidance(messages) {
    // Use provided messages or fallback to default English
    const i18n = messages || {
      title: 'Sokuji for Discord',
      guidance: 'To use Sokuji, please select <strong>"Sokuji Virtual Microphone"</strong> in your microphone settings and <strong>disable Noise Suppression</strong> in Discord\'s Voice settings for better performance.',
      gotIt: 'Got it',
      remindLater: 'Remind me later'
    };
    
    showCommonGuidanceNotification({
      pluginName: 'Discord',
      hostname: this.hostname,
      backgroundColor: 'linear-gradient(135deg, #5865F2 0%, #4752C4 100%)',
      messages: i18n
    });
  },

  // Helper functions for debugging
  getDebugInfo() {
    return getPluginDebugInfo(this.hostname);
  },

  resetGuidanceDismissal() {
    return resetPluginGuidanceDismissal(this.hostname);
  }
};

// Slack plugin implementation
const slackPlugin = {
  name: 'Slack',
  hostname: 'app.slack.com',
  
  init() {
    console.info('[Sokuji] [Slack] Slack plugin initialized');
  },

  showGuidance(messages) {
    // Use provided messages or fallback to default English
    const i18n = messages || {
      title: 'Sokuji for Slack',
      guidance: 'To use Sokuji in Slack Huddles, please <strong>start a Huddle</strong>, then select <strong>"Sokuji Virtual Microphone"</strong> in your Video and Mic settings, and <strong>disable Noise Suppression</strong> in Audio & Video preferences for better performance.',
      gotIt: 'Got it',
      remindLater: 'Remind me later'
    };
    
    showCommonGuidanceNotification({
      pluginName: 'Slack',
      hostname: this.hostname,
      backgroundColor: 'linear-gradient(135deg, #4A154B 0%, #350d36 100%)',
      messages: i18n
    });
  },

  // Helper functions for debugging
  getDebugInfo() {
    return getPluginDebugInfo(this.hostname);
  },

  resetGuidanceDismissal() {
    return resetPluginGuidanceDismissal(this.hostname);
  }
};

// Site plugins registry - maps hostname to plugin
const sitePluginsRegistry = {
  'app.gather.town': gatherTownPlugin,
  'whereby.com': wherebyPlugin,
  'discord.com': discordPlugin,
  'app.slack.com': slackPlugin
  // Add more site plugins here as needed
  // 'meet.google.com': googleMeetPlugin,
  // 'teams.live.com': teamsPlugin,
  // etc.
};

// Load only the plugin for current site
function loadCurrentSitePlugin() {
  const currentHostname = window.location.hostname;
  const plugin = sitePluginsRegistry[currentHostname];
  
  if (plugin) {
    window.sokujiSitePlugin = plugin;
    console.info('[Sokuji] [Plugins] Loaded plugin for current site:', plugin.name, '(' + currentHostname + ')');
  } else {
    window.sokujiSitePlugin = null;
    console.info('[Sokuji] [Plugins] No specific plugin found for current site:', currentHostname);
  }
  
  return window.sokujiSitePlugin;
}

// Load the plugin for current site
loadCurrentSitePlugin();

// ============================================================================
// Plugin Initialization System
// ============================================================================

(function() {
  console.info('[Sokuji] [Page] Plugin initialization script running in page context');
  
  // Detect current site
  function getCurrentSite() {
    return window.location.hostname;
  }
  
  // Initialize site-specific plugin
  function initSitePlugin() {
    const currentSite = getCurrentSite();
    
    // Check if plugin is loaded
    if (window.sokujiSitePlugin === undefined) {
      console.warn('[Sokuji] [Page] Site plugin not loaded yet, retrying...');
      setTimeout(initSitePlugin, 100);
      return;
    }
    
    // Check if i18n messages are loaded
    if (!window.sokujiI18nMessages) {
      console.warn('[Sokuji] [Page] i18n messages not loaded yet, retrying...');
      setTimeout(initSitePlugin, 100);
      return;
    }
    
    const plugin = window.sokujiSitePlugin;
    
    if (plugin) {
      console.info('[Sokuji] [Page] Initializing ' + plugin.name + ' plugin for ' + currentSite);
      try {
        plugin.init();
        if (plugin.monitorAudio) {
          plugin.monitorAudio();
        }
        if (plugin.showGuidance) {
          // Show guidance after a delay to let the site load
          setTimeout(function() {
            // Check if notification was already dismissed in this session
            try {
              const dismissed = localStorage.getItem('sokuji-' + currentSite + '-guidance-dismissed');
              if (!dismissed) {
                plugin.showGuidance(window.sokujiI18nMessages);
              }
            } catch (e) {
              // If localStorage is not available, show notification anyway
              plugin.showGuidance(window.sokujiI18nMessages);
            }
          }, 3000);
        }
      } catch (error) {
        console.error('[Sokuji] [Page] Error initializing ' + plugin.name + ' plugin:', error);
      }
    } else {
      console.info('[Sokuji] [Page] No specific plugin found for ' + currentSite + ', using generic functionality');
    }
  }
  
  // Wait for DOM to be ready before initializing plugins
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // If DOM is already ready, initialize immediately
    initSitePlugin();
  } else {
    // Otherwise wait for DOMContentLoaded
    document.addEventListener('DOMContentLoaded', initSitePlugin);
  }
  
  // Expose API for debugging in page context
  window.sokujiPageContext = {
    version: '2.0.0',
    currentSite: getCurrentSite(),
    hasPlugin: function() {
      return !!window.sokujiSitePlugin;
    },
    getActivePlugin: function() {
      return window.sokujiSitePlugin ? window.sokujiSitePlugin.name : 'Generic';
    },
    getStatus: function() {
      return {
        initialized: true,
        hasVirtualMic: !!window.sokujiVirtualMic,
        canInjectAudio: true,
        currentSite: getCurrentSite(),
        activePlugin: window.sokujiSitePlugin ? window.sokujiSitePlugin.name : 'Generic',
        pluginLoaded: !!window.sokujiSitePlugin
      };
    },
    // Helper function to manually trigger site plugin initialization
    reinitSitePlugin: initSitePlugin,
    // Helper function to get current plugin
    getCurrentPlugin: function() {
      return window.sokujiSitePlugin || null;
    }
  };
})(); 