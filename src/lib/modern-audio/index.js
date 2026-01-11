/**
 * Modern Audio Library
 * Echo cancellation friendly audio processing using standard browser APIs
 */

export { ModernAudioRecorder } from './ModernAudioRecorder';
export { ModernAudioPlayer } from './ModernAudioPlayer.js';
export { ModernBrowserAudioService } from './ModernBrowserAudioService';
export { LinuxLoopbackRecorder } from './LinuxLoopbackRecorder';
export { WindowsLoopbackRecorder } from './WindowsLoopbackRecorder';
export { TabAudioRecorder } from './TabAudioRecorder';

// Participant audio interface and base classes
export { IParticipantAudioRecorder, ParticipantAudioOptions, AudioDataCallback, isParticipantAudioRecorder } from './IParticipantAudioRecorder';
export { BaseAudioRecorder } from './BaseAudioRecorder';
export { ParticipantRecorder } from './ParticipantRecorder';

// Re-export for compatibility
export const WavRecorder = ModernAudioRecorder;
export const WavStreamPlayer = ModernAudioPlayer;