import { BaseAudioRecorder } from './BaseAudioRecorder';
import { IParticipantAudioRecorder, ParticipantAudioOptions, AudioDataCallback } from './IParticipantAudioRecorder';

/**
 * Abstract base class for participant audio recorders (System Audio and Tab Audio)
 * Provides shared implementation for IParticipantAudioRecorder interface
 *
 * Key characteristics:
 * - Disables echo cancellation (participant audio is already processed)
 * - Implements begin/record/pause/end lifecycle
 * - Subclasses only need to implement acquireStream and onCleanup
 */
export abstract class ParticipantRecorder extends BaseAudioRecorder implements IParticipantAudioRecorder {

  /**
   * Get audio constraints for participant audio capture
   * IMPORTANT: Disable all audio processing for participant audio
   */
  protected getAudioConstraints(): MediaTrackConstraints {
    return {
      sampleRate: this.sampleRate,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
  }

  /**
   * Acquire the media stream - subclasses must implement
   */
  protected abstract acquireStream(options?: ParticipantAudioOptions): Promise<MediaStream>;

  /**
   * Cleanup specific to subclass - called before base cleanup
   */
  protected abstract onCleanup(): Promise<void>;

  /**
   * Hook called after AudioContext is created, before audio processing setup.
   * Subclasses can override to configure AudioContext (e.g., setSinkId for tab capture).
   */
  protected async onAudioContextCreated(_options?: ParticipantAudioOptions): Promise<void> {
    // Default: no-op. Subclasses can override.
  }

  /**
   * Begin capturing audio
   */
  async begin(options?: ParticipantAudioOptions): Promise<boolean> {
    if (this.stream) {
      throw new Error(`${this.getLogPrefix()}: Already connected. Please call .end() first`);
    }

    try {
      console.info(`${this.getLogPrefix()} Starting audio capture...`);

      // Acquire stream (implemented by subclass)
      this.stream = await this.acquireStream(options);

      // Create AudioContext
      this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Allow subclasses to configure AudioContext (e.g., set output device for tab capture)
      await this.onAudioContextCreated(options);

      // Setup audio processing (from BaseAudioRecorder)
      await this.setupRealtimeAudioProcessing();

      console.info(`${this.getLogPrefix()} Audio capture ready`);
      return true;

    } catch (error) {
      console.error(`${this.getLogPrefix()} Failed to start capture:`, error);
      await this.cleanup();
      return false;
    }
  }

  /**
   * Start recording with callback
   */
  async record(callback: AudioDataCallback): Promise<boolean> {
    if (!this.stream) {
      throw new Error('Session ended: please call .begin() first');
    }
    if (this.recording) {
      throw new Error('Already recording: please call .pause() first');
    }
    if (typeof callback !== 'function') {
      throw new Error('callback must be a function');
    }

    this.onAudioData = callback;
    this.startRecording();
    return true;
  }

  /**
   * Pause the recording
   */
  async pause(): Promise<boolean> {
    if (!this.stream) {
      throw new Error('Session ended: please call .begin() first');
    }
    if (!this.recording) {
      throw new Error('Already paused: please call .record() first');
    }

    this.stopRecording();
    return true;
  }

  /**
   * End recording session and clean up
   */
  async end(): Promise<void> {
    if (!this.stream) {
      return; // Already ended
    }

    console.info(`${this.getLogPrefix()} Stopping audio capture`);

    // Stop recording if active
    if (this.recording) {
      await this.pause();
    }

    // Subclass-specific cleanup
    await this.onCleanup();

    // Base cleanup
    await this.cleanup();
  }
}
