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
import { WorkerSession } from './WorkerSession';


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
  private session: WorkerSession | null = null;
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
    if (this.session?.ready && this.currentModel?.id === modelId) {
      return { loadTimeMs: 0 };
    }

    // Dispose previous worker if switching models
    if (this.session) {
      this.dispose();
    }

    const manager = ModelManager.getInstance();
    const workerType = model.asrWorkerType || 'sherpa-onnx';

    // Load model file blob URLs (and any worker-specific metadata) before
    // creating the worker, so the WorkerSession can be constructed
    // synchronously once everything it needs is in hand.
    // `fileUrls` always holds the RAW/unfiltered blob-URL map for the model —
    // it's what `revokeBlobs` below revokes, so every object URL we created
    // must stay reachable through it (including package-metadata.json on the
    // sherpa path, which is filtered OUT of the worker payload but must still
    // be revoked). `dataFileUrls` (sherpa-only) holds the filtered payload
    // actually sent to the worker.
    let fileUrls: Record<string, string>;
    let dataFileUrls: Record<string, string> | undefined;
    let dtype: string | Record<string, string> | undefined;
    let dataPackageMetadata: Record<string, unknown> | undefined;

    if (workerType === 'voxtral-webgpu') {
      if (!await manager.isModelReady(modelId)) {
        throw new Error(`Model "${modelId}" is not downloaded.`);
      }
      // Variant info before blob URLs: if it throws, no object URLs exist yet
      // to leak (matches AsrEngine's ordering).
      ({ dtype } = await manager.getModelVariantInfo(modelId));
      fileUrls = await manager.getModelBlobUrls(modelId);
    } else {
      // sherpa-onnx streaming path
      if (!await manager.isModelReady(modelId)) {
        throw new Error(`Streaming ASR model "${modelId}" is not downloaded.`);
      }
      fileUrls = await manager.getModelBlobUrls(modelId);

      // `revokeBlobs` isn't wired up until the WorkerSession is constructed
      // below, so any throw here must revoke the raw map itself, or the model's
      // object URLs leak on init failure (matches AsrEngine's sherpa path).
      const metadataBlobUrl = fileUrls['package-metadata.json'];
      if (!metadataBlobUrl) {
        manager.revokeBlobUrls(fileUrls);
        throw new Error(`Missing package-metadata.json for streaming ASR model "${modelId}"`);
      }
      try {
        const metadataResponse = await fetch(metadataBlobUrl);
        dataPackageMetadata = await metadataResponse.json();
      } catch (err: any) {
        manager.revokeBlobUrls(fileUrls);
        throw new Error(`Failed to read package metadata: ${err.message}`);
      }

      dataFileUrls = {};
      for (const [name, url] of Object.entries(fileUrls)) {
        if (name !== 'package-metadata.json') {
          dataFileUrls[name] = url;
        }
      }
    }

    // Create worker based on type
    const makeWorker = (): Worker => {
      switch (workerType) {
        case 'voxtral-webgpu':
          return new Worker(
            new URL('../workers/voxtral-webgpu.worker.ts', import.meta.url),
            { type: 'module' },
          );
        default: // sherpa-onnx streaming
          return new Worker('./workers/sherpa-onnx-streaming-asr.worker.js');
      }
    };

    const session = new WorkerSession({
      makeWorker,
      revokeBlobs: () => manager.revokeBlobUrls(fileUrls),
      onFatalError: (message) => this.onError?.(message),
      onMessage: (msg: StreamingAsrWorkerOutMessage) => {
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

    // Send init message based on worker type
    const ready = workerType === 'voxtral-webgpu'
      ? await session.start({
          type: 'init',
          fileUrls,
          hfModelId: model.hfModelId,
          language: options?.language,
          vadConfig: options?.vadConfig,
          dtype,
          vadModelUrl: new URL('./wasm/vad/silero_vad_v5.onnx', window.location.href).href,
          ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
        })
      : await session.start({
          type: 'init',
          fileUrls: dataFileUrls,
          asrEngine: model.asrEngine,
          runtimeBaseUrl: new URL(ASR_STREAM_BUNDLED_RUNTIME_PATH, window.location.href).href,
          dataPackageMetadata,
        });

    this.currentModel = model;
    return { loadTimeMs: ready.loadTimeMs };
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
    if (!this.session?.ready) return;

    // Transfer the buffer for zero-copy performance
    this.session.post(
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
    if (!this.session?.ready) return;
    this.session.post({ type: 'flush' });
  }

  /**
   * Get list of available streaming ASR models.
   */
  static getModels(): ModelManifestEntry[] {
    return getManifestByType('asr-stream');
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
