import { IParticipantAudioRecorder, ParticipantAudioOptions, AudioDataCallback } from './IParticipantAudioRecorder';

/* global chrome */

/**
 * Tab Audio Recorder for browser extension.
 *
 * The side panel is cross-origin isolated (COOP + COEP in manifest.json) so that
 * the SharedArrayBuffer-backed playback ring buffer can work.  Cross-origin
 * isolation prevents `getUserMedia({ chromeMediaSource: 'tab', … })` from
 * succeeding in the side panel itself (AbortError).
 *
 * This class delegates the actual capture to an **offscreen document** that is
 * NOT cross-origin isolated.  The offscreen document calls getUserMedia, runs
 * an AudioWorklet to convert float32 → PCM16, and sends the frames to the
 * background service worker via a runtime port.  The background relays the
 * frames to the side panel through a second port named `pcm-{tabId}`.
 *
 * Architecture:
 *   Side panel (COI) ←port:pcm-{tabId}← background SW ←port:offscreen-pcm← offscreen doc
 */
export class TabAudioRecorder implements IParticipantAudioRecorder {
  private readonly _sampleRate: number;
  private tabId: number | null = null;
  private port: ChromePort | null = null;
  private onAudioData: AudioDataCallback | null = null;
  private _recording: boolean = false;
  private _started: boolean = false;

  constructor(sampleRate = 24000) {
    this._sampleRate = sampleRate;
  }

  getSampleRate(): number {
    return this._sampleRate;
  }

  getStatus(): 'ended' | 'paused' | 'recording' {
    if (!this._started) return 'ended';
    if (!this._recording) return 'paused';
    return 'recording';
  }

  /**
   * Initiate tab audio capture via the offscreen document.
   * Asks the background to start the offscreen capture pipeline, then opens a
   * runtime port to receive the resulting PCM frames.
   */
  async begin(options?: ParticipantAudioOptions): Promise<boolean> {
    try {
      this.tabId = options?.tabId ?? await this.getTabIdFromContext();
      if (!this.tabId) {
        throw new Error('Could not determine tab ID for audio capture');
      }

      console.info(`[TabAudioRecorder] Starting offscreen capture for tab:`, this.tabId);

      // Ask background to spin up the offscreen document and start capture.
      // The background will call tabCapture.getMediaStreamId and pass the
      // streamId to the offscreen document.
      const response = await this.sendMessageToBackground({
        type: 'START_OFFSCREEN_TAB_CAPTURE',
        tabId: this.tabId,
        outputDeviceId: options?.outputDeviceId || null,
      });

      if (!response.success) {
        throw new Error(response.error || 'Failed to start offscreen tab capture');
      }

      // Open a long-lived port to the background for PCM frame relay.
      // The background routes frames from the offscreen document to this port.
      if (typeof chrome === 'undefined' || !chrome.runtime) {
        throw new Error('Chrome runtime not available');
      }
      this.port = chrome.runtime.connect({ name: `pcm-${this.tabId}` });
      this.port.onDisconnect.addListener(() => {
        if (typeof chrome !== 'undefined' && chrome.runtime.lastError) {
          console.warn(`[TabAudioRecorder] Port disconnected:`, chrome.runtime.lastError.message);
        }
        this.port = null;
        this._recording = false;
        this._started = false;
        console.info('[TabAudioRecorder] Audio capture ended');
      });

      this._started = true;
      console.info(`[TabAudioRecorder] Offscreen capture started for tab:`, this.tabId);
      return true;

    } catch (error) {
      console.error(`[TabAudioRecorder] Failed to start capture:`, error);
      await this._cleanup();
      return false;
    }
  }

  /**
   * Begin forwarding PCM frames to the provided callback.
   */
  async record(callback: AudioDataCallback): Promise<boolean> {
    if (!this._started || !this.port) {
      throw new Error('Session ended: please call .begin() first');
    }
    if (this._recording) {
      throw new Error('Already recording: please call .pause() first');
    }

    this.onAudioData = callback;
    this._recording = true;

    this.port.onMessage.addListener((msg: { type: string; buffer?: ArrayBuffer }) => {
      if (msg.type === 'PCM_DATA' && this._recording && this.onAudioData && msg.buffer) {
        const pcmData = new Int16Array(msg.buffer);
        this.onAudioData({ mono: pcmData, raw: pcmData });
      }
    });

    console.info('[TabAudioRecorder] Recording started');
    return true;
  }

  /**
   * Suspend forwarding of PCM frames without tearing down the capture.
   */
  async pause(): Promise<boolean> {
    if (!this._started) {
      throw new Error('Session ended: please call .begin() first');
    }
    if (!this._recording) {
      throw new Error('Already paused: please call .record() first');
    }

    this._recording = false;
    console.info('[TabAudioRecorder] Recording paused');
    return true;
  }

  /**
   * Stop recording and release all resources.
   */
  async end(): Promise<void> {
    if (this._recording) {
      await this.pause();
    }
    await this._cleanup();
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async _cleanup(): Promise<void> {
    if (this.tabId) {
      try {
        await this.sendMessageToBackground({
          type: 'STOP_OFFSCREEN_TAB_CAPTURE',
          tabId: this.tabId,
        });
      } catch (err) {
        console.warn('[TabAudioRecorder] Error stopping offscreen capture:', err);
      }
    }

    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }

    this.tabId = null;
    this.onAudioData = null;
    this._recording = false;
    this._started = false;
    console.info('[TabAudioRecorder] Audio capture ended');
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
        console.error(`[TabAudioRecorder] Error querying tabs:`, error);
      }
    }
    return null;
  }

  private sendMessageToBackground(message: object): Promise<{ success: boolean; error?: string }> {
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

