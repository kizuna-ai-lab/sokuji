/* global chrome */

// Import PostHog from installed package
import PostHog from 'posthog-js-lite';

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

// Define the same enabled sites as in background.js
const ENABLED_SITES = [
  'meet.google.com',
  'teams.live.com',
  'teams.microsoft.com',
  'teams.cloud.microsoft',
  'app.zoom.us',
  'app.slack.com',
  'app.gather.town',
  'app.v2.gather.town',
  'whereby.com',
  'discord.com',
  'meet.jit.si'
];

// Destinations for the desktop-first unsupported/error states
const DOWNLOAD_URL = 'https://sokuji.kizuna.ai/';
const WEBSITE_URL = 'https://sokuji.kizuna.ai/docs';
// Opens the dedicated "Site Support Request" issue form. Blank issues are
// disabled in the repo, so this MUST use ?template= (not a bare new-issue URL).
const REQUEST_SITE_URL =
  'https://github.com/kizuna-ai-lab/sokuji/issues/new?template=site_request.yml';

// Site information with display names and icons
const SITE_INFO = {
  'meet.google.com': {
    name: 'Google Meet',
    shortName: 'Meet',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACB0lEQVR4AWPAB0bBKHjlYmzzfRXPkT97mO+TjHcz3/69m6X//34GDrItf+Vs9vnHMt6Xv/ew/CcXAx0TT7blr5xN/39fwP+TQgfMJ9tysAPmCfynlgO0V4XymKwIWm6yIvi8yfIQB/yWIxzwlxoOMF8SJAO0+DQQ/wdh4xXB8/FZjnDAUr63lDrAaEWQBdDS51DLMR2wNTLf9axf2NdzfiH/0fGXFUKniUn1uBywb5PkWqCFv0GW4nSAU+vXeqfWL/+x4pbPocSkHXSLf+1h+dM9X/aVymSXSyAL6eqAz7vY/oRP0Pwv0WDxX3miyzO6OuD+Vq5f1p0GIMshDpjg9ItuDji3gf+9VqsJyGI4Vup3+k8XB+xZLXRDptEcZjH9HaAx3eMS0MKBcwDIUO3ZXs8lGwfQASCsO9/3i2SzJcIBE5z+0M0BMGy4JOCbTJsNNBc4v6anAxAWLAv8KNdt91llkst1gg6Qy75RrpBz/T8mvvHDYFbBNqCG/URgbHH9W3eB30aCDpBIu1wvmX7pPzasPyfrFUgD6RhhkcnKoHqyHaA3s/AP6RZjWmS6PCgcyP9OsgN0ZxSTaTmmRcarQm2QquXJdAwBBLBYHqAAihIQjeSAi/G4HGAwJ/sNJQ4wWR6cTTALKSTc5wBathqIf6M7wHBB0i0yLf8NxOsN1gcI4LN7FIwCACcjGypcbDtgAAAAAElFTkSuQmCC'
  },
  'teams.live.com': {
    name: 'Microsoft Teams Free',
    shortName: 'Teams',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACD0lEQVR4Ae2XA2wlURiF7zq2VuEiztq2rdq27bWNeG3bCNa2VT/V7vy9fzmeaR/Kk5yH0fnm+pJWq7i1+vExq7WXYlZr0tH4G49ZJJyGRVMzMSkaYDs2RVuJ58z+5hjEDuZDmLUksKj5oXzjNYSlJbYv5i6yevZ8sdXTfPzG/0YAaNKVATTp3PCnwDcetwgAvrEYAB5vEoBv6Jsb/mHvge2QmJ+SVYDFLgaAxwlq3rI7a+cuu1s2d+kdaJxvw+yFh8HG8RxCCBuh2hJQDFeAmLNwGwIIu6HaNqAYouBFyw/o/MPfZ4oPRMq9QACgIAEAMVICgLKyynrXiXVMADBqrA+ssjsh2huikrLBxfcLiDfCZ6VLrJ6tla2C8vJKYBiGf1wRgAeBgZIQ5gZAY5ikOwA6ADoAjBmKjQewfmYwdjIyBgAHoutGTcdTZu6hAL6yABGJmZKj4CLr5yOIGo2dGJSKbyq0H0yfs1YWIDDyPyMIt35WucTqqStRKxuXC0cxRMq2zhekSyAh8zB928N0Gv5Xbeunh5bbPh9IGiO/yI+DXbzuMc6ed0BgrzvgF/ZOYomuKY5ZretLTCH6sGRegKLjVus2EVMJADrFpmjPqg2PXa05ceAAdCOm1M6d0CN2jS4hZrWmRGZnVEpLa2siQGdiLsVuzO0ft1q7hgY9ooG51H+pn1CvT9yg6UVak6oAILzSjyQsMWUAAAAASUVORK5CYII=',
    group: 'teams'
  },
  'teams.microsoft.com': {
    name: 'Microsoft Teams (work or school)',
    shortName: 'Teams',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACD0lEQVR4Ae2XA2wlURiF7zq2VuEiztq2rdq27bWNeG3bCNa2VT/V7vy9fzmeaR/Kk5yH0fnm+pJWq7i1+vExq7WXYlZr0tH4G49ZJJyGRVMzMSkaYDs2RVuJ58z+5hjEDuZDmLUksKj5oXzjNYSlJbYv5i6yevZ8sdXTfPzG/0YAaNKVATTp3PCnwDcetwgAvrEYAB5vEoBv6Jsb/mHvge2QmJ+SVYDFLgaAxwlq3rI7a+cuu1s2d+kdaJxvw+yFh8HG8RxCCBuh2hJQDFeAmLNwGwIIu6HaNqAYouBFyw/o/MPfZ4oPRMq9QACgIAEAMVICgLKyynrXiXVMADBqrA+ssjsh2huikrLBxfcLiDfCZ6VLrJ6tla2C8vJKYBiGf1wRgAeBgZIQ5gZAY5ikOwA6ADoAjBmKjQewfmYwdjIyBgAHoutGTcdTZu6hAL6yABGJmZKj4CLr5yOIGo2dGJSKbyq0H0yfs1YWIDDyPyMIt35WucTqqStRKxuXC0cxRMq2zhekSyAh8zB928N0Gv5Xbeunh5bbPh9IGiO/yI+DXbzuMc6ed0BgrzvgF/ZOYomuKY5ZretLTCH6sGRegKLjVus2EVMJADrFpmjPqg2PXa05ceAAdCOm1M6d0CN2jS4hZrWmRGZnVEpLa2siQGdiLsVuzO0ft1q7hgY9ooG51H+pn1CvT9yg6UVak6oAILzSjyQsMWUAAAAASUVORK5CYII=',
    group: 'teams'
  },
  'teams.cloud.microsoft': {
    name: 'Microsoft Teams M365',
    shortName: 'Teams',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACD0lEQVR4Ae2XA2wlURiF7zq2VuEiztq2rdq27bWNeG3bCNa2VT/V7vy9fzmeaR/Kk5yH0fnm+pJWq7i1+vExq7WXYlZr0tH4G49ZJJyGRVMzMSkaYDs2RVuJ58z+5hjEDuZDmLUksKj5oXzjNYSlJbYv5i6yevZ8sdXTfPzG/0YAaNKVATTp3PCnwDcetwgAvrEYAB5vEoBv6Jsb/mHvge2QmJ+SVYDFLgaAxwlq3rI7a+cuu1s2d+kdaJxvw+yFh8HG8RxCCBuh2hJQDFeAmLNwGwIIu6HaNqAYouBFyw/o/MPfZ4oPRMq9QACgIAEAMVICgLKyynrXiXVMADBqrA+ssjsh2huikrLBxfcLiDfCZ6VLrJ6tla2C8vJKYBiGf1wRgAeBgZIQ5gZAY5ikOwA6ADoAjBmKjQewfmYwdjIyBgAHoutGTcdTZu6hAL6yABGJmZKj4CLr5yOIGo2dGJSKbyq0H0yfs1YWIDDyPyMIt35WucTqqStRKxuXC0cxRMq2zhekSyAh8zB928N0Gv5Xbeunh5bbPh9IGiO/yI+DXbzuMc6ed0BgrzvgF/ZOYomuKY5ZretLTCH6sGRegKLjVus2EVMJADrFpmjPqg2PXa05ceAAdCOm1M6d0CN2jS4hZrWmRGZnVEpLa2siQGdiLsVuzO0ft1q7hgY9ooG51H+pn1CvT9yg6UVak6oAILzSjyQsMWUAAAAASUVORK5CYII=',
    group: 'teams'
  },
  'app.zoom.us': {
    name: 'Zoom',
    shortName: 'Zoom',
    icon: 'data:image/png;base64,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'
  },
  'app.slack.com': {
    name: 'Slack',
    shortName: 'Slack',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAD2klEQVR4Ab2VBYzjVhRFn7OMomUKlMk/1AwVUkGZubHLzK2oGChzK1ZJVFGZnLGdMgXKzLiMAXsY3bvgKvXau55Za450B/KV944/mdyQKGkh5KlEqfEHfhdaytoxbaVuzhwPqxmOqVmBlzMf8UrmJ6ZkHmBKdhF5QWtZ4xLFxneI0ZShts+79qEd8Gr2dF5OG/9PRiEvSJT1syzNzXxHIKzkpqNhH2JYMhJV7tqb9pSWUuNWWwHkyMrAVEz5UmtzM1iacz1YAv0QNBuyE2gvdk3n1cxyJwGmpgXyAmy8uyZewEJLUWtvKWk3Q+YOM8kv9MkTJOCMJwJHfNbLtVa62lqL2jXIdU7BDFzTVtYYNRGRc64FWuTcfKakz2ZqhpFJS1kPYT0/Q4wxpDP5S++U7ccw60oAl9Ot+GzAPKK8klaYnFlAKPYcYow1mI1HCYRdzABuxQ7bcSV9JwS0+rgEilrfcb8bPjd7AI1utxfIlAn3+8/jnIFfCRxauGcGGgzbN8juRwDT/YDtuJx+jVDoynEI9LVU9CNoB1jLa1FwyNLgHXMc7wU7gRHMwPGEJeASJT2For3ummsabsfjqImOdx7hsLOvwrXcj8KjEHo18f59swjYzoCSrkffuquVFXIcmSQ/656Kp1rYUmkscgpewQtxZCeTAy0f3DM1quTmkoWImpsdLmQWbctb6QU4jpPIjjUhcdaqvS+cvS37XTJlp/H9L5hqJGHtgCHFuIYcm72rdCmxmdTMyoDI/eMXD1u5IrX2nxUp47/4U1fQDjYFL5m9coXwEj4fWekXflsVTEXJQi0fPrn6Jlu75U3e2G0k9otWiIeqcpQjFBRQeBQx7ASMs170/bNC+MIy3g1p1tQ8hcIDiDGGDFY7w0lCse8Qw0kAgmfZja/E9wg01Pg0PJG75pZU3+RfIDTSHRqIBDD1j9sKIuv2vXzalnxkgX0DV0vxGZ4w9crOzYXRVUFxHwIQecJJYMNe50/XpZivKrHvxzkD99PK4PkHoNhvTYX7Me1XEnAjQECToktQ8JcxNB+tSny51smWbm8SusD3T0A8C41vXBsUVxBwK9B0BKfWJHYupvWhXaWaZ/fW8+w4XYlz5Aa3At7jUqAuhWdjD1zdlFQtH10+YQJVKbzcZncPQOT0CRKImALW1Az5uCm0p/zjFx5zEli730XTsPGWOR6zfPgoDwRE0VYA7wQCupqYiWaDdket/mbkQC+WwIeGf1oERtb6xTjtYIvEX2kVwDn/kLxilV84CC+k13Zc29/gvjgHYpw5jg3nw1Jch8a/IlUIPbslz/zkgn8BeVEBTo2yH6AAAAAASUVORK5CYII='
  },
  'app.gather.town': {
    name: 'Gather Town',
    shortName: 'Gather',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAATlBMVEVHcExDWNhDWNhDWNhDWNhDWNhDWNhDWNhDWNhDWNhDWNgvSdY+VNjw8vx8iOI3T9e6wO8mQ9X///9mdt7Y2/aRmuakrOpSZNsKM9PN0fPNVdxhAAAAC3RSTlMAOobD6f+HYvIY4+LiGjgAAAEfSURBVHgBbJJVAgMhDAXXUgsQeEh273/QWqh3PhkgOjwZp3khWubdOHyzP9CTw/5DHU/0wen49iMRsfvQ44fz4a890hWJPn1a+9niMWJOQiSpBzjd8ySTxQNROAI9wC3nQ5fIKQSpyA1iFVk2V1wAs2qKZRWo6zntHrKlDYiKzXu2s2mYuxQOIEXOW6TOPCwWMVSpWBMCJ2YylsHcBg/xHj4FoDzsXTqFrL5xq8JoiiYm7VtFZjSmIA66lij929maB3iuALSgIFspcy+FNTOjrmVLLWZ5lDKS4egmt5JEExmjtc/07dtcAf9onzXekFyVEdhbtnsb2fOtc/TM9vQatmHtsMb3NRo/bL1MDCiHlogQZvOD5fAlTcKJGm92AABfuxfNfG+19AAAAABJRU5ErkJggg=='
  },
  'app.v2.gather.town': {
    name: 'Gather Town v2',
    shortName: 'Gather v2',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAATlBMVEVHcExDWNhDWNhDWNhDWNhDWNhDWNhDWNhDWNhDWNhDWNgvSdY+VNjw8vx8iOI3T9e6wO8mQ9X///9mdt7Y2/aRmuakrOpSZNsKM9PN0fPNVdxhAAAAC3RSTlMAOobD6f+HYvIY4+LiGjgAAAEfSURBVHgBbJJVAgMhDAXXUgsQeEh273/QWqh3PhkgOjwZp3khWubdOHyzP9CTw/5DHU/0wen49iMRsfvQ44fz4a890hWJPn1a+9niMWJOQiSpBzjd8ySTxQNROAI9wC3nQ5fIKQSpyA1iFVk2V1wAs2qKZRWo6zntHrKlDYiKzXu2s2mYuxQOIEXOW6TOPCwWMVSpWBMCJ2YylsHcBg/xHj4FoDzsXTqFrL5xq8JoiiYm7VtFZjSmIA66lij929maB3iuALSgIFspcy+FNTOjrmVLLWZ5lDKS4egmt5JEExmjtc/07dtcAf9onzXekFyVEdhbtnsb2fOtc/TM9vQatmHtsMb3NRo/bL1MDCiHlogQZvOD5fAlTcKJGm92AABfuxfNfG+19AAAAABJRU5ErkJggg=='
  },
  'whereby.com': {
    name: 'Whereby',
    shortName: 'Whereby',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAAulBMVEX429X53Nb12NLv0szt0Mrqzcfx0s39493y1c/94dv//fb/9/D///z////56+bt1s+DcG2lkIx7aWZ0YmCfioZpWlYAAAD/6uTZ0M5DNTM+ODaPg4BmX13NuraflJEkJSUTDQy2qabk4N6onJjy4NlFQD+opaT/+fddWVeYl5d2c3O3op6CfHoyMDDw5ePax8NKPDrg1NBYTUovJCGtr62/v7r75+EYHBzJzMwoGxcZFRbFsq2Ufnra2tqLdargAAABL0lEQVR4AcSPBZYCMRBEo/gIVsC44+52/2PhhHl7ga14fiv5P9G3XlfCWB4xLl6SgjLGC8WiKFHFypVKtVJ7SBO61GsG18r8S6kw6/W62Wi22ujo3R5gVYkK3bEBOK7nIwijBwsQV/mHlRItRZD1+2GAQexkQwuj/jculdUxMEmEPn0cs1l/DltBwow+sOguqy3A7siCBlfnqkupmUBW5FVgtUxIB/1cryWiA+3I1dbAJul7qSYpybm2ge2OIUDD0PZGp0R+KhXnQENL3QZwmB81SfIS0QLonrQzsBnVX7UqUb7LgNWlGq2x6L1KzYkl1zUwEzsPGOuqHJXVxqUvySFAZDDyB+42uJKS0TFN3VCOKu7SjARlu8wt/xwVLXcev4wUd3mm6H3gIGMCUQMIAHDuG3vTJfIlAAAAAElFTkSuQmCC'
  },
  'discord.com': {
    name: 'Discord',
    shortName: 'Discord',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAASFBMVEVHcExYZPFXZPJXZPFXZPFXZPFXZPFXZPFYZPJYZfJYZPJXZfFWY/JhbfNsd/OSmvbS1fv////x8/6pr/hQXvLl5/2Bi/XAxfpYg8U1AAAADHRSTlMADzmFwOT8YtP/sloPkm6kAAABAklEQVR4AYWTBbLFIAxFcXs4lf3vFEg1X2+9JzITIZco40IqJQVnlGBRbewtoxFmziI59rCPRGhIfn5hiLKDYSkJkemZz98689IB9YlCjPMlxnBgr4ejgTebcqltqJacLFBDCQPHJZWX0gIOjHB4Lusbrgu4ciKQI3IVRALMGGaAkqgZNdQRK4U8foc0MtQw46oDbmC9pBkQomwHlBPOlOsW9lL2sK1XUknETNnKpNOl5slKm1AQfsFaxw2eF+RQBB9HwLq3PedxG3CPMyc7yufDqF6b5Q2+jfoFf5SPaH/WPXhQuCqvn5bNVqEXR1GzkST7e0wwxeyX0fSO/T/Uf65DBzQNHUMopTvLAAAAAElFTkSuQmCC'
  },
  'meet.jit.si': {
    name: 'Jitsi Meet',
    shortName: 'Jitsi',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAACMVBMVEUXoNsWn9oYoNsVn9oOnNkPnNkRndqU0u7a7/gyqt4QndoZoNsWoNscotvS7PfQ6/em2fAGmdgaodsTntoAltdcu+Xg8PlYt+Pe8Pkgo9wUn9orp9244fPm9PqDy+tLsuHm8/otqN4SndrG5vXF5vW03/JVt+ONz+zB5PQDl9cbodsNnNk3q9/Y7viIzOtnv+a+4/TT7PcQndkJmdiGzOuQ0O3R6/dVtuOy3fLy+PxLtOIMm9k6reDb7/mGy+uNzuz///94xulpv+aJy+uo2vDB5fULmtkcoduj2PCJzeux3vJ8x+ne8fnd8Pmz3/Kd1O7R6vcio9wZodsKmtllvubN6fac1e/z+v3f8Pn9/v77/f6a1O6W0e3W7PclpNwTn9pduuTF5fWy3vKf1u9XtuN2w+iV0u3J6PZ1xOjV7PgVntqx3fGCyuru9/z2+v284vTZ7vie1e9Dr+CHzOsGmNgWn9s9ruDt9vvX7vi/4/Rww+iByeqn2vCX0+6d1e9swOd5x+kFmNgImdi44POr2/FTteOMzux5xum03vJ9x+mp2vEeotvS6/eByurr9/zj8/prwOew3fLx+PxQtuMKm9kpp93O6vep2/HL6Pap2vDW7fit3PHh8vo7reAho9zX7fiKzev2+/2k1++j1+/u9/t7yOoAldcPndlkveZ/yepevOWs3PEsp90Xn9uLzuza7vgnpd0Cl9cEmNgEmNcRntoXn9oSntoopd2S0e0uqN5Ks+Ie52EyAAABeklEQVQoz2NgQAWMYIQdMDIwMTEx4pJjZmFlwyXLxMbOwcnFhFUjNw8vH7+AoBA2OSZhEVExcQlJKWxybNIysnLyCopsWMxlUlJWUVVT19DUwnARo5C2jq6egL6BoSILN5osI7eRsYmhqZmeuYWllTWqLCM3i42urZ29g6OTs4urGzeqTmZ3Ww9PMy9vH18//4BAVPcGBYeEhjmER3BERkXHxMbFo5jKK5KQmJSckiqQlp6UkZnFg2ojZ7ZsTm5efkZBYVGxQUkQQq6Um6WsPKmisqq6hr+2rl6loRE5AIOamltaQ9rao6IcOjq7OLpR3CMl2ZNmoNfb5+DQP2HipMlTgpC9KTx12vQZOjNtZ81un6Mx1w1FjkFq3vwFvQvNFi02WLJ02XJUOQYm654VBitXrW6RWyMohBawa4Ua162fv2Hjps2btghtRY8Spm3bF6azagkJCWFJP4xCG3cIaGJLHWDAtnMXCxMOOUYGKTa8qRmnHAMPGKEBAADXVbSub916AAAAAElFTkSuQmCC'
  }
};

// Grouped sites: multiple domains sharing one card with sub-labels
const SITE_GROUPS = {
  'teams': {
    shortName: 'Teams',
    icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAACD0lEQVR4Ae2XA2wlURiF7zq2VuEiztq2rdq27bWNeG3bCNa2VT/V7vy9fzmeaR/Kk5yH0fnm+pJWq7i1+vExq7WXYlZr0tH4G49ZJJyGRVMzMSkaYDs2RVuJ58z+5hjEDuZDmLUksKj5oXzjNYSlJbYv5i6yevZ8sdXTfPzG/0YAaNKVATTp3PCnwDcetwgAvrEYAB5vEoBv6Jsb/mHvge2QmJ+SVYDFLgaAxwlq3rI7a+cuu1s2d+kdaJxvw+yFh8HG8RxCCBuh2hJQDFeAmLNwGwIIu6HaNqAYouBFyw/o/MPfZ4oPRMq9QACgIAEAMVICgLKyynrXiXVMADBqrA+ssjsh2huikrLBxfcLiDfCZ6VLrJ6tla2C8vJKYBiGf1wRgAeBgZIQ5gZAY5ikOwA6ADoAjBmKjQewfmYwdjIyBgAHoutGTcdTZu6hAL6yABGJmZKj4CLr5yOIGo2dGJSKbyq0H0yfs1YWIDDyPyMIt35WucTqqStRKxuXC0cxRMq2zhekSyAh8zB928N0Gv5Xbeunh5bbPh9IGiO/yI+DXbzuMc6ed0BgrzvgF/ZOYomuKY5ZretLTCH6sGRegKLjVus2EVMJADrFpmjPqg2PXa05ceAAdCOm1M6d0CN2jS4hZrWmRGZnVEpLa2siQGdiLsVuzO0ft1q7hgY9ooG51H+pn1CvT9yg6UVak6oAILzSjyQsMWUAAAAASUVORK5CYII=',
    sites: [
      { domain: 'teams.live.com', label: 'Free' },
      { domain: 'teams.microsoft.com', label: 'Work' },
      { domain: 'teams.cloud.microsoft', label: 'M365' }
    ]
  }
};

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
      <div class="cta-card-title">💻 ${getMessage('desktopCtaTitle')}</div>
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
      const tooltipText = `Microsoft Teams\n${group.sites.map(s => s.domain).join('\n')}`;
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
