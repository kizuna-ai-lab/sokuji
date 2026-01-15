import { ParticipantRecorder } from './ParticipantRecorder';
import { ParticipantAudioOptions } from './IParticipantAudioRecorder';

/**
 * Cross-platform Loopback Recorder for capturing system audio on Windows and macOS
 * Uses Electron's desktopCapturer with setDisplayMediaRequestHandler for loopback audio
 *
 * This replaces WindowsLoopbackRecorder and provides macOS support.
 *
 * Architecture:
 * 1. Main process sets up setDisplayMediaRequestHandler with audio: 'loopback'
 * 2. Renderer calls getDisplayMedia() which triggers the handler
 * 3. Handler returns screen source with loopback audio
 * 4. Extract audio track and discard video track
 *
 * Note: The video track is required to trigger the handler but is immediately
 * discarded since we only need the audio.
 */
export class LoopbackRecorder extends ParticipantRecorder {
  private videoTrack: MediaStreamTrack | null = null;

  protected getLogPrefix(): string {
    return '[Sokuji] [LoopbackRecorder]';
  }

  /**
   * Don't connect to audio destination - system audio is already playing on speakers
   * Connecting would cause echo/feedback
   */
  protected shouldConnectToDestination(): boolean {
    return false;
  }

  /**
   * Acquire system audio stream via getDisplayMedia
   * Uses electron-audio-loopback library for cross-platform loopback audio
   *
   * IMPORTANT: Must call enableLoopbackAudio() BEFORE getDisplayMedia()
   * and disableLoopbackAudio() AFTER getting the stream.
   * See: https://github.com/nicktgn/electron-audio-loopback
   */
  protected async acquireStream(_options?: ParticipantAudioOptions): Promise<MediaStream> {
    console.info(`${this.getLogPrefix()} Requesting system audio via getDisplayMedia`);

    // Step 1: Enable loopback audio BEFORE calling getDisplayMedia
    // This configures the setDisplayMediaRequestHandler to provide loopback audio
    console.info(`${this.getLogPrefix()} Enabling loopback audio...`);
    await window.electron.invoke('enable-loopback-audio');

    try {
      // Step 2: Request display media - handler now provides loopback audio
      // Video is required to trigger the handler, but we discard it immediately
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Required to trigger the handler
        audio: true  // This will be loopback audio from setDisplayMediaRequestHandler
      });

      // Step 3: Disable loopback audio AFTER getting the stream
      console.info(`${this.getLogPrefix()} Disabling loopback audio...`);
      await window.electron.invoke('disable-loopback-audio');

      // Extract and stop the video track (we only need audio)
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0) {
        this.videoTrack = videoTracks[0];
        this.videoTrack.stop();
        stream.removeTrack(this.videoTrack);
        console.info(`${this.getLogPrefix()} Video track removed (audio-only capture)`);
      }

      // Verify we have an audio track
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track in loopback stream. Ensure system audio is available.');
      }

      console.info(`${this.getLogPrefix()} System audio stream acquired successfully`);
      console.info(`${this.getLogPrefix()} Audio track settings:`, audioTracks[0].getSettings());

      return stream;

    } catch (error) {
      // Always disable loopback audio on error to clean up state
      try {
        console.info(`${this.getLogPrefix()} Disabling loopback audio after error...`);
        await window.electron.invoke('disable-loopback-audio');
      } catch (disableError) {
        console.warn(`${this.getLogPrefix()} Failed to disable loopback audio:`, disableError);
      }

      // Handle specific error types
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          console.warn(`${this.getLogPrefix()} User cancelled screen picker or permission denied`);
          throw new Error('Screen capture permission denied. Please allow screen sharing to capture system audio.');
        }
        if (error.name === 'NotFoundError') {
          console.warn(`${this.getLogPrefix()} No suitable capture source found`);
          throw new Error('No screen source available for audio capture.');
        }
        if (error.name === 'NotSupportedError') {
          console.warn(`${this.getLogPrefix()} getDisplayMedia not supported`);
          throw new Error('System audio capture not supported. Ensure Electron is properly configured.');
        }
      }
      throw error;
    }
  }

  /**
   * Clean up resources
   */
  protected async onCleanup(): Promise<void> {
    if (this.videoTrack) {
      try {
        this.videoTrack.stop();
      } catch (e) {
        // Track may already be stopped
      }
      this.videoTrack = null;
    }
    console.info(`${this.getLogPrefix()} Cleanup complete`);
  }
}
