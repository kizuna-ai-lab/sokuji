/**
 * EdgeTtsConnection — Platform-aware WebSocket connection to Bing TTS.
 *
 * - Electron: session.webRequest.onBeforeSendHeaders injects User-Agent header,
 *   then connects via a standard browser WebSocket (same as extension path).
 * - Extension: uses declarativeNetRequest to inject headers, then connects directly.
 *
 * Streams parsed MP3 audio chunks back to the caller via callbacks.
 *
 * Correlating events across overlapping requests: each generate() call gets
 * a monotonically increasing requestId. Late events from a prior request
 * (id !== currentRequestId) are ignored.
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
  EDGE_TTS_CHROMIUM_MAJOR,
} from './edgeTts';

export interface EdgeTtsGenerateOptions {
  text: string;
  voice?: string;
  speed?: number; // multiplier, 1.0 = normal
}

type Mp3ChunkCallback = (mp3Data: Uint8Array) => void;
type DoneCallback = () => void;
type ErrorCallback = (error: string) => void;

const EDGE_TTS_WS_HOST = 'speech.platform.bing.com';

export class EdgeTtsConnection {
  private onMp3Chunk: Mp3ChunkCallback | null = null;
  private onDone: DoneCallback | null = null;
  private onError: ErrorCallback | null = null;

  // Per-call request id used to filter out stale events from earlier generations
  private currentRequestId = 0;

  // WebSocket per call (used in both Electron and Extension)
  private ws: WebSocket | null = null;
  private dnrSet = false;
  private electronHeadersSet = false;

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

    await this.generateViaWebSocket(options);
  }

  /**
   * Cancel any in-progress generation and clean up.
   */
  dispose(): void {
    // Bump request id so any in-flight late events are ignored
    this.currentRequestId++;

    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    if (this.dnrSet && isExtension()) {
      this.clearExtensionDNR();
    }
    if (this.electronHeadersSet && isElectron()) {
      this.clearElectronHeaders();
    }

    this.onMp3Chunk = null;
    this.onDone = null;
    this.onError = null;
  }

  // ── Unified WebSocket path ──────────────────────────────────────────

  private async generateViaWebSocket(options: EdgeTtsGenerateOptions): Promise<void> {
    const { text, voice, speed } = options;
    const voiceName = voice || DEFAULT_VOICE;
    const speedPercent = Math.round(((speed || 1.0) - 1.0) * 100);

    // Bump request id so late events from a prior call are ignored
    const myRequestId = ++this.currentRequestId;

    // Set up header injection before connecting
    const shouldManageDnr = isExtension();
    const shouldManageElectronHeaders = isElectron() && !!window.electron?.invoke;

    if (shouldManageDnr) {
      await this.setExtensionDNR();
    }
    if (shouldManageElectronHeaders) {
      await this.setElectronHeaders();
    }

    let wsUrl: string;
    let requestIdHex: string;
    try {
      const secMsGec = await makeSecMsGec();
      const connectionId = makeConnectionId();
      requestIdHex = makeConnectionId();
      wsUrl = buildSynthesisUrl(secMsGec, connectionId);
    } catch (err) {
      if (shouldManageDnr && this.dnrSet) {
        this.clearExtensionDNR();
      }
      if (shouldManageElectronHeaders && this.electronHeadersSet) {
        this.clearElectronHeaders();
      }
      throw err;
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (err) {
        if (shouldManageDnr && this.dnrSet) {
          this.clearExtensionDNR();
        }
        if (shouldManageElectronHeaders && this.electronHeadersSet) {
          this.clearElectronHeaders();
        }
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      let audioReceived = false;

      ws.onopen = () => {
        ws.send(buildSpeechConfigMessage());
        ws.send(buildSsmlMessage(requestIdHex, voiceName, text, speedPercent));
      };

      ws.onmessage = (event) => {
        // Guard against stale events if the instance has moved on (e.g. dispose)
        if (myRequestId !== this.currentRequestId) return;

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
        if (shouldManageDnr && this.dnrSet) {
          this.clearExtensionDNR();
        }
        if (shouldManageElectronHeaders && this.electronHeadersSet) {
          this.clearElectronHeaders();
        }
        settle(() => {
          if (myRequestId !== this.currentRequestId) {
            // A newer request superseded us — stay silent.
            resolve();
            return;
          }
          if (!audioReceived) {
            const err = 'No audio received from Edge TTS';
            this.onError?.(err);
            reject(new Error(err));
            return;
          }
          this.onDone?.();
          resolve();
        });
      };

      ws.onerror = () => {
        this.ws = null;
        if (shouldManageDnr && this.dnrSet) {
          this.clearExtensionDNR();
        }
        if (shouldManageElectronHeaders && this.electronHeadersSet) {
          this.clearElectronHeaders();
        }
        settle(() => {
          if (myRequestId !== this.currentRequestId) {
            resolve();
            return;
          }
          const err = 'WebSocket connection to Edge TTS failed';
          this.onError?.(err);
          reject(new Error(err));
        });
      };
    });
  }

  // ── Electron header injection ───────────────────────────────────────

  private async setElectronHeaders(): Promise<void> {
    const result = await window.electron.invoke('ws-headers-set', {
      host: EDGE_TTS_WS_HOST,
      headers: {
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${EDGE_TTS_CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${EDGE_TTS_CHROMIUM_MAJOR}.0.0.0`,
      },
    });
    if (!result?.success) {
      throw new Error(`Failed to set WS headers: ${result?.error}`);
    }
    this.electronHeadersSet = true;
  }

  private clearElectronHeaders(): void {
    this.electronHeadersSet = false;
    window.electron.invoke('ws-headers-clear', { host: EDGE_TTS_WS_HOST }).catch(() => {});
  }

  // ── Extension DNR ───────────────────────────────────────────────────

  private async setExtensionDNR(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      chrome!.runtime.sendMessage(
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
    chrome!.runtime.sendMessage({ type: 'EDGE_TTS_CLEAR_HEADERS' }, () => {
      // Fire-and-forget
    });
  }
}
