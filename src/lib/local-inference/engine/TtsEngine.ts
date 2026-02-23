/**
 * TtsEngine — Main thread wrapper for the TTS Web Worker.
 * Provides a simple API for generating speech from text.
 *
 * Uses a classic Web Worker (public/workers/tts.worker.js)
 * because sherpa-onnx Emscripten glue requires importScripts().
 */

import type {
  TtsWorkerOutMessage,
  TtsModelConfig,
} from '../types';
import { TTS_MODELS } from '../types';

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
  private currentModel: TtsModelConfig | null = null;
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
    const model = TTS_MODELS.find(m => m.id === modelId);
    if (!model) {
      throw new Error(
        `Unknown TTS model: ${modelId}. Available: ${TTS_MODELS.map(m => m.id).join(', ')}`
      );
    }

    // If already loaded with same model, skip
    if (this.isReady && this.currentModel?.id === modelId) {
      return { loadTimeMs: 0, numSpeakers: this._numSpeakers, sampleRate: this._sampleRate };
    }

    // Dispose previous worker if switching models
    if (this.worker) {
      this.dispose();
    }

    return new Promise((resolve, reject) => {
      const workerUrl = '/workers/tts.worker.js';
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (event: MessageEvent<TtsWorkerOutMessage>) => {
        const msg = event.data;
        switch (msg.type) {
          case 'ready':
            this.isReady = true;
            this.currentModel = model;
            this._numSpeakers = msg.numSpeakers;
            this._sampleRate = msg.sampleRate;
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
          reject(new Error(message));
        }
        if (this.pendingGenerate) {
          this.pendingGenerate.reject(new Error(message));
          this.pendingGenerate = null;
        }
      };

      const wasmBaseUrl = `/wasm/${model.wasmDir}/`;
      this.worker.postMessage({ type: 'init', wasmBaseUrl, modelFile: model.modelFile });
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

    return new Promise((resolve, reject) => {
      this.pendingGenerate = { resolve, reject };
      this.worker!.postMessage({ type: 'generate', text, sid, speed });
    });
  }

  /**
   * Get list of available TTS models.
   */
  static getModels(): TtsModelConfig[] {
    return TTS_MODELS;
  }

  get ready(): boolean {
    return this.isReady;
  }

  get model(): TtsModelConfig | null {
    return this.currentModel;
  }

  get numSpeakers(): number {
    return this._numSpeakers;
  }

  get sampleRate(): number {
    return this._sampleRate;
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
