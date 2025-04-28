/**
 * Electron adapter for browser environment
 * This module simulates Electron APIs to make the original React code work in browser extensions
 */

/* global chrome */

// Create a simulated electron object
const electronAdapter = {
  // Send message to background script
  send: (channel, data) => {
    console.log(`[Electron Adapter] send: ${channel}`, data);
    // In browser extensions, we use chrome.runtime.sendMessage instead of ipcRenderer.send
    chrome.runtime.sendMessage({ channel, data });
  },

  // Receive messages from background script
  receive: (channel, func) => {
    console.log(`[Electron Adapter] receive: ${channel}`);
    // In browser extensions, we use chrome.runtime.onMessage.addListener
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.channel === channel) {
        func(message.data);
      }
    });
  },

  // Invoke methods in background script
  invoke: async (channel, data) => {
    console.log(`[Electron Adapter] invoke: ${channel}`, data);
    
    // Handle virtual audio device related calls
    if (channel === 'connect-virtual-speaker-to-output') {
      console.log('[Electron Adapter] Simulating connection of virtual speaker to output device:', data);
      // In browser extensions, we can't create real virtual audio devices, return simulated success response
      return {
        success: true,
        message: 'Simulated connecting virtual speaker in browser extension. Note: Browser extensions cannot create real virtual audio devices.'
      };
    }
    
    if (channel === 'disconnect-virtual-speaker-outputs') {
      console.log('[Electron Adapter] Simulating disconnection of virtual speaker from all outputs');
      // Return simulated success response
      return {
        success: true,
        message: 'Simulated disconnecting virtual speaker in browser extension. Note: Browser extensions cannot manipulate real virtual audio devices.'
      };
    }
    
    if (channel === 'get-audio-devices') {
      console.log('[Electron Adapter] Getting audio device list');
      // Try to use Web Audio API to get device list
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = {
          inputs: devices.filter(device => device.kind === 'audioinput').map(device => ({
            deviceId: device.deviceId,
            label: device.label || `Microphone ${device.deviceId.substring(0, 5)}...`,
            isVirtual: false
          })),
          outputs: devices.filter(device => device.kind === 'audiooutput').map(device => ({
            deviceId: device.deviceId,
            label: device.label || `Speaker ${device.deviceId.substring(0, 5)}...`,
            isVirtual: false
          }))
        };
        
        return { success: true, devices: audioDevices };
      } catch (error) {
        console.error('Failed to get audio devices:', error);
        return { 
          success: false, 
          error: 'Failed to get audio devices: ' + error.message,
          devices: { inputs: [], outputs: [] }
        };
      }
    }
    
    if (channel === 'create-virtual-speaker') {
      console.log('[Electron Adapter] Simulating creation of virtual speaker');
      // Return simulated success response
      return {
        success: true,
        message: 'Simulated creating virtual speaker in browser extension. Note: Browser extensions cannot create real virtual audio devices.'
      };
    }
    
    // For other calls, use chrome.runtime.sendMessage
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: channel, data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response);
        }
      });
    });
  },

  // Configuration related methods
  config: {
    get: async (key, defaultValue) => {
      console.log(`[Electron Adapter] config.get: ${key}`, defaultValue);
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_CONFIG',
          key,
          defaultValue
        });
        return response.value;
      } catch (error) {
        console.error('Error getting config:', error);
        return defaultValue;
      }
    },

    set: async (key, value) => {
      console.log(`[Electron Adapter] config.set: ${key}`, value);
      try {
        return await chrome.runtime.sendMessage({
          type: 'SET_CONFIG',
          key,
          value
        });
      } catch (error) {
        console.error('Error setting config:', error);
        return { success: false, error: error.message };
      }
    },

    getPath: async () => {
      console.log(`[Electron Adapter] config.getPath`);
      // In browser extensions, we don't have filesystem paths, return a simulated value
      return { configDir: 'extension-storage', configFile: 'config.json' };
    }
  },

  // OpenAI API related methods
  openai: {
    validateApiKey: async (apiKey) => {
      console.log(`[Electron Adapter] openai.validateApiKey`);
      try {
        return await chrome.runtime.sendMessage({
          type: 'VALIDATE_API_KEY',
          apiKey
        });
      } catch (error) {
        console.error('Error validating API key:', error);
        return { success: false, valid: false, error: error.message };
      }
    }
  }
};

// Expose the adapter to the global window object, simulating Electron's preload.js behavior
window.electron = electronAdapter;

export default electronAdapter;
