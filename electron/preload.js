const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electron',
  {
    send: (channel, data) => {
      // whitelist channels
      const validChannels = ['toMain', 'audio-check', 'audio-start', 'audio-stop'];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    receive: (channel, func) => {
      const validChannels = ['fromMain', 'audio-status'];
      if (validChannels.includes(channel)) {
        // Deliberately strip event as it includes `sender` 
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    },
    invoke: (channel, data) => {
      const validChannels = [
        'invoke-channel', 
        'check-audio-system', 
        'get-config',
        'set-config',
        'get-config-path',
        'open-directory',
        'validate-api-key',
        'connect-virtual-speaker-to-output',
        'disconnect-virtual-speaker-outputs'
      ];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, data);
      }
    },
    config: {
      get: (key, defaultValue) => {
        return ipcRenderer.invoke('get-config', key, defaultValue);
      },
      set: (key, value) => {
        return ipcRenderer.invoke('set-config', key, value);
      },
      getPath: () => {
        return ipcRenderer.invoke('get-config-path');
      }
    },
    openai: {
      validateApiKey: (apiKey) => {
        return ipcRenderer.invoke('validate-api-key', apiKey);
      }
    }
  }
);
