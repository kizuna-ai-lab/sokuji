import { ParticipantRecorder } from './ParticipantRecorder';
import { ParticipantAudioOptions } from './IParticipantAudioRecorder';

/**
 * Windows Loopback Recorder for capturing system audio on Windows
 * Captures system audio using desktopCapturer loopback via getDisplayMedia API
 *
 * This recorder is used to capture audio from other meeting participants
 * by capturing all system audio output (loopback) on Windows.
 *
 * Architecture:
 * 1. Main process sets up setDisplayMediaRequestHandler with audio: 'loopback'
 * 2. Renderer calls getDisplayMedia() which triggers the handler
 * 3. Handler returns screen source with loopback audio
 * 4. This recorder extracts the audio track and processes it
 *
 * Note: The video track is required to trigger the handler but is immediately
 * discarded since we only need the audio.
 */
export class WindowsLoopbackRecorder extends ParticipantRecorder {
  private videoTrack: MediaStreamTrack | null = null;

  protected getLogPrefix(): string {
    return '[Sokuji] [WindowsLoopbackRecorder]';
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
   * The main process handler (setDisplayMediaRequestHandler) provides loopback audio
   */
  protected async acquireStream(_options?: ParticipantAudioOptions): Promise<MediaStream> {
    console.info(`${this.getLogPrefix()} Requesting system audio via getDisplayMedia`);

    try {
      // Request display media - main process handler provides loopback audio
      // Video is required to trigger the handler, but we discard it immediately
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Required to trigger the handler
        audio: true  // This will be the loopback audio from setDisplayMediaRequestHandler
      });

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
        throw new Error('No audio track in display media stream. Ensure system audio is available.');
      }

      console.info(`${this.getLogPrefix()} System audio stream acquired successfully`);
      console.info(`${this.getLogPrefix()} Audio track settings:`, audioTracks[0].getSettings());

      return stream;
    } catch (error) {
      // Handle user cancellation of the screen picker
      if (error instanceof Error) {
        if (error.name === 'NotAllowedError') {
          console.warn(`${this.getLogPrefix()} User cancelled screen picker or permission denied`);
          throw new Error('Screen capture permission denied. Please allow screen sharing to capture system audio.');
        }
        if (error.name === 'NotFoundError') {
          console.warn(`${this.getLogPrefix()} No suitable capture source found`);
          throw new Error('No screen source available for audio capture.');
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
