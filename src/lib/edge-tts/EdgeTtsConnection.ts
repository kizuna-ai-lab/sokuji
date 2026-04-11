/**
 * EdgeTtsConnection — Platform-aware WebSocket connection to Bing TTS.
 *
 * - Electron: proxies via main process IPC (Node.js `ws` with custom headers)
 * - Extension: uses declarativeNetRequest to inject headers, then connects directly
 *
 * Streams parsed MP3 audio chunks back to the caller via callbacks.
 *
 * IMPORTANT: Electron IPC listeners are registered ONCE (lazily) and never
 * removed during the instance's lifetime. Electron's contextBridge creates a
 * new function proxy every time a function crosses the boundary, so WeakMap-
 * based listener tracking in the preload is broken — removeListener never
 * matches and old listeners accumulate. We work around this by keeping a
 * single set of listeners that routes to the current callback references.
 */

import { isElectron, isExtension } from '../../utils/environment';
import {
  makeSecMsGec,
  buildSynthesisUrl,
  buildSpeechConfigMessage,
  buildSsmlMessage,
  parseTextHeaders,
  parseBinaryAudioFrame,
  makeConnectionId,
  DEFAULT_VOICE,
} from './edgeTts';

export interface EdgeTtsGenerateOptions {
  text: string;
  voice?: string;
  speed?: number; // multiplier, 1.0 = normal
}

type Mp3ChunkCallback = (mp3Data: Uint8Array) => void;
type DoneCallback = () => void;
type ErrorCallback = (error: string) => void;

export class EdgeTtsConnection {
  private onMp3Chunk: Mp3ChunkCallback | null = null;
  private onDone: DoneCallback | null = null;
  private onError: ErrorCallback | null = null;

  // Electron: IPC listeners are registered once, lazily
  private electronListenersRegistered = false;

  // Extension: WebSocket per call
  private ws: WebSocket | null = null;
  private dnrSet = false;

  /**
   * Generate speech and stream MP3 chunks via callbacks.
   */
  async generate(
    options: EdgeTtsGenerateOptions,
    onMp3Chunk: Mp3ChunkCallback,
    onDone: DoneCallback,
    onError: ErrorCallback,
  ): Promise<void> {
    this.onMp3Chunk = onMp3Chunk;
    this.onDone = onDone;
    this.onError = onError;

    if (isElectron()) {
      await this.generateElectron(options);
    } else if (isExtension()) {
      await this.generateExtension(options);
    } else {
      // Web environment — try extension path (may work if no header check)
      await this.generateExtension(options);
    }
  }

  /**
   * Cancel any in-progress generation and clean up.
   * Note: Electron IPC listeners are NOT removed (see class comment).
   */
  dispose(): void {
    if (isElectron() && window.electron) {
      window.electron.invoke('edge-tts-cancel').catch(() => {});
    }

    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    if (this.dnrSet && isExtension()) {
      this.clearExtensionDNR();
    }

    this.onMp3Chunk = null;
    this.onDone = null;
    this.onError = null;
  }

  // ── Electron path ────────────────────────────────────────────────────

  private ensureElectronListeners(): void {
    if (this.electronListenersRegistered) return;

    // These handlers are created once and persist. They route incoming IPC
    // events to the current callback references stored on `this`, which are
    // updated on every generate() call. This avoids contextBridge proxy
    // identity issues with removeListener.
    window.electron.receive('edge-tts-audio-chunk', (data: { mp3Data: Buffer }) => {
      const mp3 = new Uint8Array(data.mp3Data);
      this.onMp3Chunk?.(mp3);
    });

    window.electron.receive('edge-tts-done', () => {
      this.onDone?.();
    });

    window.electron.receive('edge-tts-error', (data: { error: string }) => {
      this.onError?.(data.error);
    });

    this.electronListenersRegistered = true;
  }

  private async generateElectron(options: EdgeTtsGenerateOptions): Promise<void> {
    const { text, voice, speed } = options;

    // Install IPC listeners on first call (idempotent)
    this.ensureElectronListeners();

    return new Promise<void>((resolve, reject) => {
      // Wrap the caller's callbacks so we can resolve/reject this promise
      // exactly once, whichever event arrives first.
      let settled = false;
      const originalOnDone = this.onDone;
      const originalOnError = this.onError;

      this.onDone = () => {
        if (settled) return;
        settled = true;
        this.onDone = originalOnDone;
        this.onError = originalOnError;
        originalOnDone?.();
        resolve();
      };

      this.onError = (error: string) => {
        if (settled) return;
        settled = true;
        this.onDone = originalOnDone;
        this.onError = originalOnError;
        originalOnError?.(error);
        reject(new Error(error));
      };

      // Ask main process to start streaming
      window.electron.invoke('edge-tts-generate', { text, voice, speed }).then(
        (result: { success: boolean; error?: string }) => {
          if (!result.success && !settled) {
            const err = result.error || 'Edge TTS generation failed';
            this.onError?.(err);
          }
          // On success, resolution is driven by the 'edge-tts-done' IPC event
        },
      ).catch((err: Error) => {
        if (!settled) {
          this.onError?.(err.message);
        }
      });
    });
  }

  // ── Extension path ───────────────────────────────────────────────────

  private async generateExtension(options: EdgeTtsGenerateOptions): Promise<void> {
    const { text, voice, speed } = options;
    const voiceName = voice || DEFAULT_VOICE;
    const speedPercent = Math.round(((speed || 1.0) - 1.0) * 100);

    // Set DNR headers before connecting
    if (isExtension()) {
      await this.setExtensionDNR();
    }

    const secMsGec = await makeSecMsGec();
    const connectionId = makeConnectionId();
    const requestId = makeConnectionId();
    const wsUrl = buildSynthesisUrl(secMsGec, connectionId);

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      let audioReceived = false;

      ws.onopen = () => {
        ws.send(buildSpeechConfigMessage());
        ws.send(buildSsmlMessage(requestId, voiceName, text, speedPercent));
      };

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const headers = parseTextHeaders(event.data);
          if (headers.Path === 'turn.end') {
            ws.close();
          }
          return;
        }

        // Binary frame
        try {
          const data = new Uint8Array(event.data);
          const { headers, body } = parseBinaryAudioFrame(data);
          if (headers.Path === 'audio' && body.length > 0) {
            audioReceived = true;
            this.onMp3Chunk?.(body);
          }
        } catch (err) {
          console.warn('[EdgeTTS] frame parse error:', err);
        }
      };

      ws.onclose = () => {
        this.ws = null;
        if (this.dnrSet && isExtension()) {
          this.clearExtensionDNR();
        }
        if (!audioReceived) {
          const err = 'No audio received from Edge TTS';
          this.onError?.(err);
          reject(new Error(err));
          return;
        }
        this.onDone?.();
        resolve();
      };

      ws.onerror = () => {
        this.ws = null;
        if (this.dnrSet && isExtension()) {
          this.clearExtensionDNR();
        }
        const err = 'WebSocket connection to Edge TTS failed';
        this.onError?.(err);
        reject(new Error(err));
      };
    });
  }

  private async setExtensionDNR(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'EDGE_TTS_SET_HEADERS' },
        (response: { success: boolean; error?: string }) => {
          if (response?.success) {
            this.dnrSet = true;
            resolve();
          } else {
            reject(new Error(response?.error || 'Failed to set Edge TTS DNR headers'));
          }
        },
      );
    });
  }

  private clearExtensionDNR(): void {
    this.dnrSet = false;
    chrome.runtime.sendMessage({ type: 'EDGE_TTS_CLEAR_HEADERS' }, () => {
      // Fire-and-forget
    });
  }
}
