/**
 * Interface for participant audio recorders
 * Both SystemAudioRecorder and TabAudioRecorder implement this interface
 * to provide a unified API for capturing "other participant" audio
 */

export interface ParticipantAudioOptions {
  /** Device ID for system audio capture (PipeWire/PulseAudio monitor source) */
  deviceId?: string;
  /** Tab ID for Chrome extension tab capture */
  tabId?: number;
  /** Output device ID for audio passthrough (mainly for tab capture) */
  outputDeviceId?: string;
}

export interface AudioDataCallback {
  (data: { mono: Int16Array; raw: Int16Array }): void;
}

export interface IParticipantAudioRecorder {
  /**
   * Get the current sample rate
   */
  getSampleRate(): number;

  /**
   * Get the current recording status
   */
  getStatus(): 'ended' | 'paused' | 'recording';

  /**
   * Begin capturing audio from the source
   * @param options Platform-specific options (deviceId for system, tabId for tab)
   * @returns Promise resolving to true if capture started successfully
   */
  begin(options?: ParticipantAudioOptions): Promise<boolean>;

  /**
   * Start recording audio data
   * @param callback Function to receive audio chunks
   * @returns Promise resolving to true when recording started
   */
  record(callback: AudioDataCallback): Promise<boolean>;

  /**
   * Pause the recording (keeps resources allocated)
   * @returns Promise resolving to true when paused
   */
  pause(): Promise<boolean>;

  /**
   * End recording session and clean up all resources
   */
  end(): Promise<void>;
}

/**
 * Type guard to check if a recorder implements IParticipantAudioRecorder
 */
export function isParticipantAudioRecorder(recorder: unknown): recorder is IParticipantAudioRecorder {
  return (
    recorder !== null &&
    typeof recorder === 'object' &&
    'getSampleRate' in recorder &&
    'getStatus' in recorder &&
    'begin' in recorder &&
    'record' in recorder &&
    'pause' in recorder &&
    'end' in recorder
  );
}
