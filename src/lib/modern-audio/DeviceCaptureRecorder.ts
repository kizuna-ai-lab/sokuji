import { ParticipantRecorder } from './ParticipantRecorder';
import { ParticipantAudioOptions } from './IParticipantAudioRecorder';

/**
 * Participant recorder that captures one specific input device.
 *
 * Used for per-application capture on Linux, where the main process links a
 * chosen application's output into a private null sink and we record that
 * sink's monitor. Unlike LoopbackRecorder this never touches getDisplayMedia,
 * so it needs no screen-capture permission and shows no picker dialog.
 *
 * Subclassing ParticipantRecorder is right here - this path really does yield a
 * MediaStream, which is exactly what that base class is built around. The
 * Windows path pushes raw PCM instead and implements the interface directly.
 */
export class DeviceCaptureRecorder extends ParticipantRecorder {
  protected getLogPrefix(): string {
    return '[Sokuji] [DeviceCaptureRecorder]';
  }

  /**
   * The captured application is already audible on the user's speakers, so
   * routing this stream to the destination would double it and feed back.
   */
  protected shouldConnectToDestination(): boolean {
    return false;
  }

  protected async acquireStream(options?: ParticipantAudioOptions): Promise<MediaStream> {
    const deviceId = options?.deviceId;
    if (!deviceId) {
      throw new Error(`${this.getLogPrefix()}: a deviceId is required for device capture`);
    }

    console.info(`${this.getLogPrefix()} Capturing input device ${deviceId}`);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { ...this.getAudioConstraints(), deviceId: { exact: deviceId } },
      });
    } catch (error) {
      // The tap sink disappears if the captured application exits mid-session.
      if (error instanceof Error && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')) {
        throw new Error('The selected application audio source is no longer available.');
      }
      throw error;
    }

    if (stream.getAudioTracks().length === 0) {
      throw new Error('No audio track in the captured device stream.');
    }

    console.info(`${this.getLogPrefix()} Device stream acquired`);
    return stream;
  }

  protected async onCleanup(): Promise<void> {
    console.info(`${this.getLogPrefix()} Cleanup complete`);
  }
}
