import { ParticipantRecorder } from './ParticipantRecorder';
import { ParticipantAudioOptions } from './IParticipantAudioRecorder';

/**
 * Linux Loopback Recorder for capturing system audio on Linux
 * Uses PulseAudio/PipeWire virtual microphone to capture system audio output
 * Used for translating other meeting participants' voices in Electron on Linux
 */
export class LinuxLoopbackRecorder extends ParticipantRecorder {

  protected getLogPrefix(): string {
    return '[Sokuji] [LinuxLoopbackRecorder]';
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
