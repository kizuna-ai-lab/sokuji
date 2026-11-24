/**
 * AsrEngine — Main thread wrapper for offline ASR Web Workers.
 * Provides a simple API for feeding audio and receiving transcription results.
 *
 * Supports multiple worker backends:
 * - sherpa-onnx (classic Worker): VAD + OfflineRecognizer via Emscripten/WASM
 * - whisper-webgpu, qwen3-asr-webgpu, cohere-transcribe-webgpu, voxtral-3b-webgpu and
 *   granite-speech-webgpu (module Workers): they run no VAD. The turn detector cuts the turns and sends
 *   each segment on the segment port this engine hands them at init; the engine only relays their
 *   results, partials and drained marks, and the epoch's `stop`.
 */

import type { AsrWorkerOutMessage, SegmentEnd, StreamingAsrWorkerOutMessage, VadWebConfig } from '../types';
import {
  getManifestEntry,
  getManifestByType,
  ASR_BUNDLED_RUNTIME_PATH,
  type ModelManifestEntry,
} from '../modelManifest';
import { ModelManager } from '../ModelManager';
import { WorkerSession } from './WorkerSession';

type ResultCallback = (result: AsrResult) => void;
/** Which segment a partial belongs to, as the detector tagged it (the segment workers only). */
export interface AsrPartialTag {
  press?: number;
  epoch?: number;
}

export interface AsrResult extends Partial<SegmentEnd> {
  text: string;
  startSample?: number;
  durationMs: number;
  recognitionTimeMs: number;
  /** The press this segment belongs to (manual turns). */
  press?: number;
  /** The detector's epoch the segment was cut in. */
  epoch?: number;
}
type PartialResultCallback = (text: string, tag?: AsrPartialTag) => void;
type StatusCallback = (message: string) => void;
type ErrorCallback = (error: string) => void;

export class AsrEngine {
  private session: WorkerSession | null = null;
  private currentModel: ModelManifestEntry | null = null;
  /** Set by `dispose()`: an `init()` still awaiting its model files stops
   *  before it creates a worker (a load aborted mid-way). */
  private disposed = false;

  onResult: ResultCallback | null = null;
  onPartialResult: PartialResultCallback | null = null;
  onSpeechStart: (() => void) | null = null;
  /** The recognizer decoded or dropped everything the detector sent before its drain mark `seq`. */
  onDrained: ((seq: number) => void) | null = null;
  onStatus: StatusCallback | null = null;
  onError: ErrorCallback | null = null;
  /** The worker died (its `onerror`, or a pre-ready `error`); unset, that goes to `onError` as well. */
  onFatal: ErrorCallback | null = null;

  /**
   * Initialize the ASR engine with a specific model.
   * Downloads WASM and model data, creates VAD + OfflineRecognizer.
   *
   * @param modelId - Model identifier (e.g. 'sensevoice-int8', 'moonshine-tiny-en-quant')
   * @param vadConfig - sherpa-onnx's VAD config; the other workers run no VAD and ignore it
   * @param segmentPort - The turn detector's segments for a WebGPU recognizer, transferred with its init message
   * @returns Promise that resolves with load time when ready
   */
  async init(modelId: string, vadConfig?: VadWebConfig, language?: string, taskConfig?: { task: 'transcribe' | 'translate'; targetLanguage?: string }, segmentPort?: MessagePort): Promise<{ loadTimeMs: number }> {
    const model = getManifestEntry(modelId);
    if (!model || model.type !== 'asr') {
      const available = getManifestByType('asr').map(m => m.id).join(', ');
      throw new Error(`Unknown ASR model: ${modelId}. Available: ${available}`);
    }

    const workerType = model.asrWorkerType || 'sherpa-onnx';

    // Every WebGPU recognizer decodes the detector's segments and cannot start without them.
    if (workerType !== 'sherpa-onnx' && !segmentPort) {
      throw new Error(`${model.name} takes its segments from a turn detector: no segment port`);
    }

    // If already loaded with same model, skip. A new segment port belongs to a new detector the loaded worker
    // knows nothing of, so it reloads rather than resolve with the new port dropped.
    if (this.session?.ready && this.currentModel?.id === modelId && !segmentPort) {
      return { loadTimeMs: 0 };
    }

    // Dispose previous worker if switching models
    if (this.session) {
      this.dispose();
    }
    // A dispose() from here on cancels this load before its worker exists.
    this.disposed = false;

    // Load model file blob URLs from IndexedDB
    const manager = ModelManager.getInstance();
    if (!await manager.isModelReady(modelId)) {
      throw new Error(`ASR model "${modelId}" is not downloaded. Download it first via Model Management.`);
    }
    if (this.disposed) throw new Error('disposed');
    const { dtype } = await manager.getModelVariantInfo(modelId);
    if (this.disposed) throw new Error('disposed');
    const fileUrls = await manager.getModelBlobUrls(modelId);
    if (this.disposed) { manager.revokeBlobUrls(fileUrls); throw new Error('disposed'); }

    // Cohere Transcribe requires an explicit source language
    if (workerType === 'cohere-transcribe-webgpu' && !language) {
      throw new Error('Cohere Transcribe requires a source language');
    }

    // sherpa-onnx: extract metadata and pass .data blob URL. This runs BEFORE
    // `new WorkerSession(...)` (below) so the metadata fetch — which can fail
    // or overlap with a worker error — completes before the session's
    // resolve/reject handlers exist; those are only bound inside
    // `session.start()`. If the worker were constructed first and this fetch
    // awaited afterward, a worker onerror/pre-ready 'error' firing during the
    // fetch would settle the session with no reject handler attached yet,
    // and the eventual `session.start(...)` call would hang forever.
    let dataFileUrls: Record<string, string> | undefined;
    let dataPackageMetadata: Record<string, unknown> | undefined;
    if (workerType === 'sherpa-onnx') {
      const metadataBlobUrl = fileUrls['package-metadata.json'];
      if (!metadataBlobUrl) {
        manager.revokeBlobUrls(fileUrls);
        throw new Error(`Missing package-metadata.json for ASR model "${modelId}"`);
      }

      try {
        const response = await fetch(metadataBlobUrl);
        dataPackageMetadata = await response.json();
      } catch (err: any) {
        manager.revokeBlobUrls(fileUrls);
        throw new Error(`Failed to read package metadata: ${err.message}`);
      }
      if (this.disposed) { manager.revokeBlobUrls(fileUrls); throw new Error('disposed'); }

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
        case 'qwen3-asr-webgpu':
          return new Worker(
            new URL('../workers/qwen3-asr-webgpu.worker.ts', import.meta.url),
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
      onFatalError: (message) => (this.onFatal ?? this.onError)?.(message),
      onMessage: (msg: AsrWorkerOutMessage | StreamingAsrWorkerOutMessage) => {
        switch (msg.type) {
          case 'status':
            this.onStatus?.(msg.message);
            break;

          case 'speech_start':
            this.onSpeechStart?.();
            break;

          case 'partial':
            this.onPartialResult?.(msg.text, {
              ...(msg.press !== undefined ? { press: msg.press } : {}),
              ...(msg.epoch !== undefined ? { epoch: msg.epoch } : {}),
            });
            break;

          case 'drained':
            this.onDrained?.(msg.seq);
            break;

          case 'result':
            this.onResult?.({
              text: msg.text,
              startSample: 'startSample' in msg ? msg.startSample : undefined,
              durationMs: msg.durationMs,
              recognitionTimeMs: msg.recognitionTimeMs,
              ...('endedBy' in msg && msg.endedBy ? { endedBy: msg.endedBy } : {}),
              ...('smartTurnProbability' in msg && msg.smartTurnProbability !== undefined
                ? { smartTurnProbability: msg.smartTurnProbability }
                : {}),
              ...(msg.press !== undefined ? { press: msg.press } : {}),
              ...(msg.epoch !== undefined ? { epoch: msg.epoch } : {}),
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

    // Send init message — format depends on worker type. No `await` sits
    // between `new WorkerSession(...)` above and any `session.start(...)`
    // call below, on any path.
    let ready: { loadTimeMs: number };
    if (workerType === 'whisper-webgpu' || workerType === 'cohere-transcribe-webgpu' || workerType === 'voxtral-3b-webgpu' || workerType === 'qwen3-asr-webgpu') {
      ready = await session.start({
        type: 'init',
        fileUrls,
        hfModelId: model.hfModelId,
        language,
        dtype,
        ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
        segmentPort,
      }, [segmentPort!]);
    } else if (workerType === 'granite-speech-webgpu') {
      ready = await session.start({
        type: 'init',
        fileUrls,
        hfModelId: model.hfModelId,
        language,
        task: taskConfig?.task ?? 'transcribe',
        targetLanguage: taskConfig?.targetLanguage,
        dtype,
        ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
        segmentPort,
      }, [segmentPort!]);
    } else {
      // sherpa-onnx: dataFileUrls/dataPackageMetadata were loaded above,
      // before the WorkerSession was constructed.
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
   * Raise the recognizer's epoch: the older epoch's queued segments are dropped and its
   * drained marks are never answered. Only a segment recognizer has an epoch; sherpa has none.
   */
  stop(epoch: number): void {
    if (!this.session?.ready) return;
    // Sherpa's worker answers an unknown message type with an error, so it is never sent one.
    if ((this.currentModel?.asrWorkerType ?? 'sherpa-onnx') === 'sherpa-onnx') return;
    this.session.post({ type: 'stop', epoch });
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
    this.disposed = true;
    this.session?.dispose();
    this.session = null;
    this.currentModel = null;
  }
}
