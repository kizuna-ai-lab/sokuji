/* global chrome */

// Import PostHog from installed package
import PostHog from 'posthog-js-lite';
import { deriveEnabledSites } from './platforms';
import { deriveSiteInfo, deriveSiteGroups } from './platformIcons';

// Analytics configuration - uses environment variables
// Fork projects can disable analytics by not setting POSTHOG_KEY
const ANALYTICS_CONFIG = {
  POSTHOG_KEY: import.meta.env.VITE_POSTHOG_KEY || '',
  POSTHOG_HOST: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'
};

// Helper to check if analytics is enabled
function isAnalyticsEnabled() {
  return Boolean(ANALYTICS_CONFIG.POSTHOG_KEY);
}

// PostHog instance
let posthogInstance = null;

// Initialize PostHog
function initializePostHog() {
  if (posthogInstance || typeof window === 'undefined') return;

  // Skip initialization if no key configured (fork projects without PostHog)
  if (!isAnalyticsEnabled()) {
    console.debug('[Sokuji] [Popup] PostHog analytics disabled (POSTHOG_KEY not set)');
    return;
  }

  try {
    // Initialize PostHog with posthog-js-lite
    posthogInstance = new PostHog(ANALYTICS_CONFIG.POSTHOG_KEY, {
      host: ANALYTICS_CONFIG.POSTHOG_HOST,
      debug: isDevelopment(),
      persistence: 'localStorage',
      autocapture: true,
      captureHistoryEvents: false // Not needed for popup
    });
    
    // Set super properties
    posthogInstance.register({
      app_version: chrome.runtime.getManifest().version,
      environment: isDevelopment() ? 'development' : 'production',
      platform: 'extension',
      component: 'popup'
    });
    
    // In development, opt out by default
    if (isDevelopment()) {
      posthogInstance.optOut();
      console.debug('[Sokuji] [Popup] PostHog initialized in development mode - capturing is opt-out by default');
    }
    
    console.debug('[Sokuji] [Popup] PostHog initialized');
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

// Enabled sites, site info, and site groups all derive from the registry
// (extension/platforms.ts) so this file, background.js, and the subtitle
// surface never fall out of sync.
const ENABLED_SITES = deriveEnabledSites();

// Destinations for the desktop-first unsupported/error states
const DOWNLOAD_URL = 'https://sokuji.kizuna.ai/';
const WEBSITE_URL = 'https://sokuji.kizuna.ai/docs';
// Opens the dedicated "Site Support Request" issue form. Blank issues are
// disabled in the repo, so this MUST use ?template= (not a bare new-issue URL).
const REQUEST_SITE_URL =
  'https://github.com/kizuna-ai-lab/sokuji/issues/new?template=site_request.yml';

// Site information with display names and icons
const SITE_INFO = deriveSiteInfo();

// Grouped sites: multiple domains sharing one card with sub-labels
const SITE_GROUPS = deriveSiteGroups();

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

// Helper function to generate icon style attribute
function getIconStyle(info) {
  return info.iconBg ? `style="background-color: ${info.iconBg}; border-radius: 8px; padding: 4px;"` : '';
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
    trackEvent('extension_popup_opened', {
      is_supported_site: false,
      hostname: null,
      browser_type: detectBrowser()
    });
    return;
  }

  const url = new URL(tab.url);
  const hostname = url.hostname;
  
  // Check if current site is supported
  const isSupported = ENABLED_SITES.some(site => 
    hostname === site || hostname.endsWith('.' + site)
  );

  // Track popup opened event using standardized event name
  trackEvent('extension_popup_opened', {
    is_supported_site: isSupported,
    hostname: hostname,
    browser_type: detectBrowser()
  });

  if (isSupported) {
    showSupportedState(hostname);
  } else {
    showUnsupportedState(hostname);
  }

  // Set up event listeners
  setupEventListeners(tab.id, isSupported, hostname);
}

function showSupportedState(hostname) {
  const content = document.getElementById('content');
  const openButton = document.getElementById('openSidePanel');
  
  const siteInfo = SITE_INFO[hostname] || { name: hostname, icon: '' };
  
  // Track supported state shown
  trackEvent('extension_popup_supported_state_shown', {
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

// Shared markup for both the unsupported-site and detect-failure states.
// `headlineHtml` is the only part that differs between the two.
function renderUnsupportedFirstHtml(headlineHtml) {
  return `
    <div class="status-headline">
      ${headlineHtml}
    </div>

    <div class="cta-card">
      <div class="cta-card-title">${getMessage('desktopCtaTitle')}</div>
      <p class="cta-card-body">${getMessage('desktopCtaBody')}</p>
      <button id="downloadDesktop" class="primary-button cta-card-button">${getMessage('desktopCtaButton')}</button>
    </div>

    <div class="supported-sites">
      <p class="browser-sites-heading">${getMessage('browserSitesHeading')}</p>
      <ul class="sites-list" id="sitesList">
        ${generateSitesList()}
      </ul>
    </div>

    <div class="popup-footer-links">
      <a id="requestSiteLink" href="${REQUEST_SITE_URL}" target="_blank" rel="noopener">${getMessage('requestSiteLink')}</a>
      <a id="learnMoreLink" href="${WEBSITE_URL}" target="_blank" rel="noopener">${getMessage('learnMore')}</a>
    </div>
  `;
}

// Wire the CTA buttons/links plus the (reused) supported-sites grid.
// `source` is 'unsupported' | 'error'; `hostname` may be null in the error state.
function setupUnsupportedHandlers(source, hostname) {
  const trackingHostname = hostname || 'unknown';

  // These states stand on their own (the headline already says "Sokuji" and they
  // carry their own in-content footer links), so hide the global header and the
  // store-link footer here. Both remain for the supported state.
  const header = document.querySelector('.header');
  if (header) {
    header.style.display = 'none';
  }
  const storeFooter = document.querySelector('.footer');
  if (storeFooter) {
    storeFooter.style.display = 'none';
  }

  const downloadBtn = document.getElementById('downloadDesktop');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      trackEvent('popup_desktop_download_clicked', { source, hostname: trackingHostname });
      chrome.tabs.create({ url: DOWNLOAD_URL });
      window.close();
    });
  }

  const learnMoreLink = document.getElementById('learnMoreLink');
  if (learnMoreLink) {
    learnMoreLink.addEventListener('click', () => {
      trackEvent('popup_website_clicked', { source, hostname: trackingHostname });
    });
  }

  const requestSiteLink = document.getElementById('requestSiteLink');
  if (requestSiteLink) {
    requestSiteLink.addEventListener('click', () => {
      trackEvent('popup_request_site_clicked', { source, hostname: trackingHostname });
    });
  }

  // Reuse the existing grid navigation + extension_site_navigated tracking.
  setupSiteItemClickHandlers(false, hostname);
}

function showUnsupportedState(hostname) {
  const content = document.getElementById('content');

  // Track unsupported state shown
  trackEvent('extension_popup_unsupported_state_shown', {
    hostname: hostname,
    supported_sites_count: ENABLED_SITES.length
  });

  const headline = `<strong>${getMessage('unsupportedHeadline', [`<code>${hostname}</code>`])}</strong>`;
  content.innerHTML = renderUnsupportedFirstHtml(headline);

  // Prefill the site-request form's title + "Site URL" field with the current host
  const requestLink = document.getElementById('requestSiteLink');
  if (requestLink) {
    requestLink.href = REQUEST_SITE_URL
      + '&title=' + encodeURIComponent('[Site]: ' + hostname)
      + '&site-url=' + encodeURIComponent(hostname);
  }

  setupUnsupportedHandlers('unsupported', hostname);
}

function showErrorState() {
  const content = document.getElementById('content');

  // Track error state shown
  trackEvent('extension_popup_error', {
    error_type: 'no_tab_info',
    error_message: 'Unable to detect current site'
  });

  const headline = `<strong>${getMessage('detectFailHeadline')}</strong><br>${getMessage('detectFailBody')}`;
  content.innerHTML = renderUnsupportedFirstHtml(headline);

  setupUnsupportedHandlers('error', null);
}

// Helper function to generate sites list HTML
function generateSitesList() {
  const renderedGroups = new Set();
  return ENABLED_SITES.map(site => {
    const info = SITE_INFO[site];
    // If this site belongs to a group, render the group card once
    if (info.group) {
      if (renderedGroups.has(info.group)) return '';
      renderedGroups.add(info.group);
      const group = SITE_GROUPS[info.group];
      const tooltipText = `${group.shortName}\n${group.sites.map(s => s.domain).join('\n')}`;
      const pills = group.sites.map(s =>
        `<span class="site-group-pill" data-url="${s.domain}" title="${s.domain}">${s.label}</span>`
      ).join('');
      return `
        <li class="site-item site-item-grouped" title="${tooltipText}">
          <img src="${group.icon}" alt="${group.shortName}" class="site-icon" onerror="this.style.display='none'">
          <div class="site-info">
            <div class="site-name">${group.shortName}</div>
            <div class="site-group-pills">${pills}</div>
          </div>
        </li>
      `;
    }
    const tooltipText = `${info.name}\n${site}`;
    return `
      <li class="site-item" title="${tooltipText}">
        <img src="${info.icon}" alt="${info.name}" class="site-icon" onerror="this.style.display='none'">
        <div class="site-info">
          <div class="site-name">${info.shortName}</div>
          <div class="site-url">${site}</div>
        </div>
      </li>
    `;
  }).join('');
}

function setupEventListeners(tabId, isSupported, currentHostname) {
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
        trackEvent('extension_side_panel_opened', {
          trigger: 'popup',
          site: currentHostname
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
          trackEvent('extension_side_panel_opened', {
            trigger: 'popup',
            site: currentHostname
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

// Helper function to setup site item click handlers
function setupSiteItemClickHandlers(isSupported, currentHostname) {
  // Handle grouped site pill clicks
  const pills = document.querySelectorAll('.site-group-pill');
  pills.forEach(pill => {
    const newPill = pill.cloneNode(true);
    pill.parentNode.replaceChild(newPill, pill);
    newPill.addEventListener('click', (e) => {
      e.stopPropagation();
      const siteUrl = newPill.dataset.url;
      trackEvent('extension_site_navigated', {
        from_site: currentHostname || 'unknown',
        to_site: siteUrl,
        navigation_source: 'popup'
      });
      chrome.tabs.create({ url: `https://${siteUrl}` });
      window.close();
    });
  });

  // Handle regular (non-grouped) site item clicks
  const siteItems = document.querySelectorAll('.site-item:not(.site-item-grouped)');
  siteItems.forEach(item => {
    const newItem = item.cloneNode(true);
    item.parentNode.replaceChild(newItem, item);

    newItem.addEventListener('click', () => {
      const siteUrl = newItem.querySelector('.site-url').textContent;
      const siteName = newItem.querySelector('.site-name').textContent;

      // Track site navigation
      trackEvent('extension_site_navigated', {
        from_site: currentHostname || 'unknown',
        to_site: siteUrl,
        navigation_source: 'popup'
      });

      chrome.tabs.create({ url: `https://${siteUrl}` });
      window.close();
    });
  });
} 
