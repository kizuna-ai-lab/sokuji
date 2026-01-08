import { ParticipantRecorder } from './ParticipantRecorder';
import { ParticipantAudioOptions } from './IParticipantAudioRecorder';

/* global chrome */

/**
 * Tab Audio Recorder for browser extension
 * Captures audio from the current tab using Chrome's tabCapture API
 * Used for translating other meeting participants' voices in video conferencing
 */
export class TabAudioRecorder extends ParticipantRecorder {
  private tabId: number | null = null;
  private streamId: string | null = null;

  protected getLogPrefix(): string {
    return '[TabAudioRecorder]';
  }

  protected shouldConnectToDestination(): boolean {
    return true; // Tab audio needs passthrough (play back to user)
  }

  protected async acquireStream(options?: ParticipantAudioOptions): Promise<MediaStream> {
    // Get tab ID
    this.tabId = options?.tabId ?? await this.getTabIdFromContext();
    if (!this.tabId) {
      throw new Error('Could not determine tab ID for audio capture');
    }

    console.info(`${this.getLogPrefix()} Starting capture for tab:`, this.tabId);

    // Request stream ID from background script
    const response = await this.sendMessageToBackground({
      type: 'START_TAB_CAPTURE',
      tabId: this.tabId
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to start tab capture');
    }

    this.streamId = response.streamId || null;
    console.info(`${this.getLogPrefix()} Received streamId:`, this.streamId);

    // Get media stream using Chrome tab capture
    return navigator.mediaDevices.getUserMedia({
      audio: {
        // @ts-expect-error Chrome-specific constraints
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: this.streamId
        }
      },
      video: false
    });
  }

  protected async onCleanup(): Promise<void> {
    // Notify background script to stop capture
    if (this.tabId) {
      await this.sendMessageToBackground({ type: 'STOP_TAB_CAPTURE', tabId: this.tabId });
    }
    this.tabId = null;
    this.streamId = null;
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

  private sendMessageToBackground(message: object): Promise<{ success: boolean; streamId?: string; error?: string }> {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { success: false, error: 'No response' });
          }
        });
      } else {
        resolve({ success: false, error: 'Chrome runtime not available' });
      }
    });
  }
}
