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

export interface TtsResult {
  samples: Float32Array;
  sampleRate: number;
  generationTimeMs: number;
}

export type AudioChunkCallback = (samples: Float32Array, sampleRate: number) => void;

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
  private pendingStream: {
    onChunk: AudioChunkCallback;
    resolve: (result: { generationTimeMs: number }) => void;
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

    const isPiperPlus = model.engine === 'piper-plus';
    const isEdgeTts = model.engine === 'edge-tts';

    // Load model file blob URLs from IndexedDB (only .data + package-metadata.json)
    // Edge TTS skips the download check — it uses the network directly
    let fileUrls: Record<string, string> = {};
    let dataPackageMetadata: Record<string, unknown> | null = null;
    let dataFileUrls: Record<string, string> = {};

    if (!isEdgeTts) {
      const manager = ModelManager.getInstance();
      if (!await manager.isModelReady(modelId)) {
        throw new Error(`TTS model "${modelId}" is not downloaded. Download it first via Model Management.`);
      }
      fileUrls = await manager.getModelBlobUrls(modelId);
      dataFileUrls = fileUrls;

      // Sherpa-onnx path: read Emscripten loadPackage metadata
      if (!isPiperPlus) {
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

    return new Promise((resolve, reject) => {
      // Select worker based on engine type
      const workerUrl = isEdgeTts
        ? './workers/edge-tts.worker.js'
        : isPiperPlus
          ? './workers/piper-plus-tts.worker.js'
          : './workers/sherpa-onnx-tts.worker.js';
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (event: MessageEvent<TtsWorkerOutMessage>) => {
        const msg = event.data;
        switch (msg.type) {
          case 'ready':
            this.isReady = true;
            this.currentModel = model;
            this._numSpeakers = msg.numSpeakers;
            this._sampleRate = msg.sampleRate;
            if (!isEdgeTts) {
              const manager = ModelManager.getInstance();
              manager.revokeBlobUrls(fileUrls);
            }
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
            this.onError?.(msg.error);
            if (!this.isReady) {
              if (!isEdgeTts) {
                const manager = ModelManager.getInstance();
                manager.revokeBlobUrls(fileUrls);
              }
              reject(new Error(msg.error));
            }
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
            break;
        }
      };

      this.worker.onerror = (error) => {
        const message = error.message || 'TTS Worker error';
        this.onError?.(message);
        if (!this.isReady) {
          if (!isEdgeTts) {
            const manager = ModelManager.getInstance();
            manager.revokeBlobUrls(fileUrls);
          }
          reject(new Error(message));
        }
        if (this.pendingGenerate) {
          this.pendingGenerate.reject(new Error(message));
          this.pendingGenerate = null;
        }
        if (this.pendingStream) {
          this.pendingStream.reject(new Error(message));
          this.pendingStream = null;
        }
      };

      // Send engine-specific init message
      if (isEdgeTts) {
        this.worker.postMessage({ type: 'init' });
      } else if (isPiperPlus) {
        this.worker.postMessage({
          type: 'init',
          fileUrls,
          runtimeBaseUrl: new URL(PIPER_PLUS_BUNDLED_RUNTIME_PATH, window.location.href).href,
          ortBaseUrl: new URL(ORT_BUNDLED_PATH, window.location.href).href,
          engine: 'piper-plus',
          ttsConfig: model.ttsConfig || {},
        });
      } else {
        this.worker.postMessage({
          type: 'init',
          modelFile: model.modelFile || '',
          engine: model.engine || '',
          ttsConfig: model.ttsConfig || {},
          runtimeBaseUrl: new URL(TTS_BUNDLED_RUNTIME_PATH, window.location.href).href,
          dataPackageMetadata,
          fileUrls: dataFileUrls,
        });
      }
    });
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
      this.worker!.postMessage({ type: 'generate', text: sanitizedText, sid, speed, lang });
    });
  }

  /**
   * Generate speech audio with streaming output.
   * Each decoded PCM chunk is delivered via onChunk callback immediately.
   * Returns a Promise that resolves when the full audio is done.
   */
  async generateStream(
    text: string,
    sid: number,
    speed: number,
    lang?: string,
    onChunk?: AudioChunkCallback,
    voice?: string,
  ): Promise<{ generationTimeMs: number }> {
    if (!this.worker || !this.isReady) {
      throw new Error('TTS engine not initialized');
    }
    if (this.pendingGenerate || this.pendingStream) {
      throw new Error('A generation request is already in progress');
    }

    const sanitizedText = TtsEngine.stripEmoji(text);
    if (!sanitizedText) {
      return { generationTimeMs: 0 };
    }

    return new Promise((resolve, reject) => {
      this.pendingStream = {
        onChunk: onChunk || (() => {}),
        resolve,
        reject,
      };
      this.worker!.postMessage({ type: 'generate', text: sanitizedText, sid, speed, lang, voice });
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
    if (this.pendingStream) {
      this.pendingStream.reject(new Error('TTS engine disposed'));
      this.pendingStream = null;
    }
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
