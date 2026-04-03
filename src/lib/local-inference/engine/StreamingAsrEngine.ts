/**
 * StreamingAsrEngine — Main thread wrapper for streaming ASR Web Workers.
 * Provides a simple API for feeding audio and receiving real-time transcription.
 *
 * Supports multiple worker backends:
 * - sherpa-onnx (classic Worker): OnlineRecognizer with built-in endpoint detection
 * - voxtral-webgpu (module Worker): Voxtral Mini 4B with VAD + punctuation endpoints
 *
 * Unlike AsrEngine (offline VAD + batch recognition), streaming engines emit
 * partial (interim) results as speech is being recognized and final results
 * when an endpoint is detected.
 */

import type { StreamingAsrWorkerOutMessage, VadWebConfig } from '../types';
import {
  getManifestEntry,
  getManifestByType,
  ASR_STREAM_BUNDLED_RUNTIME_PATH,
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
  onSpeechStart: (() => void) | null = null;
  onStatus: StatusCallback | null = null;
  onError: ErrorCallback | null = null;

  async init(modelId: string, options?: { language?: string; vadConfig?: VadWebConfig }): Promise<{ loadTimeMs: number }> {
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

    const manager = ModelManager.getInstance();
    const workerType = model.asrWorkerType || 'sherpa-onnx';

    return new Promise(async (resolve, reject) => {
      try {
        // Create worker based on type
        switch (workerType) {
          case 'voxtral-webgpu':
            this.worker = new Worker(
              new URL('../workers/voxtral-webgpu.worker.ts', import.meta.url),
              { type: 'module' },
            );
            break;
          default: // sherpa-onnx streaming
            this.worker = new Worker('./workers/sherpa-onnx-streaming-asr.worker.js');
            break;
        }

        this.worker.onmessage = (event: MessageEvent<StreamingAsrWorkerOutMessage>) => {
          const msg = event.data;
          switch (msg.type) {
            case 'ready':
              this.isReady = true;
              this.currentModel = model;
              resolve({ loadTimeMs: msg.loadTimeMs });
              break;

            case 'status':
              this.onStatus?.(msg.message);
              break;

            case 'speech_start':
              this.onSpeechStart?.();
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
            reject(new Error(message));
          }
        };

        // Send init message based on worker type
        if (workerType === 'voxtral-webgpu') {
          if (!await manager.isModelReady(modelId)) {
            throw new Error(`Model "${modelId}" is not downloaded.`);
          }
          const fileUrls = await manager.getModelBlobUrls(modelId);
          const { dtype } = await manager.getModelVariantInfo(modelId);

          // Cleanup blob URLs on ready or init error
          const cleanup = () => manager.revokeBlobUrls(fileUrls);
          const origOnMessage = this.worker.onmessage;
          this.worker.onmessage = (event: MessageEvent<StreamingAsrWorkerOutMessage>) => {
            const msg = event.data;
            if (msg.type === 'ready' || (msg.type === 'error' && !this.isReady)) {
              cleanup();
            }
            origOnMessage?.call(this.worker, event);
          };

          this.worker.postMessage({
            type: 'init',
            fileUrls,
            hfModelId: model.hfModelId,
            language: options?.language,
            vadConfig: options?.vadConfig,
            dtype,
            vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
            ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
          });
        } else {
          // sherpa-onnx streaming path (unchanged logic)
          if (!await manager.isModelReady(modelId)) {
            throw new Error(`Streaming ASR model "${modelId}" is not downloaded.`);
          }
          const fileUrls = await manager.getModelBlobUrls(modelId);

          const metadataBlobUrl = fileUrls['package-metadata.json'];
          if (!metadataBlobUrl) {
            throw new Error(`Missing package-metadata.json for streaming ASR model "${modelId}"`);
          }
          const metadataResponse = await fetch(metadataBlobUrl);
          const dataPackageMetadata = await metadataResponse.json();

          const dataFileUrls: Record<string, string> = {};
          for (const [name, url] of Object.entries(fileUrls)) {
            if (name !== 'package-metadata.json') {
              dataFileUrls[name] = url;
            }
          }

          // Store fileUrls reference for cleanup on ready/error
          const cleanup = () => manager.revokeBlobUrls(fileUrls);
          const origOnMessage = this.worker.onmessage;
          this.worker.onmessage = (event: MessageEvent<StreamingAsrWorkerOutMessage>) => {
            const msg = event.data;
            if (msg.type === 'ready' || (msg.type === 'error' && !this.isReady)) {
              cleanup();
            }
            origOnMessage?.call(this.worker, event);
          };

          this.worker.postMessage({
            type: 'init',
            fileUrls: dataFileUrls,
            asrEngine: model.asrEngine,
            runtimeBaseUrl: new URL(ASR_STREAM_BUNDLED_RUNTIME_PATH, window.location.href).href,
            dataPackageMetadata,
          });
        }
      } catch (err) {
        reject(err);
      }
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
   * Force-finalize any pending utterance.
   * Used by Push-to-Talk to immediately emit the current partial result
   * as a final result when the user releases the PTT key.
   */
  flush(): void {
    if (!this.worker || !this.isReady) return;
    this.worker.postMessage({ type: 'flush' });
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
