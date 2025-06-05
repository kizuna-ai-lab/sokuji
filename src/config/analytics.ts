// Analytics configuration that works in both Electron and extension environments
// This replaces the need for environment variables

export const ANALYTICS_CONFIG = {
  POSTHOG_KEY: 'phc_EMOuUDTntTI5SuzKQATy11qHgxVrlhJsgNFbBaWEhet',
  POSTHOG_HOST: 'https://us.i.posthog.com',
} as const;

// Environment detection that works in both Electron and extension
export const getEnvironment = (): 'development' | 'production' => {
  // Check if we're in development mode
  // This works for both Vite (import.meta.env) and webpack environments
  try {
    // Try Vite first (Electron)
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      return import.meta.env.DEV ? 'development' : 'production';
    }
  } catch (e) {
    // Ignore error if import.meta is not available
  }

  try {
    // Try webpack/Node.js environment (extension)
    if (typeof (globalThis as any).process !== 'undefined' && (globalThis as any).process.env) {
      return (globalThis as any).process.env.NODE_ENV === 'development' ? 'development' : 'production';
    }
  } catch (e) {
    // Ignore error if process is not available
  }

  // Fallback: check for common development indicators
  const isDev = 
    // Check for localhost
    (typeof window !== 'undefined' && window.location && 
     (window.location.hostname === 'localhost' || 
      window.location.hostname === '127.0.0.1' ||
      window.location.port === '5173')) ||
    // Check for development build indicators
    (typeof document !== 'undefined' && document.title && 
     document.title.includes('dev')) ||
    // Check for Chrome extension development mode
    (typeof (globalThis as any).chrome !== 'undefined' && (globalThis as any).chrome.runtime && 
     (globalThis as any).chrome.runtime.getManifest && 
     !('update_url' in (globalThis as any).chrome.runtime.getManifest()));

  return isDev ? 'development' : 'production';
};

// Check if we're in development mode
export const isDevelopment = (): boolean => {
  return getEnvironment() === 'development';
};

// Platform detection utility - distinguishes between app and extension
export const getPlatform = (): string => {
  // Check if running as Chrome extension
  const chromeAPI = (window as any).chrome;
  if (typeof chromeAPI !== 'undefined' && chromeAPI.runtime && chromeAPI.runtime.id) {
    return 'extension';
  }
  
  // Check if running in Electron (desktop app)
  const isElectron = (window as any).electronAPI || 
                     (window as any).require || 
                     navigator.userAgent.includes('Electron');
  
  if (isElectron) {
    return 'app';
  }
  
  // Default to web if neither extension nor app
  return 'web';
}; 