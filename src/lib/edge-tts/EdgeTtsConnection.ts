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
 *
 * Correlating events across overlapping requests: each generate() call gets
 * a monotonically increasing requestId. Incoming IPC events carry the
 * requestId they were produced for, and stale events (id !== currentRequestId)
 * are ignored. This prevents a late edge-tts-done from a prior request from
 * resolving the next generate() call.
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

/** IPC payload shapes (main → renderer). `mp3Data` is Uint8Array after Electron
 *  serialisation (renderers don't have Node's `Buffer`). */
interface EdgeTtsAudioChunkPayload {
  requestId: number;
  mp3Data: Uint8Array | ArrayBuffer;
}
interface EdgeTtsTerminalPayload {
  requestId: number;
}
interface EdgeTtsErrorPayload {
  requestId: number;
  error: string;
}

export class EdgeTtsConnection {
  private onMp3Chunk: Mp3ChunkCallback | null = null;
  private onDone: DoneCallback | null = null;
  private onError: ErrorCallback | null = null;

  // Per-call request id used to filter out stale IPC events from earlier generations
  private currentRequestId = 0;

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
    // Bump request id so any in-flight late IPC events are ignored
    this.currentRequestId++;

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

    // Handlers are created once and persist. They check requestId against the
    // currently active generation and drop stale events from earlier requests.
    window.electron.receive('edge-tts-audio-chunk', (data: EdgeTtsAudioChunkPayload) => {
      if (data.requestId !== this.currentRequestId) return;
      // Electron serialises Buffer to Uint8Array over IPC. Normalise either
      // form defensively in case the payload surfaces as an ArrayBuffer.
      const mp3 = data.mp3Data instanceof Uint8Array
        ? data.mp3Data
        : new Uint8Array(data.mp3Data);
      this.onMp3Chunk?.(mp3);
    });

    window.electron.receive('edge-tts-done', (data: EdgeTtsTerminalPayload) => {
      if (data.requestId !== this.currentRequestId) return;
      this.onDone?.();
    });

    window.electron.receive('edge-tts-error', (data: EdgeTtsErrorPayload) => {
      if (data.requestId !== this.currentRequestId) return;
      this.onError?.(data.error);
    });

    this.electronListenersRegistered = true;
  }

  private async generateElectron(options: EdgeTtsGenerateOptions): Promise<void> {
    const { text, voice, speed } = options;

    // Install IPC listeners on first call (idempotent)
    this.ensureElectronListeners();

    // Allocate a fresh request id for this call. Incoming IPC events will be
    // filtered against `this.currentRequestId` in ensureElectronListeners.
    const requestId = ++this.currentRequestId;

    return new Promise<void>((resolve, reject) => {
      // Wrap the caller's callbacks so we can resolve/reject this promise
      // exactly once, whichever event arrives first.
      let settled = false;
      const originalOnDone = this.onDone;
      const originalOnError = this.onError;

      const finish = () => {
        this.onDone = originalOnDone;
        this.onError = originalOnError;
      };

      this.onDone = () => {
        if (settled) return;
        settled = true;
        finish();
        originalOnDone?.();
        resolve();
      };

      this.onError = (error: string) => {
        if (settled) return;
        settled = true;
        finish();
        originalOnError?.(error);
        reject(new Error(error));
      };

      // Ask main process to start streaming. The requestId is echoed back
      // on every IPC event so we can discard events from earlier requests.
      window.electron.invoke('edge-tts-generate', { requestId, text, voice, speed }).then(
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

    // Bump request id so late events from a prior call are ignored
    const myRequestId = ++this.currentRequestId;

    // Set DNR headers before connecting. If any step after this throws before
    // WebSocket close/error fires, we must clear DNR rules manually so the
    // injected header isn't left active indefinitely.
    const shouldManageDnr = isExtension();
    if (shouldManageDnr) {
      await this.setExtensionDNR();
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
