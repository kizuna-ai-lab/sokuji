/**
 * EdgeTtsConnection — Platform-aware WebSocket connection to Bing TTS.
 *
 * - Electron: proxies via main process IPC (Node.js `ws` with custom headers)
 * - Extension: uses declarativeNetRequest to inject headers, then connects directly
 *
 * Streams parsed MP3 audio chunks back to the caller via callbacks.
 */

import { isElectron, isExtension } from '../../utils/environment';
import {
  makeSecMsGec,
  buildSynthesisUrl,
  buildSpeechConfigMessage,
  buildSsmlMessage,
  parseTextHeaders,
  parseBinaryAudioFrame,
  makeCookie,
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

  // Electron IPC handlers
  private ipcChunkHandler: ((data: { mp3Data: Buffer }) => void) | null = null;
  private ipcDoneHandler: (() => void) | null = null;
  private ipcErrorHandler: ((data: { error: string }) => void) | null = null;

  // Extension WebSocket
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
   * Cancel any in-progress generation.
   */
  dispose(): void {
    // Electron: cancel IPC
    if (isElectron() && window.electron) {
      this.removeElectronListeners();
      window.electron.invoke('edge-tts-cancel').catch(() => {});
    }

    // Extension: close WebSocket + clear DNR
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

  private async generateElectron(options: EdgeTtsGenerateOptions): Promise<void> {
    const { text, voice, speed } = options;

    return new Promise<void>((resolve, reject) => {
      // Register IPC listeners for streamed data from main process
      this.ipcChunkHandler = (data: { mp3Data: Buffer }) => {
        // Main process sends mp3Data as Buffer, convert to Uint8Array
        const mp3 = new Uint8Array(data.mp3Data);
        this.onMp3Chunk?.(mp3);
      };

      this.ipcDoneHandler = () => {
        this.removeElectronListeners();
        this.onDone?.();
        resolve();
      };

      this.ipcErrorHandler = (data: { error: string }) => {
        this.removeElectronListeners();
        this.onError?.(data.error);
        reject(new Error(data.error));
      };

      window.electron.receive('edge-tts-audio-chunk', this.ipcChunkHandler);
      window.electron.receive('edge-tts-done', this.ipcDoneHandler);
      window.electron.receive('edge-tts-error', this.ipcErrorHandler);

      // Invoke main process to start TTS
      window.electron.invoke('edge-tts-generate', { text, voice, speed }).then(
        (result: { success: boolean; error?: string }) => {
          if (!result.success) {
            this.removeElectronListeners();
            const err = result.error || 'Edge TTS generation failed';
            this.onError?.(err);
            reject(new Error(err));
          }
          // If success, audio-done IPC will resolve the promise
        },
      ).catch((err: Error) => {
        this.removeElectronListeners();
        this.onError?.(err.message);
        reject(err);
      });
    });
  }

  private removeElectronListeners(): void {
    if (this.ipcChunkHandler) {
      window.electron?.removeListener('edge-tts-audio-chunk', this.ipcChunkHandler);
      this.ipcChunkHandler = null;
    }
    if (this.ipcDoneHandler) {
      window.electron?.removeListener('edge-tts-done', this.ipcDoneHandler);
      this.ipcDoneHandler = null;
    }
    if (this.ipcErrorHandler) {
      window.electron?.removeListener('edge-tts-error', this.ipcErrorHandler);
      this.ipcErrorHandler = null;
    }
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
