import { contextBridge, ipcRenderer } from 'electron';
// Renderer→main invoke allowlist. Single source of truth in ipc-channels.js
// (guarded against handler drift by ipc-channels.test.js). The bundler inlines
// this array into the built preload.js, so the shipped artifact stays an
// auditable literal list.
import { INVOKE_CHANNELS } from './ipc-channels.js';

// Cookie API for Better Auth adapter
const cookieAPI = {
  get: async (name) => {
    const cookies = await ipcRenderer.invoke('get-cookies');
    return cookies[name] || '';
  },
  
  getAll: async () => {
    const cookies = await ipcRenderer.invoke('get-cookies');
    return Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  },
  
  set: async (cookieString) => {
    const [nameValue] = cookieString.split(';');
    if (nameValue) {
      const [name, value] = nameValue.split('=');
      if (name && value) {
        await ipcRenderer.invoke('set-cookie', name.trim(), value.trim());
        return true;
      }
    }
    return false;
  }
};

// Function to initialize cookies
function initializeCookies() {
  let cachedCookies = '';
  
  Object.defineProperty(document, 'cookie', {
    get: function() {
      return cachedCookies;
    },
    set: function(value) {
      window.cookieAPI.set(value);
      return value;
    }
  });
  
  // // Initialize cached cookies
  // window.cookieAPI.getAll().then(cookies => {
  //   cachedCookies = cookies;
  // });
}

// Expose cookie API to renderer process
contextBridge.exposeInMainWorld('cookieAPI', cookieAPI);
contextBridge.exposeInMainWorld('initializeCookies', initializeCookies);

// Track original callback → wrapper for correct removeListener behavior
const listenerMap = new WeakMap();

const validReceiveChannels = [
  'fromMain',
  'audio-status',
  // Auto-update channels (main → renderer)
  'update-status',
  'update-progress',
  // Subtitle window bounds change events
  'subtitle:window-bounds-changed',
  'subtitle:fullscreen-changed',
  // Native sidecar bundle install progress (main → renderer)
  'sidecar-bundle-progress',
];

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
      if (validReceiveChannels.includes(channel)) {
        // Deliberately strip event as it includes `sender`
        const wrapper = (event, ...args) => func(...args);
        listenerMap.set(func, wrapper);
        ipcRenderer.on(channel, wrapper);
      }
    },
    removeListener: (channel, func) => {
      if (validReceiveChannels.includes(channel)) {
        const wrapper = listenerMap.get(func);
        if (wrapper) {
          ipcRenderer.removeListener(channel, wrapper);
          listenerMap.delete(func);
        }
      }
    },
    removeAllListeners: (channel) => {
      if (validReceiveChannels.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      }
    },
    invoke: (channel, data) => {
      if (INVOKE_CHANNELS.includes(channel)) {
        return ipcRenderer.invoke(channel, data);
      }
      // Fail loud on the security boundary: a channel outside the allowlist is
      // a bug (all real channels are registered), not a graceful-degradation
      // path. Reject + warn instead of silently resolving to undefined.
      console.warn(`[Sokuji] [Preload] Blocked unauthorized invoke for channel: ${channel}`);
      return Promise.reject(new Error(`Blocked unauthorized invoke for channel: ${channel}`));
    }
  }
);
