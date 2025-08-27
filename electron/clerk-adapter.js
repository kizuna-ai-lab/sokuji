const { ipcMain, session } = require('electron');
const { Conf } = require('electron-conf');

const cookieJar = new Conf({
  name: '_clerk',
  ext: ''
});

const getCookies = () => {
  try {
    return cookieJar.get('cookies') || {};
  } catch (e) {
    console.log('Error getting cookies:', e);
    return {};
  }
};

const setCookies = (cookies) => {
  try {
    cookieJar.set('cookies', cookies);
    return true;
  } catch (e) {
    console.log('Error setting cookies:', e);
    return false;
  }
};

function extractRootDomain(domain) {
  const parts = domain.split('.');
  if (parts.length === 2) {
    return parts[0];
  } else if (parts.length > 2) {
    return parts[parts.length - 2];
  } else {
    throw new Error('Unexpected domain format');
  }
}

function parseClerkPublishableKey(publishableKey) {
  if (!publishableKey || typeof publishableKey !== 'string') {
    throw new Error('Invalid Clerk publishable key');
  }

  const isDev = publishableKey.startsWith('pk_test');
  const isProd = publishableKey.startsWith('pk_live');

  if (!isDev && !isProd) {
    throw new Error(
      'Invalid Clerk publishable key format. Must start with pk_test_ or pk_live_'
    );
  }

  const prefix = isDev ? 'pk_test_' : 'pk_live_';
  let base64Domain = publishableKey.substring(prefix.length);

  if (base64Domain.endsWith('$')) {
    base64Domain = base64Domain.substring(0, base64Domain.length - 1);
  }

  let domain;
  try {
    // Use Buffer for Node.js environment
    const decoded = Buffer.from(base64Domain, 'base64').toString('utf-8');
    if (decoded.endsWith('$')) {
      domain = decoded.substring(0, decoded.length - 1);
    } else {
      domain = decoded;
    }
  } catch (error) {
    throw new Error('Failed to decode domain from publishable key');
  }

  const root = extractRootDomain(domain);

  const filterPatterns = [
    `*://*.${domain}/*`,
    `*://${domain}/*`,
    `*://*.clerk/*`
  ];

  return {
    domain,
    root,
    isDev,
    isProd,
    filterPatterns,
    toString() {
      return this.domain;
    }
  };
}

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

function clerkAdapter(opts) {
  if (!opts || !opts.publishableKey) {
    console.warn('Clerk adapter: No publishable key provided');
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

  const { filterPatterns, root } = parseClerkPublishableKey(opts.publishableKey);

  const filter = {
    urls: filterPatterns
  };

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
        
        if (requestHeaders['Origin']) {
          requestHeaders['Origin'] = cleanOrigin.toLowerCase();
        }
        if (requestHeaders['Referer']) {
          requestHeaders['Referer'] = cleanOrigin.toLowerCase();
        }
      }

      // Add stored cookies to the request
      if (storedCookies && Object.keys(storedCookies).length > 0) {
        const cookieStr = Object.entries(storedCookies)
          .map(([name, value]) => `${name}=${value}`)
          .join('; ');
        requestHeaders['Cookie'] = cookieStr;
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
        if (details.url.includes('clerk') || details.url.includes(root)) {
          const storedCookies = getCookies() || {};
          cookies.forEach((cookieStr) => {
            const [nameValue] = cookieStr.split(';');
            if (nameValue) {
              const [name, value] = nameValue.split('=');
              if (name && value) {
                storedCookies[name.trim()] = value.trim();
              }
            }
          });
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

  console.log('Clerk adapter initialized for domain:', parseClerkPublishableKey(opts.publishableKey).domain);
}

module.exports = { clerkAdapter };