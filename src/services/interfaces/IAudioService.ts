import { AudioDevice } from '../../contexts/AudioContext';
import { WavStreamPlayer } from '../../lib/wavtools/index.js';

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
   * Select and activate an input device (microphone)
   */
  selectInputDevice(deviceId: string): Promise<AudioOperationResult>;
  
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
   * Setup virtual audio output with the provided WavStreamPlayer
   * @param externalWavStreamPlayer Optional external WavStreamPlayer to configure for virtual output
   * @returns Promise resolving to true if virtual output was successfully set up, false otherwise
   */
  setupVirtualAudioOutput(externalWavStreamPlayer?: WavStreamPlayer): Promise<boolean>;
  
  /**
   * Gets the current WavStreamPlayer instance, creating one if it doesn't exist
   */
  getWavStreamPlayer(): WavStreamPlayer;
  
  /**
   * Connects the WavStreamPlayer to the audio context
   */
  connectWavStreamPlayer(): Promise<boolean>;
  
  /**
   * Adds 16-bit PCM audio data to the WavStreamPlayer
   * @param data The audio data to add
   * @param trackId Optional track ID to associate with this audio
   */
  addAudioData(data: Int16Array, trackId?: string): void;
  
  /**
   * Interrupts the currently playing audio
   * @returns Object containing trackId and offset if audio was interrupted
   */
  interruptAudio(): Promise<{ trackId: string; offset: number } | null>;
  
  /**
   * Checks if a track has been interrupted
   * @param trackId The track ID to check
   */
  isTrackInterrupted(trackId: string): boolean;
  
  /**
   * Clears the list of interrupted track IDs
   */
  clearInterruptedTracks(): void;
}
