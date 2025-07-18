import { AudioDevice } from '../../contexts/AudioContext';
import { ModernAudioPlayer } from '../../lib/modern-audio';

export interface AudioDevices {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}

export interface AudioOperationResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface IAudioService {
  /**
   * Get available audio input and output devices
   */
  getDevices(): Promise<AudioDevices>;
  
  
  /**
   * Connect to a monitoring device
   */
  connectMonitoringDevice(deviceId: string, label: string): Promise<AudioOperationResult>;
  
  /**
   * Disconnect all monitoring devices
   */
  disconnectMonitoringDevices(): Promise<AudioOperationResult>;
  
  /**
   * Create virtual audio devices if supported by the platform
   */
  createVirtualDevices?(): Promise<AudioOperationResult>;
  
  /**
   * Check if the current environment supports virtual audio devices
   */
  supportsVirtualDevices(): boolean;
  
  /**
   * Initialize the audio service
   */
  initialize(): Promise<void>;
  
  /**
   * Setup virtual audio output with the provided ModernAudioPlayer
   * @param externalPlayer Optional external ModernAudioPlayer to configure for virtual output
   * @returns Promise resolving to true if virtual output was successfully set up, false otherwise
   */
  setupVirtualAudioOutput(externalPlayer?: ModernAudioPlayer): Promise<boolean>;
  
  /**
   * Gets the current ModernAudioPlayer instance, creating one if it doesn't exist
   */
  getWavStreamPlayer(): ModernAudioPlayer;
  
  /**
   * Set monitor volume (0 to mute, 1 for normal)
   * @param enabled Whether monitor is enabled
   */
  setMonitorVolume(enabled: boolean): void;
  
  /**
   * Adds 16-bit PCM audio data to the ModernAudioPlayer
   * @param data The audio data to add
   * @param trackId Optional track ID to associate with this audio
   * @param shouldPlay Whether to play the audio (defaults to true for backward compatibility)
   */
  addAudioData(data: Int16Array, trackId?: string, shouldPlay?: boolean): void;
  
  /**
   * Interrupts the currently playing audio
   * @returns Object containing trackId and offset if audio was interrupted
   */
  interruptAudio(): Promise<{ trackId: string; offset: number } | null>;

  /**
   * Clear streaming audio data for a specific track
   * @param trackId The track ID to clear
   */
  clearStreamingTrack(trackId: string): void;
  
  
  /**
   * Clears the list of interrupted track IDs
   */
  clearInterruptedTracks(): void;
}
