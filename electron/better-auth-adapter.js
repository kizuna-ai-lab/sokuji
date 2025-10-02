const { ipcMain, session } = require('electron');
const { Conf } = require('electron-conf');

const cookieJar = new Conf({
  name: '_better_auth',
  ext: ''
});

const getCookies = () => {
  try {
    return cookieJar.get('cookies') || {};
  } catch (e) {
    console.log('[BetterAuth Adapter] Error getting cookies:', e);
    return {};
  }
};

const setCookies = (cookies) => {
  try {
    cookieJar.set('cookies', cookies);
    return true;
  } catch (e) {
    console.log('[BetterAuth Adapter] Error setting cookies:', e);
    return false;
  }
};

const clearCookies = () => {
  try {
    cookieJar.set('cookies', {});
    return true;
  } catch (e) {
    console.log('[BetterAuth Adapter] Error clearing cookies:', e);
    return false;
  }
};

function handlerExists(channel) {
  try {
    const temp = () => {};
    ipcMain.handle(channel, temp);
    ipcMain.removeHandler(channel);
    return false;
  } catch (e) {
    if (e?.message?.includes('Attempted to register a second handler')) {
      return true;
    }
  }
  return false;
}

function betterAuthAdapter(opts) {
  if (!opts || !opts.backendUrl) {
    console.warn('[BetterAuth Adapter] No backend URL provided');
    return;
  }

  // Register IPC handlers if not already registered
  if (!handlerExists('get-cookies')) {
    ipcMain.handle('get-cookies', async (event) => {
      return getCookies();
    });
  }

  if (!handlerExists('set-cookie')) {
    ipcMain.handle('set-cookie', async (event, name, value) => {
      const cookies = getCookies();
      cookies[name] = value;
      setCookies(cookies);
      return true;
    });
  }

  if (!handlerExists('clear-cookies')) {
    ipcMain.handle('clear-cookies', async (event) => {
      return clearCookies();
    });
  }

  // Parse backend URL to get domain
  let backendDomain;
  try {
    const url = new URL(opts.backendUrl);
    backendDomain = url.hostname;
  } catch (error) {
    console.error('[BetterAuth Adapter] Invalid backend URL:', error);
    return;
  }

  // Filter patterns for Better Auth requests
  const filterPatterns = [
    `${opts.backendUrl}/*`,
    `${opts.backendUrl}/auth/*`,
    `${opts.backendUrl}/wallet/*`,
    `${opts.backendUrl}/user/*`,
    `${opts.backendUrl}/v1/*`
  ];

  const filter = {
    urls: filterPatterns
  };

  console.log('[BetterAuth Adapter] Initializing for backend:', opts.backendUrl);
  console.log('[BetterAuth Adapter] Filter patterns:', filterPatterns);

  // Configure request interceptors
  session.defaultSession.webRequest.onBeforeRequest(
    filter,
    (details, callback) => {
      callback({ cancel: false });
    }
  );

  session.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      const { requestHeaders } = details;
      const storedCookies = getCookies();

      // Set origin and referer headers
      if (opts.origin) {
        // Ensure no trailing slash in origin
        const cleanOrigin = opts.origin.endsWith('/') ? opts.origin.slice(0, -1) : opts.origin;

        requestHeaders['Origin'] = cleanOrigin.toLowerCase();
        requestHeaders['Referer'] = cleanOrigin.toLowerCase();
      }

      // Add stored cookies to the request
      if (storedCookies && Object.keys(storedCookies).length > 0) {
        const cookieStr = Object.entries(storedCookies)
          .map(([name, value]) => `${name}=${value}`)
          .join('; ');
        requestHeaders['Cookie'] = cookieStr;
        console.log('[BetterAuth Adapter] Sending cookies:', cookieStr);
      }

      callback({ requestHeaders });
    }
  );

  session.defaultSession.webRequest.onHeadersReceived(
    filter,
    (details, callback) => {
      const { responseHeaders } = details;
      const headers = { ...responseHeaders };

      // Store cookies from response
      if (headers && headers['set-cookie']) {
        const cookies = headers['set-cookie'];
        const storedCookies = getCookies() || {};

        let cookiesUpdated = false;
        cookies.forEach((cookieStr) => {
          const [nameValue] = cookieStr.split(';');
          if (nameValue) {
            const [name, value] = nameValue.split('=');
            if (name && value !== undefined) {
              const trimmedName = name.trim();
              const trimmedValue = value.trim();

              // Store all Better Auth cookies
              if (trimmedName.startsWith('better-auth.') ||
                  trimmedName === 'session_token' ||
                  trimmedName === 'csrf_token') {
                storedCookies[trimmedName] = trimmedValue;
                cookiesUpdated = true;
                console.log('[BetterAuth Adapter] Stored cookie:', trimmedName, '=', trimmedValue);
              }
            }
          }
        });

        if (cookiesUpdated) {
          setCookies(storedCookies);
        }
      }

      // Add CORS headers
      if (headers) {
        // Use the origin passed from main.js
        const allowOrigin = opts.origin || 'http://localhost:5173';

        // Ensure no trailing slash in origin
        const cleanOrigin = allowOrigin.endsWith('/') ? allowOrigin.slice(0, -1) : allowOrigin;

        headers['access-control-allow-origin'] = [cleanOrigin];
        headers['access-control-allow-credentials'] = ['true'];
        headers['access-control-allow-headers'] = ['Content-Type, Authorization'];
        headers['access-control-allow-methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
        headers['access-control-max-age'] = ['3600'];
      }

      callback({ responseHeaders: headers });
    }
  );

  console.log('[BetterAuth Adapter] Initialized successfully for:', backendDomain);
}

module.exports = { betterAuthAdapter };
