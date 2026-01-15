import { AudioDevice } from '../../stores/audioStore';
import { ModernAudioPlayer, ModernAudioRecorder } from '../../lib/modern-audio';

export interface AudioDevices {
  inputs: AudioDevice[];
  outputs: AudioDevice[];
}

export interface AudioOperationResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface AudioRecordingCallback {
  (data: { mono: Int16Array; raw: Int16Array }): void;
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
   * @param metadata Optional metadata (e.g., itemId, sequenceNumber)
   */
  addAudioData(data: Int16Array, trackId?: string, shouldPlay?: boolean, metadata?: any): void;
  
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

  /**
   * Start recording audio from the specified device
   * @param deviceId The device ID to record from
   * @param callback Function to receive audio data chunks
   */
  startRecording(deviceId: string | undefined, callback: AudioRecordingCallback): Promise<void>;

  /**
   * Stop recording and clean up resources
   */
  stopRecording(): Promise<void>;

  /**
   * Pause recording (keeps resources allocated)
   */
  pauseRecording(): Promise<void>;

  /**
   * Switch recording device while maintaining session
   * @param deviceId The new device ID to switch to
   */
  switchRecordingDevice?(deviceId: string | undefined): Promise<void>;

  /**
   * Get the recorder instance for accessing methods like getFrequencies
   */
  getRecorder(): ModernAudioRecorder;

  /**
   * Setup passthrough settings
   * @param enabled Whether passthrough is enabled
   * @param volume Passthrough volume (0.0 to 1.0)
   */
  setupPassthrough(enabled: boolean, volume: number): void;

  /**
   * Handle passthrough audio routing to outputs
   * @param audioData The audio data to passthrough
   * @param volume The volume level
   */
  handlePassthroughAudio(audioData: Int16Array, volume: number): void;

  // System audio capture methods (for translating other participants)
  // Architecture: Virtual mic is created at startup, connection switching is dynamic
  // - connectSystemAudioSource: Switches pw-link connection when user selects a device
  // - disconnectSystemAudioSource: Disconnects pw-link when user deselects
  // - startSystemAudioRecording: Starts recording from the system audio mic when session starts
  // - stopSystemAudioRecording: Stops recording but keeps virtual mic

  /**
   * Check if system audio capture is supported
   */
  supportsSystemAudioCapture(): boolean;

  /**
   * Get available system audio sources (audio outputs that can be captured)
   */
  getSystemAudioSources?(): Promise<AudioDevice[]>;

  /**
   * Connect a system audio source to the virtual mic
   * Called when user selects a system audio device
   * @param sourceDeviceId The sink name to capture audio from
   */
  connectSystemAudioSource(sourceDeviceId: string): Promise<void>;

  /**
   * Disconnect the current system audio source
   * Called when user deselects the system audio device
   */
  disconnectSystemAudioSource(): Promise<void>;

  /**
   * Check if a system audio source is currently connected
   */
  isSystemAudioSourceConnected(): boolean;

  /**
   * Start recording from the system audio virtual mic
   * Called when session starts
   * @param callback Function to receive audio data chunks
   */
  startSystemAudioRecording(callback: AudioRecordingCallback): Promise<void>;

  /**
   * Stop recording from system audio (but keep connection)
   * Called when session ends
   */
  stopSystemAudioRecording(): Promise<void>;

  /**
   * Check if system audio recording is currently active
   */
  isSystemAudioRecordingActive(): boolean;

  // Loopback audio permission check (Windows/macOS only)

  /**
   * Check and request screen recording permission for loopback audio
   * Only applicable for Windows/macOS where electron-audio-loopback is used
   * Triggers the system permission dialog if needed
   * @returns Promise resolving to true if permission granted, false if denied/cancelled
   */
  requestLoopbackAudioStream(): Promise<boolean>;

  // Tab audio capture methods (for browser extension - translating other participants)

  /**
   * Check if tab audio capture is supported (browser extension only)
   */
  supportsTabAudioCapture(): boolean;

  /**
   * Start recording from the current tab's audio
   * @param callback Function to receive audio data chunks
   * @param outputDeviceId Optional output device ID for audio passthrough
   */
  startTabAudioRecording(callback: AudioRecordingCallback, outputDeviceId?: string): Promise<void>;

  /**
   * Stop recording from tab audio
   */
  stopTabAudioRecording(): Promise<void>;

  /**
   * Check if tab audio recording is currently active
   */
  isTabAudioRecordingActive(): boolean;

  // Unified participant audio capture (abstracts both system audio and tab audio)

  /**
   * Options for participant audio recording
   */
  // Note: ParticipantAudioOptions defined below

  /**
   * Start recording participant audio (auto-detects environment)
   * - Extension: uses tab audio capture via Chrome tabCapture API
   * - Electron: uses system audio capture via PipeWire/PulseAudio loopback
   * @param callback Function to receive audio data chunks
   * @param options Optional configuration (outputDeviceId for passthrough)
   */
  startParticipantAudioRecording(callback: AudioRecordingCallback, options?: { outputDeviceId?: string }): Promise<void>;

  /**
   * Stop participant audio recording
   */
  stopParticipantAudioRecording(): Promise<void>;

  /**
   * Check if participant audio recording is currently active
   */
  isParticipantAudioRecordingActive(): boolean;

  /**
   * Check if participant audio capture is available
   * Returns true if either system audio (Electron) or tab audio (Extension) is available
   */
  supportsParticipantAudioCapture(): boolean;
}
