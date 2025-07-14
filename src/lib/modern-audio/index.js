/**
 * Modern Audio Library
 * Echo cancellation friendly audio processing using standard browser APIs
 */

export { ModernAudioRecorder } from './ModernAudioRecorder.js';
export { ModernAudioPlayer } from './ModernAudioPlayer.js';
export { ModernPassthrough } from './ModernPassthrough.js';
export { ModernBrowserAudioService } from './ModernBrowserAudioService';

// Re-export for compatibility
export const WavRecorder = ModernAudioRecorder;
export const WavStreamPlayer = ModernAudioPlayer;