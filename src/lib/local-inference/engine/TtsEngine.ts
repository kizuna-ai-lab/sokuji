/**
 * TtsEngine — Main thread wrapper for the TTS Web Worker.
 * Provides a simple API for generating speech from text.
 *
 * Uses a classic Web Worker (public/workers/tts.worker.js)
 * because sherpa-onnx Emscripten glue requires importScripts().
 */

import type { TtsWorkerOutMessage } from '../types';
import {
  getManifestEntry,
  getManifestByType,
  TTS_BUNDLED_RUNTIME_PATH,
  type ModelManifestEntry,
} from '../modelManifest';
import { ModelManager } from '../ModelManager';

export interface TtsResult {
  samples: Float32Array;
  sampleRate: number;
  generationTimeMs: number;
}

type StatusCallback = (message: string) => void;
type ErrorCallback = (error: string) => void;

export class TtsEngine {
  private worker: Worker | null = null;
  private isReady = false;
  private currentModel: ModelManifestEntry | null = null;
  private _numSpeakers = 0;
  private _sampleRate = 0;
  private pendingGenerate: {
    resolve: (result: TtsResult) => void;
    reject: (error: Error) => void;
  } | null = null;

  onStatus: StatusCallback | null = null;
  onError: ErrorCallback | null = null;

  /**
   * Initialize the TTS engine with a specific model.
   * Downloads WASM and model data, creates OfflineTts.
   *
   * @param modelId - Model identifier (e.g. 'piper-en', 'piper-de')
   * @returns Promise that resolves with load info when ready
   */
  async init(modelId: string): Promise<{ loadTimeMs: number; numSpeakers: number; sampleRate: number }> {
    const model = getManifestEntry(modelId);
    if (!model || model.type !== 'tts') {
      const available = getManifestByType('tts').map(m => m.id).join(', ');
      throw new Error(`Unknown TTS model: ${modelId}. Available: ${available}`);
    }

    // If already loaded with same model, skip
    if (this.isReady && this.currentModel?.id === modelId) {
      return { loadTimeMs: 0, numSpeakers: this._numSpeakers, sampleRate: this._sampleRate };
    }

    // Dispose previous worker if switching models
    if (this.worker) {
      this.dispose();
    }

    // Load model file blob URLs from IndexedDB (only .data + package-metadata.json)
    const manager = ModelManager.getInstance();
    if (!await manager.isModelReady(modelId)) {
      throw new Error(`TTS model "${modelId}" is not downloaded. Download it first via Model Management.`);
    }
    const fileUrls = await manager.getModelBlobUrls(modelId);

    // Read the Emscripten loadPackage metadata from the downloaded JSON
    const metadataBlobUrl = fileUrls['package-metadata.json'];
    if (!metadataBlobUrl) {
      throw new Error(`Missing package-metadata.json for TTS model "${modelId}"`);
    }
    const metadataResponse = await fetch(metadataBlobUrl);
    const dataPackageMetadata = await metadataResponse.json();

    // Only pass the .data blob URL to the worker (metadata is sent as JSON)
    const dataFileUrls: Record<string, string> = {};
    for (const [name, url] of Object.entries(fileUrls)) {
      if (name !== 'package-metadata.json') {
        dataFileUrls[name] = url;
      }
    }

    return new Promise((resolve, reject) => {
      const workerUrl = './workers/tts.worker.js';
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (event: MessageEvent<TtsWorkerOutMessage>) => {
        const msg = event.data;
        switch (msg.type) {
          case 'ready':
            this.isReady = true;
            this.currentModel = model;
            this._numSpeakers = msg.numSpeakers;
            this._sampleRate = msg.sampleRate;
            manager.revokeBlobUrls(fileUrls);
            resolve({
              loadTimeMs: msg.loadTimeMs,
              numSpeakers: msg.numSpeakers,
              sampleRate: msg.sampleRate,
            });
            break;

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

          case 'error':
            this.onError?.(msg.error);
            if (!this.isReady) {
              manager.revokeBlobUrls(fileUrls);
              reject(new Error(msg.error));
            }
            if (this.pendingGenerate) {
              this.pendingGenerate.reject(new Error(msg.error));
              this.pendingGenerate = null;
            }
            break;

          case 'disposed':
            break;
        }
      };

      this.worker.onerror = (error) => {
        const message = error.message || 'TTS Worker error';
        this.onError?.(message);
        if (!this.isReady) {
          manager.revokeBlobUrls(fileUrls);
          reject(new Error(message));
        }
        if (this.pendingGenerate) {
          this.pendingGenerate.reject(new Error(message));
          this.pendingGenerate = null;
        }
      };

      // JS/WASM runtime is bundled at TTS_BUNDLED_RUNTIME_PATH.
      // Only .data blob URL + metadata JSON are model-specific.
      this.worker.postMessage({
        type: 'init',
        modelFile: model.modelFile || '',
        engine: model.engine || '',
        ttsConfig: model.ttsConfig || {},
        runtimeBaseUrl: new URL(TTS_BUNDLED_RUNTIME_PATH, window.location.href).href,
        dataPackageMetadata,
        fileUrls: dataFileUrls,
      });
    });
  }

  /**
   * Generate speech audio from text.
   * Returns a Promise with the synthesized audio.
   *
   * @param text - Text to synthesize
   * @param sid - Speaker ID (0 to numSpeakers-1, default 0)
   * @param speed - Speech rate multiplier (default 1.0)
   */
  async generate(text: string, sid = 0, speed = 1.0): Promise<TtsResult> {
    if (!this.worker || !this.isReady) {
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
      this.worker!.postMessage({ type: 'generate', text: sanitizedText, sid, speed });
    });
  }

  /**
   * Get list of available TTS models.
   */
  static getModels(): ModelManifestEntry[] {
    return getManifestByType('tts');
  }

  get ready(): boolean {
    return this.isReady;
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

  dispose(): void {
    if (this.pendingGenerate) {
      this.pendingGenerate.reject(new Error('TTS engine disposed'));
      this.pendingGenerate = null;
    }
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
    this.currentModel = null;
    this._numSpeakers = 0;
    this._sampleRate = 0;
  }
}
