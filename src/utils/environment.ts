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
 * Get the backend base URL based on the current environment
 * @returns The backend base URL (e.g., https://sokuji.kizuna.ai)
 *
 * Note: Better Auth client automatically appends /api/auth to this URL.
 * For API calls that need /api prefix, use getApiUrl() instead.
 */
export function getBackendUrl(): string {
  // Use environment variable if available, otherwise use production URL
  return import.meta.env.VITE_BACKEND_URL || 'https://sokuji.kizuna.ai';
}

/**
 * Get the full API URL based on the current environment
 * @returns The API URL with /api suffix (e.g., https://sokuji.kizuna.ai/api)
 *
 * Use this for direct API calls (e.g., OpenAI proxy, OTT verify).
 */
export function getApiUrl(): string {
  return `${getBackendUrl()}/api`;
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

/**
 * Check if Palabra AI features should be enabled
 * @returns true if Palabra AI features should be shown
 *
 * In development mode: always returns true
 * In production mode: returns false (unless explicitly enabled via VITE_ENABLE_PALABRA_AI env var)
 */
export function isPalabraAIEnabled(): boolean {
  // In development mode, always show Palabra AI features
  if (isDevelopmentMode()) {
    return true;
  }

  // In production, check for explicit environment variable
  return import.meta.env?.VITE_ENABLE_PALABRA_AI === 'true';
}

// ============================================================================
// Operating System Detection
// ============================================================================

/**
 * Operating system types that can be detected
 */
export type OperatingSystem = 'windows' | 'macos' | 'linux' | 'unknown';

/**
 * Get the current operating system
 * Uses navigator.platform for browser-side detection
 * @returns The detected operating system
 */
export function getOperatingSystem(): OperatingSystem {
  if (typeof navigator === 'undefined') return 'unknown';

  const platform = navigator.platform.toLowerCase();

  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'macos';
  if (platform.includes('linux')) return 'linux';

  return 'unknown';
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return getOperatingSystem() === 'windows';
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return getOperatingSystem() === 'macos';
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return getOperatingSystem() === 'linux';
}

/**
 * Check if running on a platform that supports loopback audio capture
 * (Windows and macOS use electron-audio-loopback, Linux uses PulseAudio)
 */
export function isLoopbackPlatform(): boolean {
  return isWindows() || isMacOS();
}

