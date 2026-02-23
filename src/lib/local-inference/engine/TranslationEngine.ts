/**
 * TranslationEngine — Main thread wrapper for the translation Web Worker.
 * Provides a simple async API for translating text via Opus-MT.
 */

// Opus-MT model ID mapping: language pair → HuggingFace model
const OPUS_MT_MODELS: Record<string, string> = {
  'ja-en': 'Xenova/opus-mt-ja-en',
  'en-ja': 'Xenova/opus-mt-en-ja',
  'zh-en': 'Xenova/opus-mt-zh-en',
  'en-zh': 'Xenova/opus-mt-en-zh',
  'ko-en': 'Xenova/opus-mt-ko-en',
  'en-ko': 'Xenova/opus-mt-en-ko',
  'de-en': 'Xenova/opus-mt-de-en',
  'en-de': 'Xenova/opus-mt-en-de',
  'fr-en': 'Xenova/opus-mt-fr-en',
  'en-fr': 'Xenova/opus-mt-en-fr',
  'es-en': 'Xenova/opus-mt-es-en',
  'en-es': 'Xenova/opus-mt-en-es',
};

export interface TranslationProgress {
  modelId: string;
  file: string;
  loaded: number;
  total: number;
  progress: number; // 0-100
}

export interface TranslationResult {
  sourceText: string;
  translatedText: string;
  inferenceTimeMs: number;
}

type ProgressCallback = (progress: TranslationProgress) => void;
type ErrorCallback = (error: string) => void;

export class TranslationEngine {
  private worker: Worker | null = null;
  private isReady = false;
  private currentModelId: string | null = null;
  private pendingRequests = new Map<string, {
    resolve: (result: TranslationResult) => void;
    reject: (error: Error) => void;
  }>();
  private requestCounter = 0;

  onProgress: ProgressCallback | null = null;
  onError: ErrorCallback | null = null;

  /**
   * Initialize with a language pair (e.g. 'ja', 'en')
   */
  async init(sourceLang: string, targetLang: string): Promise<{ loadTimeMs: number }> {
    const pair = `${sourceLang}-${targetLang}`;
    const modelId = OPUS_MT_MODELS[pair];
    if (!modelId) {
      throw new Error(`No Opus-MT model available for language pair: ${pair}. Available: ${Object.keys(OPUS_MT_MODELS).join(', ')}`);
    }

    // If already loaded with same model, skip
    if (this.isReady && this.currentModelId === modelId) {
      return { loadTimeMs: 0 };
    }

    // Dispose previous worker if switching models
    if (this.worker) {
      this.dispose();
    }

    return new Promise((resolve, reject) => {
      // Create the Web Worker
      this.worker = new Worker(
        new URL('../workers/translation.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event) => {
        const msg = event.data;
        switch (msg.type) {
          case 'ready':
            this.isReady = true;
            this.currentModelId = modelId;
            resolve({ loadTimeMs: msg.loadTimeMs });
            break;

          case 'progress':
            this.onProgress?.({
              modelId: msg.modelId,
              file: msg.file,
              loaded: msg.loaded,
              total: msg.total,
              progress: msg.progress,
            });
            break;

          case 'result': {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
              this.pendingRequests.delete(msg.id);
              pending.resolve({
                sourceText: msg.sourceText,
                translatedText: msg.translatedText,
                inferenceTimeMs: msg.inferenceTimeMs,
              });
            }
            break;
          }

          case 'error': {
            if (msg.id) {
              const pending = this.pendingRequests.get(msg.id);
              if (pending) {
                this.pendingRequests.delete(msg.id);
                pending.reject(new Error(msg.error));
              }
            } else {
              this.onError?.(msg.error);
              if (!this.isReady) {
                reject(new Error(msg.error));
              }
            }
            break;
          }

          case 'disposed':
            break;
        }
      };

      this.worker.onerror = (error) => {
        const message = error.message || 'Worker error';
        this.onError?.(message);
        if (!this.isReady) {
          reject(new Error(message));
        }
      };

      // Send init message
      this.worker.postMessage({ type: 'init', modelId });
    });
  }

  /**
   * Translate text. Returns a Promise with the result.
   */
  async translate(text: string): Promise<TranslationResult> {
    if (!this.worker || !this.isReady) {
      throw new Error('TranslationEngine not initialized. Call init() first.');
    }

    const id = `tr_${++this.requestCounter}`;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker!.postMessage({ type: 'translate', id, text });
    });
  }

  /**
   * Get available language pairs
   */
  static getAvailableLanguagePairs(): string[] {
    return Object.keys(OPUS_MT_MODELS);
  }

  /**
   * Check if a language pair is supported
   */
  static isLanguagePairSupported(sourceLang: string, targetLang: string): boolean {
    return `${sourceLang}-${targetLang}` in OPUS_MT_MODELS;
  }

  get ready(): boolean {
    return this.isReady;
  }

  get modelId(): string | null {
    return this.currentModelId;
  }

  dispose(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    this.isReady = false;
    this.currentModelId = null;

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('TranslationEngine disposed'));
    }
    this.pendingRequests.clear();
  }
}
