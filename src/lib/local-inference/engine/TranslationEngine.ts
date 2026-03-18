/**
 * TranslationEngine — Main thread wrapper for the translation Web Worker.
 * Provides a simple async API for translating text via Opus-MT.
 *
 * Model files are loaded from IndexedDB as blob URLs (same pattern as ASR/TTS).
 */

import { getTranslationModel, getManifestEntry, getManifestByType } from '../modelManifest';
import { ModelManager } from '../ModelManager';

export interface TranslationResult {
  sourceText: string;
  translatedText: string;
  inferenceTimeMs: number;
  systemPrompt?: string;
}

type ErrorCallback = (error: string) => void;

export class TranslationEngine {
  private worker: Worker | null = null;
  private isReady = false;
  private currentModelId: string | null = null;
  private sourceLang = '';
  private targetLang = '';
  private pendingRequests = new Map<string, {
    resolve: (result: TranslationResult) => void;
    reject: (error: Error) => void;
  }>();
  private requestCounter = 0;

  onError: ErrorCallback | null = null;

  /**
   * Initialize with a language pair (e.g. 'ja', 'en').
   * Loads model files from IndexedDB and passes blob URLs to the worker.
   * Selects Opus-MT worker (pair-specific WASM) or Qwen worker (multilingual WebGPU)
   * based on the matched manifest entry.
   *
   * @param modelId - Optional specific model ID to use (from user selection).
   *                  When omitted, auto-selects via getTranslationModel() preference.
   */
  async init(sourceLang: string, targetLang: string, modelId?: string): Promise<{ loadTimeMs: number; device: string }> {
    const entry = modelId ? getManifestEntry(modelId) : getTranslationModel(sourceLang, targetLang);
    if (!entry?.hfModelId) {
      const available = getManifestByType('translation').map(m =>
        m.multilingual ? `${m.id} (multilingual)` : `${m.sourceLang}-${m.targetLang}`
      ).join(', ');
      throw new Error(`No translation model available for language pair: ${sourceLang}-${targetLang}. Available: ${available}`);
    }
    const hfModelId = entry.hfModelId;

    // If already loaded with same model and same language pair, skip
    if (this.isReady && this.currentModelId === hfModelId
      && this.sourceLang === sourceLang && this.targetLang === targetLang) {
      return { loadTimeMs: 0, device: entry.requiredDevice || 'wasm' };
    }

    // Dispose previous worker if switching models
    if (this.worker) {
      this.dispose();
    }

    this.sourceLang = sourceLang;
    this.targetLang = targetLang;

    // Load model file blob URLs from IndexedDB
    const manager = ModelManager.getInstance();
    if (!await manager.isModelReady(entry.id)) {
      throw new Error(`Translation model "${entry.id}" is not downloaded. Download it first via Model Management.`);
    }
    const fileUrls = await manager.getModelBlobUrls(entry.id);
    const { dtype } = await manager.getModelVariantInfo(entry.id);

    return new Promise((resolve, reject) => {
      // Create the Web Worker — select based on worker type
      const workerType = entry.translationWorkerType
        || (entry.multilingual ? 'qwen' : 'opus-mt');

      switch (workerType) {
        case 'qwen35':
          this.worker = new Worker(
            new URL('../workers/qwen35-translation.worker.ts', import.meta.url),
            { type: 'module' }
          );
          break;
        case 'qwen':
          this.worker = new Worker(
            new URL('../workers/qwen-translation.worker.ts', import.meta.url),
            { type: 'module' }
          );
          break;
        default: // opus-mt
          this.worker = new Worker(
            new URL('../workers/translation.worker.ts', import.meta.url),
            { type: 'module' }
          );
          break;
      }

      this.worker.onmessage = (event) => {
        const msg = event.data;
        switch (msg.type) {
          case 'ready':
            this.isReady = true;
            this.currentModelId = hfModelId;
            // Revoke blob URLs after worker has loaded (frees memory)
            manager.revokeBlobUrls(fileUrls);
            resolve({ loadTimeMs: msg.loadTimeMs, device: msg.device || 'wasm' });
            break;

          case 'result': {
            const pending = this.pendingRequests.get(msg.id);
            if (pending) {
              this.pendingRequests.delete(msg.id);
              pending.resolve({
                sourceText: msg.sourceText,
                translatedText: msg.translatedText,
                inferenceTimeMs: msg.inferenceTimeMs,
                systemPrompt: msg.systemPrompt,
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
                manager.revokeBlobUrls(fileUrls);
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
          manager.revokeBlobUrls(fileUrls);
          reject(new Error(message));
        }
      };

      // Send init message with blob URLs + language info + dtype from variant
      this.worker.postMessage({ type: 'init', hfModelId, fileUrls, sourceLang, targetLang, dtype, ortWasmBaseUrl: new URL('./wasm/ort/', window.location.href).href });
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
      this.worker!.postMessage({
        type: 'translate', id, text,
        sourceLang: this.sourceLang, targetLang: this.targetLang,
      });
    });
  }

  /**
   * Get available language pairs
   */
  static getAvailableLanguagePairs(): string[] {
    const pairs: string[] = [];
    for (const m of getManifestByType('translation')) {
      if (m.multilingual) {
        pairs.push(`${m.id} (multilingual: ${m.languages.join(',')})`);
      } else {
        pairs.push(`${m.sourceLang}-${m.targetLang}`);
      }
    }
    return pairs;
  }

  /**
   * Check if a language pair is supported
   */
  static isLanguagePairSupported(sourceLang: string, targetLang: string): boolean {
    return !!getTranslationModel(sourceLang, targetLang);
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
    this.sourceLang = '';
    this.targetLang = '';

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('TranslationEngine disposed'));
    }
    this.pendingRequests.clear();
  }
}
