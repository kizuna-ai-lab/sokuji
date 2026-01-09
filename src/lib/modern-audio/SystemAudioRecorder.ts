import { ParticipantRecorder } from './ParticipantRecorder';
import { ParticipantAudioOptions } from './IParticipantAudioRecorder';

/**
 * System Audio Recorder for capturing system/loopback audio
 * Used for translating other meeting participants' voices in Electron (Linux PipeWire)
 */
export class SystemAudioRecorder extends ParticipantRecorder {

  protected getLogPrefix(): string {
    return '[Sokuji] [SystemAudioRecorder]';
  }

  protected shouldConnectToDestination(): boolean {
    return false; // System audio is muted (not played back)
  }

  protected async acquireStream(options?: ParticipantAudioOptions): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: {
        ...this.getAudioConstraints(),
        deviceId: options?.deviceId ? { exact: options.deviceId } : undefined,
      }
    };

    console.info(`${this.getLogPrefix()} Device ID:`, options?.deviceId || 'default');
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  protected async onCleanup(): Promise<void> {
    // No special cleanup needed for system audio
  }
}
