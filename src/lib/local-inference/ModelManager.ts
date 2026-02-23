/**
 * ModelManager — Download orchestration, blob URL management, status tracking.
 *
 * Singleton service that coordinates model downloads, caches blob URLs,
 * and provides readiness checks for the engine layer.
 */

import {
  getManifestEntry,
  getModelFileUrl,
  type ModelManifestEntry,
} from './modelManifest';
import * as storage from './modelStorage';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DownloadProgress {
  modelId: string;
  downloadedBytes: number;
  totalBytes: number;
  currentFile: string;
  percent: number;
}

type ProgressCallback = (progress: DownloadProgress) => void;

// ─── Singleton ───────────────────────────────────────────────────────────────

let instance: ModelManager | null = null;

export class ModelManager {
  private activeDownloads = new Map<string, AbortController>();

  static getInstance(): ModelManager {
    if (!instance) {
      instance = new ModelManager();
    }
    return instance;
  }

  // ─── Download ────────────────────────────────────────────────────────────

  /**
   * Download a sherpa-onnx model (ASR or TTS).
   * Fetches each file with streaming progress, stores Blobs in IndexedDB.
   * Skips files that are already stored (resume on retry).
   */
  async downloadModel(
    modelId: string,
    onProgress?: ProgressCallback,
  ): Promise<void> {
    const entry = getManifestEntry(modelId);
    if (!entry) throw new Error(`Unknown model: ${modelId}`);

    if (entry.type === 'translation') {
      return this.downloadTranslationModel(entry, onProgress);
    }

    if (!entry.files || !entry.cdnPath) {
      throw new Error(`Model ${modelId} has no file manifest`);
    }

    // Set up cancellation
    const controller = new AbortController();
    this.activeDownloads.set(modelId, controller);

    // Calculate total bytes
    const totalBytes = entry.files.reduce((sum, f) => sum + f.sizeBytes, 0);
    let downloadedBytes = 0;

    try {
      // Update metadata to downloading
      await storage.setMetadata(modelId, {
        modelId,
        status: 'downloading',
        downloadedAt: null,
        totalSizeBytes: totalBytes,
        version: '1',
      });

      for (const file of entry.files) {
        // Check cancellation
        if (controller.signal.aborted) {
          throw new DOMException('Download cancelled', 'AbortError');
        }

        // Skip already-stored files (resume support)
        if (await storage.hasFile(modelId, file.filename)) {
          downloadedBytes += file.sizeBytes;
          onProgress?.({
            modelId,
            downloadedBytes,
            totalBytes,
            currentFile: file.filename,
            percent: Math.round((downloadedBytes / totalBytes) * 100),
          });
          continue;
        }

        // Fetch with streaming progress
        const url = getModelFileUrl(entry.cdnPath!, file.filename);
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Failed to fetch ${file.filename}: ${response.status}`);
        }

        const blob = await this.streamResponseToBlob(
          response,
          file.sizeBytes,
          controller.signal,
          (fileDownloaded) => {
            onProgress?.({
              modelId,
              downloadedBytes: downloadedBytes + fileDownloaded,
              totalBytes,
              currentFile: file.filename,
              percent: Math.round(((downloadedBytes + fileDownloaded) / totalBytes) * 100),
            });
          },
        );

        await storage.storeFile(modelId, file.filename, blob);
        downloadedBytes += file.sizeBytes;
      }

      // Mark complete
      await storage.setMetadata(modelId, {
        modelId,
        status: 'downloaded',
        downloadedAt: Date.now(),
        totalSizeBytes: totalBytes,
        version: '1',
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Cancelled — leave partial files for resume
        throw err;
      }
      // Mark error
      await storage.setMetadata(modelId, {
        modelId,
        status: 'error',
        downloadedAt: null,
        totalSizeBytes: totalBytes,
        version: '1',
      });
      throw err;
    } finally {
      this.activeDownloads.delete(modelId);
    }
  }

  /**
   * Download a translation model via Transformers.js pipeline pre-download.
   * This triggers the HuggingFace model download into the browser's Cache API.
   */
  private async downloadTranslationModel(
    entry: ModelManifestEntry,
    onProgress?: ProgressCallback,
  ): Promise<void> {
    if (!entry.hfModelId) {
      throw new Error(`Translation model ${entry.id} has no hfModelId`);
    }

    const controller = new AbortController();
    this.activeDownloads.set(entry.id, controller);

    try {
      await storage.setMetadata(entry.id, {
        modelId: entry.id,
        status: 'downloading',
        downloadedAt: null,
        totalSizeBytes: entry.totalSizeMb * 1024 * 1024,
        version: '1',
      });

      // Dynamically import Transformers.js to avoid loading it eagerly
      const { pipeline } = await import('@huggingface/transformers');

      await pipeline('translation', entry.hfModelId, {
        progress_callback: (progress: any) => {
          if (progress.status === 'progress' && progress.total) {
            onProgress?.({
              modelId: entry.id,
              downloadedBytes: progress.loaded || 0,
              totalBytes: progress.total || entry.totalSizeMb * 1024 * 1024,
              currentFile: progress.file || entry.hfModelId!,
              percent: Math.round(((progress.loaded || 0) / (progress.total || 1)) * 100),
            });
          }
        },
      });

      await storage.setMetadata(entry.id, {
        modelId: entry.id,
        status: 'downloaded',
        downloadedAt: Date.now(),
        totalSizeBytes: entry.totalSizeMb * 1024 * 1024,
        version: '1',
      });
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      await storage.setMetadata(entry.id, {
        modelId: entry.id,
        status: 'error',
        downloadedAt: null,
        totalSizeBytes: entry.totalSizeMb * 1024 * 1024,
        version: '1',
      });
      throw err;
    } finally {
      this.activeDownloads.delete(entry.id);
    }
  }

  /** Cancel an in-progress download */
  cancelDownload(modelId: string): void {
    const controller = this.activeDownloads.get(modelId);
    if (controller) {
      controller.abort();
      this.activeDownloads.delete(modelId);
    }
  }

  // ─── Blob URL Management ─────────────────────────────────────────────────

  /**
   * Read model blobs from IndexedDB and create object URLs.
   * Returns a map of filename → blob URL.
   * Caller MUST call revokeBlobUrls() after the worker loads.
   */
  async getModelBlobUrls(modelId: string): Promise<Record<string, string>> {
    const entry = getManifestEntry(modelId);
    if (!entry?.files) return {};

    const urls: Record<string, string> = {};
    for (const file of entry.files) {
      const blob = await storage.getFile(modelId, file.filename);
      if (blob) {
        urls[file.filename] = URL.createObjectURL(blob);
      }
    }
    return urls;
  }

  /** Revoke blob URLs to free memory */
  revokeBlobUrls(urls: Record<string, string>): void {
    for (const url of Object.values(urls)) {
      URL.revokeObjectURL(url);
    }
  }

  // ─── Status Queries ──────────────────────────────────────────────────────

  /** Check if all files for a sherpa-onnx model are present in IndexedDB */
  async isModelReady(modelId: string): Promise<boolean> {
    const entry = getManifestEntry(modelId);
    if (!entry) return false;

    // Translation models are cached by Transformers.js in Cache API
    if (entry.type === 'translation') {
      return this.isTranslationModelCached(entry.hfModelId!);
    }

    if (!entry.files) return false;
    return storage.hasAllFiles(modelId, entry.files.map(f => f.filename));
  }

  /** Delete a model from IndexedDB */
  async deleteModel(modelId: string): Promise<void> {
    const entry = getManifestEntry(modelId);
    if (!entry) return;

    if (entry.type === 'translation' && entry.hfModelId) {
      await this.deleteTranslationModelCache(entry.hfModelId);
    }

    await storage.deleteModel(modelId);
  }

  /**
   * Probe Cache API for a Transformers.js cached translation model.
   * Transformers.js uses a cache named 'transformers-cache'.
   */
  async isTranslationModelCached(hfModelId: string): Promise<boolean> {
    try {
      // Transformers.js stores files under URLs like:
      // https://huggingface.co/{modelId}/resolve/main/{file}
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      // Check if any cached URL contains the model ID
      return keys.some(req => req.url.includes(hfModelId.replace('/', '%2F')) || req.url.includes(hfModelId));
    } catch {
      // Cache API not available or other error
      return false;
    }
  }

  /** Delete a translation model from the Transformers.js cache */
  private async deleteTranslationModelCache(hfModelId: string): Promise<void> {
    try {
      const cache = await caches.open('transformers-cache');
      const keys = await cache.keys();
      for (const req of keys) {
        if (req.url.includes(hfModelId.replace('/', '%2F')) || req.url.includes(hfModelId)) {
          await cache.delete(req);
        }
      }
    } catch {
      // Ignore if Cache API unavailable
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Stream a fetch response into a Blob with byte-level progress.
   */
  private async streamResponseToBlob(
    response: Response,
    _expectedSize: number,
    signal: AbortSignal,
    onFileProgress: (downloaded: number) => void,
  ): Promise<Blob> {
    const reader = response.body?.getReader();
    if (!reader) {
      // Fallback: no streaming support
      const blob = await response.blob();
      onFileProgress(blob.size);
      return blob;
    }

    const chunks: BlobPart[] = [];
    let downloaded = 0;

    while (true) {
      if (signal.aborted) {
        reader.cancel();
        throw new DOMException('Download cancelled', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      downloaded += value.byteLength;
      onFileProgress(downloaded);
    }

    return new Blob(chunks);
  }
}
