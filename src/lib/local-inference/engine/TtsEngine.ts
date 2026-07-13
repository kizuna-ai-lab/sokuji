/**
 * TtsEngine — Main thread wrapper for the TTS Web Worker.
 * Provides a simple API for generating speech from text.
 *
 * Selects either sherpa-onnx or piper-plus Web Worker based on engine type.
 */

import type { TtsWorkerOutMessage } from '../types';
import {
  getManifestEntry,
  getManifestByType,
  TTS_BUNDLED_RUNTIME_PATH,
  PIPER_PLUS_BUNDLED_RUNTIME_PATH,
  ORT_BUNDLED_PATH,
  type ModelManifestEntry,
} from '../modelManifest';
import { ModelManager } from '../ModelManager';
import { EdgeTtsConnection } from '../../edge-tts/EdgeTtsConnection';
import { listVoices } from '../voiceStorage';
import { importedSidFromDbKey } from '../sidMapping';
import { WorkerSession } from './WorkerSession';

export interface TtsResult {
  samples: Float32Array;
  sampleRate: number;
  generationTimeMs: number;
}

export type AudioChunkCallback = (samples: Float32Array, sampleRate: number) => void;

type StatusCallback = (message: string) => void;
type ErrorCallback = (error: string) => void;

export class TtsEngine {
  private session: WorkerSession | null = null;
  private currentModel: ModelManifestEntry | null = null;
  private _numSpeakers = 0;
  private _sampleRate = 0;
  private pendingGenerate: {
    resolve: (result: TtsResult) => void;
    reject: (error: Error) => void;
  } | null = null;
  private pendingStream: {
    onChunk: AudioChunkCallback;
    resolve: (result: { generationTimeMs: number }) => void;
    reject: (error: Error) => void;
  } | null = null;

  private edgeTtsConnection: EdgeTtsConnection | null = null;

  onStatus: StatusCallback | null = null;
  onError: ErrorCallback | null = null;

  /**
   * Initialize the TTS engine with a specific model.
   * Downloads WASM and model data, creates OfflineTts.
   *
   * @param modelId - Model identifier (e.g. 'piper-en', 'piper-de')
   * @returns Promise that resolves with load info when ready
   */
  async init(modelId: string): Promise<{
    loadTimeMs: number;
    numSpeakers: number;
    sampleRate: number;
    voices?: Array<{ sid: number; name: string; source: 'preset' | 'imported'; gender?: 'M' | 'F' }>;
    backend?: 'webgpu' | 'wasm';
  }> {
    const model = getManifestEntry(modelId);
    if (!model || model.type !== 'tts') {
      const available = getManifestByType('tts').map(m => m.id).join(', ');
      throw new Error(`Unknown TTS model: ${modelId}. Available: ${available}`);
    }

    // If already loaded with same model, skip
    if (this.session?.ready && this.currentModel?.id === modelId) {
      return { loadTimeMs: 0, numSpeakers: this._numSpeakers, sampleRate: this._sampleRate };
    }

    // Dispose previous worker if switching models
    if (this.session) {
      this.dispose();
    }

    const isPiperPlus = model.engine === 'piper-plus';
    const isEdgeTts = model.engine === 'edge-tts';
    const isSupertonic = model.engine === 'supertonic';

    // Load model file blob URLs from IndexedDB (only .data + package-metadata.json)
    // Edge TTS skips the download check — it uses the network directly
    let fileUrls: Record<string, string> = {};
    let dataPackageMetadata: Record<string, unknown> | null = null;
    let dataFileUrls: Record<string, string> = {};

    if (!isEdgeTts) {
      const manager = ModelManager.getInstance();
      // For supertonic (and future plain-blob engines), skip the isModelReady pre-check
      // and load URLs in a single await so the Worker can be created within one microtask
      // after init() is called. For sherpa-onnx / piper-plus, keep the sequential check
      // to give a clear error before attempting to fetch package metadata.
      if (!isSupertonic) {
        if (!await manager.isModelReady(modelId)) {
          throw new Error(`TTS model "${modelId}" is not downloaded. Download it first via Model Management.`);
        }
      }
      fileUrls = await manager.getModelBlobUrls(modelId);
      if (isSupertonic && Object.keys(fileUrls).length === 0) {
        throw new Error(`TTS model "${modelId}" is not downloaded. Download it first via Model Management.`);
      }
      dataFileUrls = fileUrls;

      // Sherpa-onnx path: read Emscripten loadPackage metadata
      if (!isPiperPlus && !isSupertonic) {
        const metadataBlobUrl = fileUrls['package-metadata.json'];
        if (!metadataBlobUrl) {
          throw new Error(`Missing package-metadata.json for TTS model "${modelId}"`);
        }
        const metadataResponse = await fetch(metadataBlobUrl);
        dataPackageMetadata = await metadataResponse.json();
        // Strip metadata from file URLs sent to worker
        dataFileUrls = {};
        for (const [name, url] of Object.entries(fileUrls)) {
          if (name !== 'package-metadata.json') {
            dataFileUrls[name] = url;
          }
        }
      }
    }

    // For supertonic: load imported voices from IndexedDB before creating the worker.
    // sid = dbKey + 10 (IMPORTED_SID_OFFSET).
    let supertonicImportedEntries: Array<{
      sid: number; name: string; source: 'imported'; gender: undefined; blobUrl: string;
    }> = [];
    if (isSupertonic) {
      const imported = await listVoices('supertonic-3');
      supertonicImportedEntries = imported.map(v => ({
        sid: importedSidFromDbKey(v.id),
        name: v.name,
        source: 'imported' as const,
        gender: undefined,
        blobUrl: URL.createObjectURL(v.jsonData),
      }));
      // Track imported blob URLs alongside fileUrls so revokeBlobUrls cleans them up
      for (const e of supertonicImportedEntries) {
        fileUrls[`__imported_${e.sid}`] = e.blobUrl;
      }
    }

    // Select worker based on engine type. Supertonic uses Vite's bundled
    // module-worker pattern (TypeScript source, ORT compiled into bundle).
    // The other workers are hand-written JS served from public/.
    const makeWorker = (): Worker => {
      if (isSupertonic) {
        return new Worker(
          new URL('../workers/supertonic-tts.worker.ts', import.meta.url),
          { type: 'module' },
        );
      }
      const workerUrl = isEdgeTts
        ? './workers/edge-tts.worker.js'
        : isPiperPlus
          ? './workers/piper-plus-tts.worker.js'
          : './workers/sherpa-onnx-tts.worker.js';
      return new Worker(workerUrl);
    };

    const session = new WorkerSession({
      makeWorker,
      onMessage: (msg: TtsWorkerOutMessage) => this.route(msg),
      // Edge TTS has nothing to revoke — it uses the network directly, not IndexedDB blobs.
      revokeBlobs: isEdgeTts ? undefined : () => ModelManager.getInstance().revokeBlobUrls(fileUrls),
      onFatalError: (message) => {
        this.onError?.(message);
        if (this.pendingGenerate) {
          this.pendingGenerate.reject(new Error(message));
          this.pendingGenerate = null;
        }
        if (this.pendingStream) {
          this.pendingStream.reject(new Error(message));
          this.pendingStream = null;
        }
      },
    });
    this.session = session;

    // Build the engine-specific init message
    let initMessage: Record<string, unknown>;
    if (isEdgeTts) {
      initMessage = { type: 'init' };
    } else if (isPiperPlus) {
      initMessage = {
        type: 'init',
        fileUrls,
        runtimeBaseUrl: new URL(PIPER_PLUS_BUNDLED_RUNTIME_PATH, window.location.href).href,
        ortBaseUrl: new URL(ORT_BUNDLED_PATH, window.location.href).href,
        engine: 'piper-plus',
        ttsConfig: model.ttsConfig || {},
      };
    } else if (isSupertonic) {
      const presets = model.ttsConfig?.presetVoices ?? [];
      const presetEntries = presets.map(p => ({
        sid: p.sid,
        name: p.name,
        source: 'preset' as const,
        gender: p.gender,
        blobUrl: fileUrls[p.file],
      })).filter(v => v.blobUrl);

      // Merge preset + imported voices (imported loaded before the worker was created, sid = dbKey + 10)
      const voiceList = [...presetEntries, ...supertonicImportedEntries];

      initMessage = {
        type: 'init',
        fileUrls: dataFileUrls,
        voiceList,
        // Trailing slash matches whisper-webgpu / voxtral-webgpu workers;
        // ORT uses this as `ort.env.wasm.wasmPaths` to find jsep wasm files.
        ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href,
        ttsConfig: model.ttsConfig || {},
      };
    } else {
      initMessage = {
        type: 'init',
        modelFile: model.modelFile || '',
        engine: model.engine || '',
        ttsConfig: model.ttsConfig || {},
        runtimeBaseUrl: new URL(TTS_BUNDLED_RUNTIME_PATH, window.location.href).href,
        dataPackageMetadata,
        fileUrls: dataFileUrls,
      };
    }

    const ready = await session.start(initMessage);
    this.currentModel = model;
    this._numSpeakers = ready.numSpeakers ?? 0;
    this._sampleRate = ready.sampleRate ?? 0;
    return {
      loadTimeMs: ready.loadTimeMs,
      numSpeakers: ready.numSpeakers,
      sampleRate: ready.sampleRate,
      voices: ready.voices,
      backend: ready.backend,
    };
  }

  /**
   * Route non-handshake worker messages to the appropriate handler.
   * The init handshake ('ready' / pre-ready 'error') is handled by WorkerSession.
   * 'decode-ready' is consumed by the ad-hoc listener registered in
   * generateStream() via WorkerSession#addMessageListener, not here.
   */
  private route(msg: TtsWorkerOutMessage): void {
    switch (msg.type) {
      case 'status':
        this.onStatus?.(msg.message);
        break;

      case 'result':
        if (this.pendingGenerate) {
          this.pendingGenerate.resolve({
            samples: msg.samples,
            sampleRate: msg.sampleRate,
            generationTimeMs: msg.generationTimeMs,
          });
          this.pendingGenerate = null;
        }
        break;

      case 'audio-chunk':
        if (this.pendingStream) {
          this.pendingStream.onChunk(msg.samples, msg.sampleRate);
        }
        break;

      case 'audio-done':
        if (this.pendingStream) {
          this.pendingStream.resolve({ generationTimeMs: msg.generationTimeMs });
          this.pendingStream = null;
        }
        break;

      case 'error':
        // Post-ready error; pre-ready 'error' is handled by WorkerSession (onFatalError).
        this.onError?.(msg.error);
        if (this.pendingGenerate) {
          this.pendingGenerate.reject(new Error(msg.error));
          this.pendingGenerate = null;
        }
        if (this.pendingStream) {
          this.pendingStream.reject(new Error(msg.error));
          this.pendingStream = null;
        }
        break;

      case 'disposed':
      case 'ready':
      case 'decode-ready':
        break;
    }
  }

  /**
   * Generate speech audio from text.
   * Returns a Promise with the synthesized audio.
   *
   * @param text - Text to synthesize
   * @param sid - Speaker ID (0 to numSpeakers-1, default 0)
   * @param speed - Speech rate multiplier (default 1.0)
   * @param lang - Language code for multilingual models (e.g. 'ja', 'en')
   */
  async generate(text: string, sid = 0, speed = 1.0, lang?: string): Promise<TtsResult> {
    if (!this.session?.ready) {
      throw new Error('TTS engine not initialized');
    }

    if (this.pendingGenerate) {
      throw new Error('A generation request is already in progress');
    }

    // Strip emoji before sending to TTS to prevent models from reading out emoji names.
    // Current sherpa-onnx TTS models (Piper, Matcha) don't support emoji and will
    // spell them out as Unicode text, producing garbled speech.
    //
    // TODO: When emoji-aware or emotion-capable TTS models are available (e.g. models
    // that can map 😊 to happy intonation, or 😢 to sad tone), this stripping should
    // be made conditional based on model capabilities. Consider:
    //   1. Adding an `supportsEmoji` or `emotionAware` flag to ModelManifestEntry
    //   2. Converting emoji to SSML emotion tags or prosody hints instead of stripping
    //   3. Keeping emoji in text for models that can handle them natively
    const sanitizedText = TtsEngine.stripEmoji(text);
    if (!sanitizedText) {
      // Text was entirely emoji — return silence
      return { samples: new Float32Array(0), sampleRate: this._sampleRate, generationTimeMs: 0 };
    }

    return new Promise((resolve, reject) => {
      this.pendingGenerate = { resolve, reject };
      this.session!.post({ type: 'generate', text: sanitizedText, sid, speed, lang });
    });
  }

  /**
   * Generate speech audio with streaming output (Edge TTS).
   *
   * Uses EdgeTtsConnection for platform-specific WebSocket connection,
   * pipes MP3 chunks to the worker for decoding, and delivers PCM via onChunk.
   */
  async generateStream(
    text: string,
    sid: number,
    speed: number,
    lang?: string,
    onChunk?: AudioChunkCallback,
    voice?: string,
  ): Promise<{ generationTimeMs: number }> {
    if (!this.session?.ready) {
      throw new Error('TTS engine not initialized');
    }
    if (this.pendingGenerate || this.pendingStream) {
      throw new Error('A generation request is already in progress');
    }

    const sanitizedText = TtsEngine.stripEmoji(text);
    if (!sanitizedText) {
      return { generationTimeMs: 0 };
    }

    const startTime = performance.now();

    // Wait for worker decoder to be ready (reset is async).
    // The handler rejects on 'error' to avoid hanging the pipeline if reset fails,
    // and is always removed once it settles.
    const session = this.session;
    await new Promise<void>((resolve, reject) => {
      const handler = (event: MessageEvent<TtsWorkerOutMessage>) => {
        const data = event.data;
        if (data.type === 'decode-ready') {
          remove();
          resolve();
        } else if (data.type === 'error') {
          remove();
          reject(new Error(data.error));
        }
      };
      const remove = session.addMessageListener(handler);
      session.post({ type: 'decode-start' });
    });

    // Set up worker to receive decoded PCM chunks
    return new Promise<{ generationTimeMs: number }>((resolve, reject) => {
      this.pendingStream = {
        onChunk: onChunk || (() => {}),
        resolve,
        reject,
      };

      // Create connection and start streaming
      if (!this.edgeTtsConnection) {
        this.edgeTtsConnection = new EdgeTtsConnection();
      }

      this.edgeTtsConnection.generate(
        { text: sanitizedText, voice, speed },
        // onMp3Chunk — forward to worker for decoding.
        //
        // The worker wraps the transferred ArrayBuffer with `new Uint8Array(buf)`,
        // which covers the WHOLE buffer. If mp3Data is a view whose underlying
        // buffer is larger than the view (possible with IPC buffer pools), the
        // worker would decode extra garbage bytes and produce corrupted audio.
        // Guard against this by copying to a tight buffer whenever the sizes
        // disagree.
        (mp3Data: Uint8Array) => {
          if (!this.session) return;
          const tight = (mp3Data.byteOffset === 0 && mp3Data.byteLength === mp3Data.buffer.byteLength)
            ? mp3Data
            : new Uint8Array(mp3Data); // copies only mp3Data's bytes into a new exact-sized buffer
          this.session.post(
            { type: 'decode-chunk', mp3Data: tight.buffer },
            [tight.buffer],
          );
        },
        // onDone — tell worker decoding is complete
        () => {
          const generationTimeMs = Math.round(performance.now() - startTime);
          if (this.session) {
            this.session.post({ type: 'decode-end', generationTimeMs });
          }
        },
        // onError
        (error: string) => {
          if (this.pendingStream) {
            this.pendingStream.reject(new Error(error));
            this.pendingStream = null;
          }
        },
      ).catch((err) => {
        // Connection-level error (not already handled by onError callback)
        if (this.pendingStream) {
          this.pendingStream.reject(err instanceof Error ? err : new Error(String(err)));
          this.pendingStream = null;
        }
      });
    });
  }

  /**
   * Get list of available TTS models.
   */
  static getModels(): ModelManifestEntry[] {
    return getManifestByType('tts');
  }

  get ready(): boolean {
    return this.session?.ready ?? false;
  }

  get model(): ModelManifestEntry | null {
    return this.currentModel;
  }

  get numSpeakers(): number {
    return this._numSpeakers;
  }

  get sampleRate(): number {
    return this._sampleRate;
  }

  /**
   * Remove emoji characters from text to prevent TTS models from reading them out.
   * Collapses resulting extra whitespace.
   */
  private static stripEmoji(text: string): string {
    return text
      .replace(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Dispose the current Supertonic worker and re-init with a fresh voice list
   * (presets + imported voices from IndexedDB). No-op for non-Supertonic engines
   * or when no model is active.
   *
   * Use this after the user imports, renames, or deletes a voice — the worker
   * needs to rebuild its voice tensor map. The new worker reads the latest
   * voiceStorage state during init.
   */
  async reloadVoices(): Promise<void> {
    if (!this.currentModel || this.currentModel.engine !== 'supertonic') {
      return;
    }
    const modelId = this.currentModel.id;
    this.dispose();
    await this.init(modelId);
  }

  dispose(): void {
    if (this.edgeTtsConnection) {
      this.edgeTtsConnection.dispose();
      this.edgeTtsConnection = null;
    }
    if (this.pendingStream) {
      this.pendingStream.reject(new Error('TTS engine disposed'));
      this.pendingStream = null;
    }
    if (this.pendingGenerate) {
      this.pendingGenerate.reject(new Error('TTS engine disposed'));
      this.pendingGenerate = null;
    }
    this.session?.dispose();
    this.session = null;
    this.currentModel = null;
    this._numSpeakers = 0;
    this._sampleRate = 0;
  }
}
