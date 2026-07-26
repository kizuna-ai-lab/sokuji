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

// Cookie names carrying a browser-enforced prefix (`__Secure-` requires the
// Secure attribute, `__Host-` additionally pins path/domain). Better Auth adds
// `__Secure-` to every one of its cookies as soon as the backend is reached
// over https, so matching on the bare name alone silently misses the real
// session cookie in production.
const COOKIE_NAME_PREFIX = /^__(?:Secure|Host)-/;

// Is this a Better Auth cookie we should mirror into the jar? The prefix is
// stripped before matching so http (localhost) and https backends behave alike.
const isAuthCookieName = (name) => {
  const bare = name.replace(COOKIE_NAME_PREFIX, '');
  return bare.startsWith('better-auth.') || bare === 'session_token' || bare === 'csrf_token';
};

/**
 * Merge the jar into an outgoing request's headers, in place.
 *
 * Merge, never overwrite: the header Chromium already built reflects the live
 * cookie store, whereas the jar is only a stand-in for the cases where the
 * browser declines to attach anything (cross-site request from file://).
 * Overwriting it lets a stale jar entry shadow a freshly issued session cookie.
 *
 * Chromium's header keys are not case-normalised for us, so the merged value
 * goes back onto the exact key that was already there — adding a second key
 * differing only in case would put two Cookie headers on the wire.
 */
const injectCookies = (requestHeaders) => {
  const key = Object.keys(requestHeaders).find((k) => k.toLowerCase() === 'cookie');
  const parts = [];
  const attached = new Set();

  for (const pair of (key ? requestHeaders[key] : '').split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    // A malformed pair has no name to key on; pass it through untouched.
    if (eq > 0) attached.add(trimmed.slice(0, eq));
    parts.push(trimmed);
  }

  for (const [name, value] of Object.entries(getCookies() || {})) {
    if (!attached.has(name)) parts.push(`${name}=${value}`);
  }

  if (parts.length > 0) requestHeaders[key || 'Cookie'] = parts.join('; ');
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

  // NOTE: onBeforeSendHeaders is NOT registered here because Electron only
  // allows one listener per event. The combined handler lives in main.js's
  // initWebSocketHeaderInjection() which handles both auth cookie injection
  // and WebSocket header injection. We store the config for it to use.
  betterAuthAdapter._sendHeadersConfig = {
    filterPatterns,
    origin: opts.origin,
    getCookies,
    injectCookies,
  };

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

              // Store all Better Auth cookies. The name is kept verbatim,
              // prefix included — that is the name the server expects back.
              if (isAuthCookieName(trimmedName)) {
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
