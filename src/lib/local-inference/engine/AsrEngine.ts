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
import { WorkerSession } from './WorkerSession';

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
  private session: WorkerSession | null = null;
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
    if (this.session?.ready && this.currentModel?.id === modelId) {
      return { loadTimeMs: 0 };
    }

    // Dispose previous worker if switching models
    if (this.session) {
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

    // Create worker based on type
    const makeWorker = (): Worker => {
      switch (workerType) {
        case 'whisper-webgpu':
          return new Worker(
            new URL('../workers/whisper-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
        case 'cohere-transcribe-webgpu':
          return new Worker(
            new URL('../workers/cohere-transcribe-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
        case 'voxtral-3b-webgpu':
          return new Worker(
            new URL('../workers/voxtral-3b-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
        case 'granite-speech-webgpu':
          return new Worker(
            new URL('../workers/granite-speech-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
        default: // sherpa-onnx
          return new Worker('./workers/sherpa-onnx-asr.worker.js');
      }
    };

    // Cohere and Voxtral 3B workers emit StreamingAsrWorkerOutMessage
    // (includes 'partial'); other workers emit AsrWorkerOutMessage. Handle the union.
    const session = new WorkerSession({
      makeWorker,
      revokeBlobs: () => manager.revokeBlobUrls(fileUrls),
      onFatalError: (message) => this.onError?.(message),
      onMessage: (msg: AsrWorkerOutMessage | StreamingAsrWorkerOutMessage) => {
        switch (msg.type) {
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
            // Post-ready error; pre-ready 'error' is handled by WorkerSession.
            this.onError?.(msg.error);
            break;
        }
      },
    });
    this.session = session;

    // Send init message — format depends on worker type
    let ready: { loadTimeMs: number };
    if (workerType === 'whisper-webgpu' || workerType === 'cohere-transcribe-webgpu' || workerType === 'voxtral-3b-webgpu') {
      ready = await session.start({
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
      ready = await session.start({
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
        throw new Error(`Missing package-metadata.json for ASR model "${modelId}"`);
      }

      let dataPackageMetadata: Record<string, unknown>;
      try {
        const response = await fetch(metadataBlobUrl);
        dataPackageMetadata = await response.json();
      } catch (err: any) {
        manager.revokeBlobUrls(fileUrls);
        throw new Error(`Failed to read package metadata: ${err.message}`);
      }

      const dataFileUrls: Record<string, string> = {};
      for (const [name, url] of Object.entries(fileUrls)) {
        if (name !== 'package-metadata.json') {
          dataFileUrls[name] = url;
        }
      }

      ready = await session.start({
        type: 'init',
        fileUrls: dataFileUrls,
        asrEngine: model.asrEngine,
        vadConfig,
        runtimeBaseUrl: new URL(ASR_BUNDLED_RUNTIME_PATH, window.location.href).href,
        dataPackageMetadata,
      });
    }

    this.currentModel = model;
    return { loadTimeMs: ready.loadTimeMs };
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
    if (!this.session?.ready) return;

    // Transfer the buffer for zero-copy performance
    this.session.post(
      { type: 'audio', samples, sampleRate },
      [samples.buffer]
    );
  }

  /**
   * Flush any pending VAD speech segment through ASR.
   * Used on PTT release to force recognition without waiting for silence detection.
   */
  flush(): void {
    if (!this.session?.ready) return;
    this.session.post({ type: 'flush' });
  }

  /**
   * Get list of available ASR models.
   */
  static getModels(): ModelManifestEntry[] {
    return getManifestByType('asr');
  }

  get ready(): boolean {
    return this.session?.ready ?? false;
  }

  get model(): ModelManifestEntry | null {
    return this.currentModel;
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
    this.currentModel = null;
  }
}
