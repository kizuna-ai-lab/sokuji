/**
 * Audio processor module for handling audio recording and processing
 * This file provides the AudioProcessor worklet functionality and URL management
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
 * Creates a source URL for the AudioWorklet
 * @returns {string} URL to the AudioWorklet code
 */
export function getAudioProcessorSrc() {
  if (isExtensionEnvironment()) {
    // In extension environment, use the file from web_accessible_resources
    return window.chrome.runtime.getURL('worklets/audio_processor_worklet.js');
  } else {
    // In Electron or other environments, use a direct path
    return new URL('./audio_processor_worklet.js', import.meta.url).href;
  }
}

// Export the source URL
export const AudioProcessorSrc = getAudioProcessorSrc();
