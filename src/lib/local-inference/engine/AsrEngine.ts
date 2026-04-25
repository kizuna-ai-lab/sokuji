/**
 * AsrEngine — Main thread wrapper for offline ASR Web Workers.
 * Provides a simple API for feeding audio and receiving transcription results.
 *
 * Supports multiple worker backends:
 * - sherpa-onnx (classic Worker): VAD + OfflineRecognizer via Emscripten/WASM
 * - whisper-webgpu (module Worker): VAD + Whisper via Transformers.js/WebGPU
 * - cohere-transcribe-webgpu (module Worker): VAD + Cohere Transcribe via Transformers.js/WebGPU
 * - voxtral-3b-webgpu (module Worker): VAD + Voxtral 3B (with lang hint) via Transformers.js/WebGPU
 * - granite-speech-webgpu (module Worker): VAD + Granite Speech via Transformers.js/WebGPU
 */

import type { AsrWorkerOutMessage, StreamingAsrWorkerOutMessage, VadWebConfig } from '../types';
import {
  getManifestEntry,
  getManifestByType,
  ASR_BUNDLED_RUNTIME_PATH,
  type ModelManifestEntry,
} from '../modelManifest';
import { ModelManager } from '../ModelManager';

export interface AsrResult {
  text: string;
  startSample?: number;
  durationMs: number;
  recognitionTimeMs: number;
}

type ResultCallback = (result: AsrResult) => void;
type PartialResultCallback = (text: string) => void;
type StatusCallback = (message: string) => void;
type ErrorCallback = (error: string) => void;

export class AsrEngine {
  private worker: Worker | null = null;
  private isReady = false;
  private currentModel: ModelManifestEntry | null = null;

  onResult: ResultCallback | null = null;
  onPartialResult: PartialResultCallback | null = null;
  onSpeechStart: (() => void) | null = null;
  onStatus: StatusCallback | null = null;
  onError: ErrorCallback | null = null;

  /**
   * Initialize the ASR engine with a specific model.
   * Downloads WASM and model data, creates VAD + OfflineRecognizer.
   *
   * @param modelId - Model identifier (e.g. 'sensevoice-int8', 'moonshine-tiny-en-quant')
   * @returns Promise that resolves with load time when ready
   */
  async init(modelId: string, vadConfig?: VadWebConfig, language?: string, taskConfig?: { task: 'transcribe' | 'translate'; targetLanguage?: string }): Promise<{ loadTimeMs: number }> {
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
    const { dtype } = await manager.getModelVariantInfo(modelId);
    const fileUrls = await manager.getModelBlobUrls(modelId);

    const workerType = model.asrWorkerType || 'sherpa-onnx';

    // Cohere Transcribe requires an explicit source language
    if (workerType === 'cohere-transcribe-webgpu' && !language) {
      throw new Error('Cohere Transcribe requires a source language');
    }

    return new Promise((resolve, reject) => {
      // Create worker based on type
      switch (workerType) {
        case 'whisper-webgpu':
          this.worker = new Worker(
            new URL('../workers/whisper-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
          break;
        case 'cohere-transcribe-webgpu':
          this.worker = new Worker(
            new URL('../workers/cohere-transcribe-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
          break;
        case 'voxtral-3b-webgpu':
          this.worker = new Worker(
            new URL('../workers/voxtral-3b-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
          break;
        case 'granite-speech-webgpu':
          this.worker = new Worker(
            new URL('../workers/granite-speech-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
          break;
        default: // sherpa-onnx
          this.worker = new Worker('./workers/sherpa-onnx-asr.worker.js');
          break;
      }

      // Cohere and Voxtral 3B workers emit StreamingAsrWorkerOutMessage
      // (includes 'partial'); other workers emit AsrWorkerOutMessage. Handle the union.
      this.worker.onmessage = (event: MessageEvent<AsrWorkerOutMessage | StreamingAsrWorkerOutMessage>) => {
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

          case 'speech_start':
            this.onSpeechStart?.();
            break;

          case 'partial':
            this.onPartialResult?.(msg.text);
            break;

          case 'result':
            this.onResult?.({
              text: msg.text,
              startSample: 'startSample' in msg ? msg.startSample : undefined,
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

      // Send init message — format depends on worker type
      if (workerType === 'whisper-webgpu' || workerType === 'cohere-transcribe-webgpu' || workerType === 'voxtral-3b-webgpu') {
        this.worker.postMessage({
          type: 'init',
          fileUrls,
          hfModelId: model.hfModelId,
          language,
          vadConfig,
          dtype,
          ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
          vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
        });
      } else if (workerType === 'granite-speech-webgpu') {
        this.worker.postMessage({
          type: 'init',
          fileUrls,
          hfModelId: model.hfModelId,
          language,
          vadConfig,
          task: taskConfig?.task ?? 'transcribe',
          targetLanguage: taskConfig?.targetLanguage,
          dtype,
          ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
          vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
        });
      } else {
        // sherpa-onnx: extract metadata and pass .data blob URL
        const metadataBlobUrl = fileUrls['package-metadata.json'];
        if (!metadataBlobUrl) {
          manager.revokeBlobUrls(fileUrls);
          reject(new Error(`Missing package-metadata.json for ASR model "${modelId}"`));
          return;
        }

        fetch(metadataBlobUrl)
          .then(r => r.json())
          .then(dataPackageMetadata => {
            const dataFileUrls: Record<string, string> = {};
            for (const [name, url] of Object.entries(fileUrls)) {
              if (name !== 'package-metadata.json') {
                dataFileUrls[name] = url;
              }
            }
            this.worker!.postMessage({
              type: 'init',
              fileUrls: dataFileUrls,
              asrEngine: model.asrEngine,
              vadConfig,
              runtimeBaseUrl: new URL(ASR_BUNDLED_RUNTIME_PATH, window.location.href).href,
              dataPackageMetadata,
            });
          })
          .catch(err => {
            manager.revokeBlobUrls(fileUrls);
            reject(new Error(`Failed to read package metadata: ${err.message}`));
          });
      }
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
   * Flush any pending VAD speech segment through ASR.
   * Used on PTT release to force recognition without waiting for silence detection.
   */
  flush(): void {
    if (!this.worker || !this.isReady) return;
    this.worker.postMessage({ type: 'flush' });
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
