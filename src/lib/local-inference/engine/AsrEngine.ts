/**
 * AsrEngine — Main thread wrapper for the ASR Web Worker.
 * Provides a simple API for feeding audio and receiving transcription results.
 *
 * Uses a classic Web Worker (public/wasm/sherpa-onnx-asr/asr.worker.js)
 * because sherpa-onnx Emscripten glue requires importScripts().
 */

import type { AsrWorkerOutMessage } from '../types';
import {
  getManifestEntry,
  getManifestByType,
  type ModelManifestEntry,
} from '../modelManifest';
import { ModelManager } from '../ModelManager';

export interface AsrResult {
  text: string;
  startSample: number;
  durationMs: number;
  recognitionTimeMs: number;
}

type ResultCallback = (result: AsrResult) => void;
type StatusCallback = (message: string) => void;
type ErrorCallback = (error: string) => void;

export class AsrEngine {
  private worker: Worker | null = null;
  private isReady = false;
  private currentModel: ModelManifestEntry | null = null;

  onResult: ResultCallback | null = null;
  onStatus: StatusCallback | null = null;
  onError: ErrorCallback | null = null;

  /**
   * Initialize the ASR engine with a specific model.
   * Downloads WASM and model data, creates VAD + OfflineRecognizer.
   *
   * @param modelId - Model identifier (e.g. 'sensevoice', 'reazonspeech')
   * @returns Promise that resolves with load time when ready
   */
  async init(modelId: string): Promise<{ loadTimeMs: number }> {
    const model = getManifestEntry(modelId);
    if (!model || model.type !== 'asr') {
      const available = getManifestByType('asr').map(m => m.id).join(', ');
      throw new Error(`Unknown ASR model: ${modelId}. Available: ${available}`);
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
      throw new Error(`ASR model "${modelId}" is not downloaded. Download it first via Model Management.`);
    }
    const fileUrls = await manager.getModelBlobUrls(modelId);

    return new Promise((resolve, reject) => {
      const workerUrl = '/workers/asr.worker.js';
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (event: MessageEvent<AsrWorkerOutMessage>) => {
        const msg = event.data;
        switch (msg.type) {
          case 'ready':
            this.isReady = true;
            this.currentModel = model;
            // Revoke blob URLs after worker has loaded (frees memory, worker has its own copies)
            manager.revokeBlobUrls(fileUrls);
            resolve({ loadTimeMs: msg.loadTimeMs });
            break;

          case 'status':
            this.onStatus?.(msg.message);
            break;

          case 'result':
            this.onResult?.({
              text: msg.text,
              startSample: msg.startSample,
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
        const message = error.message || 'ASR Worker error';
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
   * Feed audio samples to the ASR engine.
   * Audio is processed through VAD → OfflineRecognizer.
   * Results arrive asynchronously via onResult callback.
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
   * Get list of available ASR models.
   */
  static getModels(): ModelManifestEntry[] {
    return getManifestByType('asr');
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
