/**
 * StreamingAsrEngine — Main thread wrapper for the Streaming ASR Web Worker.
 * Provides a simple API for feeding audio and receiving real-time transcription.
 *
 * Uses a classic Web Worker (public/workers/streaming-asr.worker.js)
 * because sherpa-onnx Emscripten glue requires importScripts().
 *
 * Unlike AsrEngine (offline VAD + OfflineRecognizer), this engine uses
 * OnlineRecognizer for real-time streaming recognition with built-in
 * endpoint detection. It emits partial (interim) results as speech is
 * being recognized and final results when an endpoint is detected.
 */

import type { StreamingAsrWorkerOutMessage } from '../types';
import {
  getManifestEntry,
  getManifestByType,
  type ModelManifestEntry,
} from '../modelManifest';
import { ModelManager } from '../ModelManager';

export interface StreamingAsrResult {
  text: string;
  durationMs: number;
  recognitionTimeMs: number;
}

type ResultCallback = (result: StreamingAsrResult) => void;
type PartialResultCallback = (text: string) => void;
type StatusCallback = (message: string) => void;
type ErrorCallback = (error: string) => void;

export class StreamingAsrEngine {
  private worker: Worker | null = null;
  private isReady = false;
  private currentModel: ModelManifestEntry | null = null;

  onResult: ResultCallback | null = null;
  onPartialResult: PartialResultCallback | null = null;
  onStatus: StatusCallback | null = null;
  onError: ErrorCallback | null = null;

  /**
   * Initialize the streaming ASR engine with a specific model.
   * Downloads WASM and model data, creates OnlineRecognizer.
   *
   * @param modelId - Model identifier (e.g. 'stream-en', 'stream-zh-en')
   * @returns Promise that resolves with load time when ready
   */
  async init(modelId: string): Promise<{ loadTimeMs: number }> {
    const model = getManifestEntry(modelId);
    if (!model || model.type !== 'asr-stream') {
      const available = getManifestByType('asr-stream').map(m => m.id).join(', ');
      throw new Error(`Unknown streaming ASR model: ${modelId}. Available: ${available}`);
    }

    // If already loaded with same model, skip
    if (this.isReady && this.currentModel?.id === modelId) {
      return { loadTimeMs: 0 };
    }

    // Dispose previous worker if switching models
    if (this.worker) {
      this.dispose();
    }

    // Load model file blob URLs from IndexedDB
    const manager = ModelManager.getInstance();
    if (!await manager.isModelReady(modelId)) {
      throw new Error(`Streaming ASR model "${modelId}" is not downloaded. Download it first via Model Management.`);
    }
    const fileUrls = await manager.getModelBlobUrls(modelId);

    return new Promise((resolve, reject) => {
      const workerUrl = '/workers/streaming-asr.worker.js';
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (event: MessageEvent<StreamingAsrWorkerOutMessage>) => {
        const msg = event.data;
        switch (msg.type) {
          case 'ready':
            this.isReady = true;
            this.currentModel = model;
            // Revoke blob URLs after worker has loaded
            manager.revokeBlobUrls(fileUrls);
            resolve({ loadTimeMs: msg.loadTimeMs });
            break;

          case 'status':
            this.onStatus?.(msg.message);
            break;

          case 'partial':
            this.onPartialResult?.(msg.text);
            break;

          case 'result':
            this.onResult?.({
              text: msg.text,
              durationMs: msg.durationMs,
              recognitionTimeMs: msg.recognitionTimeMs,
            });
            break;

          case 'error':
            this.onError?.(msg.error);
            if (!this.isReady) {
              manager.revokeBlobUrls(fileUrls);
              reject(new Error(msg.error));
            }
            break;

          case 'disposed':
            break;
        }
      };

      this.worker.onerror = (error) => {
        const message = error.message || 'Streaming ASR Worker error';
        this.onError?.(message);
        if (!this.isReady) {
          manager.revokeBlobUrls(fileUrls);
          reject(new Error(message));
        }
      };

      this.worker.postMessage({ type: 'init', fileUrls });
    });
  }

  /**
   * Feed audio samples to the streaming ASR engine.
   * Audio is processed in real-time through OnlineRecognizer.
   * Partial results arrive via onPartialResult callback.
   * Final results arrive via onResult callback when endpoint detected.
   *
   * @param samples - Int16Array audio samples
   * @param sampleRate - Sample rate of the input audio (e.g. 24000)
   */
  feedAudio(samples: Int16Array, sampleRate: number): void {
    if (!this.worker || !this.isReady) return;

    // Transfer the buffer for zero-copy performance
    this.worker.postMessage(
      { type: 'audio', samples, sampleRate },
      [samples.buffer]
    );
  }

  /**
   * Get list of available streaming ASR models.
   */
  static getModels(): ModelManifestEntry[] {
    return getManifestByType('asr-stream');
  }

  get ready(): boolean {
    return this.isReady;
  }

  get model(): ModelManifestEntry | null {
    return this.currentModel;
  }

  dispose(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
    this.currentModel = null;
  }
}
