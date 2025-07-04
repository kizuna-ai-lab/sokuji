/**
 * Stream processor module for handling audio streaming
 * This file provides the StreamProcessor worklet functionality and URL management
 */

/**
 * Determines if the code is running in a Chrome extension environment
 * @returns {boolean} True if running in a Chrome extension
 */
function isExtensionEnvironment() {
  return typeof window !== 'undefined' && 
         typeof window.chrome !== 'undefined' && 
         typeof window.chrome.runtime !== 'undefined' && 
         typeof window.chrome.runtime.getURL === 'function';
}

/**
 * Creates a source URL for the StreamProcessor AudioWorklet
 * @returns {string} URL to the AudioWorklet code
 */
export function getStreamProcessorSrc() {
  if (isExtensionEnvironment()) {
    // In extension environment, use the file from web_accessible_resources
    return window.chrome.runtime.getURL('worklets/stream_processor_worklet.js');
  } else {
    // In Electron or other environments, use a direct path
    return new URL('./stream_processor_worklet.js', import.meta.url).href;
  }
}

// Export the source URL
export const StreamProcessorSrc = getStreamProcessorSrc();
