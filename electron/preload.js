const { contextBridge, ipcRenderer } = require('electron');

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
      const validChannels = [
        'fromMain',
        'audio-status',
        // Volcengine AST 2.0 WebSocket proxy events (main → renderer)
        'volcengine-ast2-message',
        'volcengine-ast2-error',
        'volcengine-ast2-close',
      ];
      if (validChannels.includes(channel)) {
        // Deliberately strip event as it includes `sender`
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      }
    },
    removeListener: (channel, func) => {
      const validChannels = [
        'fromMain',
        'audio-status',
        'volcengine-ast2-message',
        'volcengine-ast2-error',
        'volcengine-ast2-close',
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, func);
      }
    },
    removeAllListeners: (channel) => {
      const validChannels = [
        'fromMain',
        'audio-status',
        'volcengine-ast2-message',
        'volcengine-ast2-error',
        'volcengine-ast2-close',
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      }
    },
    invoke: (channel, data) => {
      const validChannels = [
        'invoke-channel',
        'check-audio-system',
        'open-directory',
        'open-external',
        'create-virtual-speaker',
        'get-cookies',
        'set-cookie',
        'check-vbcable',
        'install-vbcable',
        'check-sokuji-audio',
        // System audio capture channels
        'supports-system-audio-capture',
        'list-system-audio-sources',
        'connect-system-audio-source',
        'disconnect-system-audio-source',
        // Screen recording permission check (macOS)
        'check-screen-recording-permission',
        // electron-audio-loopback channels (auto-registered by initMain())
        'enable-loopback-audio',
        'disable-loopback-audio',
        // Volcengine AST 2.0 WebSocket proxy (renderer → main)
        'volcengine-ast2-connect',
        'volcengine-ast2-send',
        'volcengine-ast2-disconnect',
        'volcengine-ast2-validate',
      ];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, data);
      }
    }
  }
);
