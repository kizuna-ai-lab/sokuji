const { contextBridge, ipcRenderer } = require('electron');

// Cookie API for Clerk adapter
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
        'open-directory',
        'create-virtual-speaker',
        'get-cookies',
        'set-cookie'
      ];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, data);
      }
    }
  }
);
