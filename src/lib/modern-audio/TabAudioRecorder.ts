import { ParticipantRecorder } from './ParticipantRecorder';
import { ParticipantAudioOptions } from './IParticipantAudioRecorder';
import { chromeTabStreamDeps, openTabStream } from '../screen/tabStream';

/* global chrome */

/**
 * Tab Audio Recorder for browser extension
 * Captures audio from the current tab using Chrome's tabCapture API
 * Used for translating other meeting participants' voices in video conferencing
 */
export class TabAudioRecorder extends ParticipantRecorder {
  private tabId: number | null = null;
  /** This recorder's share of the tab's capture (`openTabStream`); null when it holds none. */
  private releaseTab: (() => Promise<void>) | null = null;
  private outputDeviceId: string | null = null;

  protected getLogPrefix(): string {
    return '[TabAudioRecorder]';
  }

  protected shouldConnectToDestination(): boolean {
    return true; // Tab audio needs passthrough (play back to user)
  }

  /**
   * Configure AudioContext output device for tab audio passthrough.
   * Chrome tabCapture stops original tab audio, so we must manually route it to the output device.
   */
  protected async onAudioContextCreated(options?: ParticipantAudioOptions): Promise<void> {
    this.outputDeviceId = options?.outputDeviceId || null;

    // Set output device if specified (Chrome 110+ supports setSinkId)
    // Required for tab capture: Chrome stops original audio when tab is captured
    if (this.outputDeviceId && this.audioContext && 'setSinkId' in this.audioContext) {
      try {
        // @ts-expect-error setSinkId is not in TypeScript types yet
        await this.audioContext.setSinkId(this.outputDeviceId);
        console.info(`${this.getLogPrefix()} Set audio output device:`, this.outputDeviceId);
      } catch (sinkError) {
        console.warn(`${this.getLogPrefix()} Failed to set output device, using default:`, sinkError);
      }
    }
  }

  protected async acquireStream(options?: ParticipantAudioOptions): Promise<MediaStream> {
    // Get tab ID
    this.tabId = options?.tabId ?? await this.getTabIdFromContext();
    if (!this.tabId) {
      throw new Error('Could not determine tab ID for audio capture');
    }

    console.info(`${this.getLogPrefix()} Starting capture for tab:`, this.tabId);

    // The tab's one capture, shared with the screen context when it asks for the video too.
    const tab = await openTabStream(this.tabId, { audio: true, video: options?.video === true }, chromeTabStreamDeps());
    this.releaseTab = tab.release;

    // The recorder's cleanup stops every track of the stream it holds: it gets the audio only, so the video
    // another opener shares stays live until the last release.
    return new MediaStream(tab.stream.getAudioTracks());
  }

  protected async onCleanup(): Promise<void> {
    this.tabId = null;
    await this.releaseTabCapture();
  }

  /**
   * A begin() that fails after the capture opened ends in cleanup() alone, never onCleanup():
   * the share is let go here too, or the capture would stay open for the tab's next opener.
   */
  protected async cleanup(): Promise<void> {
    try {
      await this.releaseTabCapture();
    } finally {
      await super.cleanup();
    }
  }

  private async releaseTabCapture(): Promise<void> {
    const release = this.releaseTab;
    this.releaseTab = null;
    await release?.();
  }

  private async getTabIdFromContext(): Promise<number | null> {
    const urlParams = new URLSearchParams(window.location.search);
    const tabIdParam = urlParams.get('tabId');
    if (tabIdParam) return parseInt(tabIdParam, 10);

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0 && tabs[0].id) return tabs[0].id;
      } catch (error) {
        console.error(`${this.getLogPrefix()} Error querying tabs:`, error);
      }
    }
    return null;
  }
}
