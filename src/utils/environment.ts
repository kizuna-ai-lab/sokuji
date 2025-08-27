/**
 * Centralized environment detection utility
 * Provides consistent environment detection across the entire codebase
 */

// Extend Window interface to include Electron-specific properties
declare global {
  interface Window {
    electronAPI?: any;
    require?: any;
    process?: {
      type?: string;
      versions?: {
        electron?: string;
      };
    };
    chrome?: {
      runtime?: {
        id?: string;
        getManifest?: () => any;
        getURL?: (path: string) => string;
      };
      tabs?: {
        create?: (options: { url: string }) => void;
      };
    };
  }
}

/**
 * Detect if the code is running in an Electron environment
 * Uses multiple checks for comprehensive detection
 */
export function isElectron(): boolean {
  // Check for electronAPI (our custom preload API)
  if (window.electronAPI) {
    return true;
  }
  
  // Check for Node.js require function (Electron with nodeIntegration)
  if (window.require) {
    return true;
  }
  
  // Check for Electron in user agent
  if (navigator.userAgent.includes('Electron')) {
    return true;
  }
  
  // Check for Electron process type
  if (window.process?.type === 'renderer') {
    return true;
  }
  
  // Check for Electron versions
  if (window.process?.versions?.electron) {
    return true;
  }
  
  return false;
}

/**
 * Detect if the code is running in a browser extension (Chrome/Edge)
 * Only returns true if NOT in Electron and has chrome.runtime.id
 */
export function isExtension(): boolean {
  // First make sure we're not in Electron
  if (isElectron()) {
    return false;
  }
  
  // Check for Chrome extension runtime ID
  if (typeof window.chrome !== 'undefined' && 
      window.chrome?.runtime && 
      typeof window.chrome.runtime.id === 'string' &&
      window.chrome.runtime.id.length > 0) {
    return true;
  }
  
  return false;
}

/**
 * Detect if the code is running in a regular web browser
 * (not Electron, not extension)
 */
export function isWeb(): boolean {
  return !isElectron() && !isExtension();
}

/**
 * Get the current environment type as a string
 */
export function getEnvironment(): 'electron' | 'extension' | 'web' {
  if (isElectron()) return 'electron';
  if (isExtension()) return 'extension';
  return 'web';
}

/**
 * Check if chrome.tabs API is available (only in extension background/popup)
 */
export function hasChromeTabs(): boolean {
  return isExtension() && 
         typeof window.chrome?.tabs?.create === 'function';
}

/**
 * Check if chrome.runtime API is available
 */
export function hasChromeRuntime(): boolean {
  return typeof window.chrome?.runtime !== 'undefined';
}

/**
 * Get the backend API URL based on the current environment
 * @returns The backend API URL
 */
export function getBackendUrl(): string {
  // Use environment variable if available, otherwise use production URL
  return import.meta.env.VITE_BACKEND_URL || 'https://sokuji-api.kizuna.ai';
}

/**
 * Check if running in development mode
 * @returns true if in development mode
 */
export function isDevelopmentMode(): boolean {
  return import.meta.env.MODE === 'development';
}

/**
 * Check if running in production mode
 * @returns true if in production mode
 */
export function isProductionMode(): boolean {
  return import.meta.env.MODE === 'production';
}

/**
 * Check if Kizuna AI features should be enabled
 * @returns true if Kizuna AI features should be shown
 * 
 * In development mode: always returns true
 * In production mode: returns false (unless explicitly enabled via VITE_ENABLE_KIZUNA_AI env var)
 */
export function isKizunaAIEnabled(): boolean {
  // In development mode, always show Kizuna AI features
  if (isDevelopmentMode()) {
    return true;
  }
  
  // In production, check for explicit environment variable
  // Default to false if not set
  return import.meta.env.VITE_ENABLE_KIZUNA_AI === 'true';
}

