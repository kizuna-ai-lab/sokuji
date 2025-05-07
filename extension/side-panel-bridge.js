/* global chrome */

// Side Panel Bridge Script
// This script provides a bridge between the React application in the side panel
// and the content script running in the web page

/**
 * SidePanelBridge class provides methods to communicate with the content script
 * and send audio data to the virtual microphone
 */
class SidePanelBridge {
  constructor() {
    this.isConnected = false;
    this.activeTabId = null;
    
    // Initialize the bridge
    this.init();
  }
  
  /**
   * Initialize the bridge by getting the active tab
   */
  async init() {
    try {
      // Get the current active tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0) {
        this.activeTabId = tabs[0].id;
        this.isConnected = true;
        console.log('[Sokuji] Side panel bridge initialized with tab ID:', this.activeTabId);
      } else {
        console.error('[Sokuji] No active tab found');
      }
    } catch (error) {
      console.error('[Sokuji] Error initializing side panel bridge:', error);
    }
  }
  
  /**
   * Send audio data to the content script to be injected into the virtual microphone
   * @param {Object} audioData - Audio data object with format expected by the virtual microphone
   * @returns {Promise<Object>} - Response from the content script
   */
  async sendAudioData(audioData) {
    if (!this.isConnected || !this.activeTabId) {
      await this.init();
      if (!this.isConnected || !this.activeTabId) {
        throw new Error('Cannot send audio data: not connected to a tab');
      }
    }
    
    try {
      // Send the audio data to the content script
      const response = await chrome.tabs.sendMessage(this.activeTabId, {
        type: 'SOKUJI_AUDIO_DATA',
        audioData
      });
      
      return response;
    } catch (error) {
      console.error('[Sokuji] Error sending audio data to content script:', error);
      throw error;
    }
  }
  
  /**
   * Get the status of the virtual microphone from the content script
   * @returns {Promise<Object>} - Status information from the content script
   */
  async getStatus() {
    if (!this.isConnected || !this.activeTabId) {
      await this.init();
      if (!this.isConnected || !this.activeTabId) {
        throw new Error('Cannot get status: not connected to a tab');
      }
    }
    
    try {
      // Request status from the content script
      const response = await chrome.tabs.sendMessage(this.activeTabId, {
        type: 'SOKUJI_GET_STATUS'
      });
      
      return response;
    } catch (error) {
      console.error('[Sokuji] Error getting status from content script:', error);
      throw error;
    }
  }
}

// Create and export a singleton instance
const sidePanelBridge = new SidePanelBridge();

// Make the bridge available globally
window.SidePanelBridge = sidePanelBridge;

// Export for ES modules
export default sidePanelBridge;
