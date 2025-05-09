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
   * @param wavStreamPlayer The WavStreamPlayer to configure for virtual output
   * @returns Promise resolving to true if virtual output was successfully set up, false otherwise
   */
  setupVirtualAudioOutput(wavStreamPlayer: WavStreamPlayer): Promise<boolean>;
}
