/**
 * ModelManager — Download orchestration, blob URL management, status tracking.
 *
 * Singleton service that coordinates model downloads, caches blob URLs,
 * and provides readiness checks for the engine layer.
 */

import {
  getManifestEntry,
  getModelDownloadUrl,
  selectVariant,
  getBaselineVariant,
  type ModelFileEntry,
} from './modelManifest';
import * as storage from './modelStorage';
import { getDeviceFeatures } from '../../utils/webgpu';

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
   * Download a model (ASR, TTS, or translation).
   * Selects the optimal variant for the current device, fetches each file
   * with streaming progress, stores Blobs in IndexedDB.
   * Skips files that are already stored (resume on retry).
   *
   * Returns the variant key that was downloaded.
   */
  async downloadModel(
    modelId: string,
    onProgress?: ProgressCallback,
  ): Promise<string> {
    const entry = getManifestEntry(modelId);
    if (!entry) throw new Error(`Unknown model: ${modelId}`);

    // Select optimal variant for this device
    const variantKey = selectVariant(entry, getDeviceFeatures());
    const variant = entry.variants[variantKey];

    if (!variant.files.length || (!entry.cdnPath && !entry.hfModelId)) {
      throw new Error(`Model ${modelId} variant ${variantKey} has no download path`);
    }

    // Set up cancellation
    const controller = new AbortController();
    this.activeDownloads.set(modelId, controller);

    // Calculate total bytes
    const totalBytes = variant.files.reduce((sum, f) => sum + f.sizeBytes, 0);
    let downloadedBytes = 0;

    try {
      // Update metadata to downloading
      await storage.setMetadata(modelId, {
        modelId,
        status: 'downloading',
        downloadedAt: null,
        totalSizeBytes: totalBytes,
        version: '1',
        variant: variantKey,
      });

      for (const file of variant.files) {
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
        const url = getModelDownloadUrl(entry, file.filename);
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

        // Validate downloaded content before storing
        const ext = file.filename.split('.').pop()?.toLowerCase();
        const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());

        // 1. HTML check — any file type could get a 404/error HTML page from CDN
        if (header[0] === 0x3C) { // '<' = HTML
          throw new Error(
            `Invalid file ${file.filename}: received HTML instead of expected content (likely 404 or CDN error)`
          );
        }

        // 2. Size check for files with known sizes (sizeBytes > 0 in manifest)
        if (file.sizeBytes > 0
            && Math.abs(blob.size - file.sizeBytes) / file.sizeBytes > 0.2) {
          throw new Error(
            `Size mismatch for ${file.filename}: expected ~${file.sizeBytes} bytes, got ${blob.size} bytes`
          );
        }

        // 3. WASM magic number check
        if (ext === 'wasm'
            && !(header[0] === 0x00 && header[1] === 0x61 && header[2] === 0x73 && header[3] === 0x6D)) {
          throw new Error(
            `Invalid WASM file ${file.filename}: missing WASM magic number`
          );
        }

        // 4. JSON structure check — must be parseable JSON
        if (ext === 'json') {
          try {
            const text = await blob.text();
            JSON.parse(text);
          } catch {
            throw new Error(
              `Invalid JSON file ${file.filename}: content is not valid JSON`
            );
          }
        }

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
        variant: variantKey,
      });

      return variantKey;
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
        variant: variantKey,
      });
      throw err;
    } finally {
      this.activeDownloads.delete(modelId);
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
    if (!entry) return {};
    const metadata = await storage.getMetadata(modelId);
    const variantKey = metadata?.variant ?? getBaselineVariant(entry);
    const variant = entry.variants[variantKey];
    if (!variant) return {};

    const urls: Record<string, string> = {};
    for (const file of variant.files) {
      const blob = await storage.getFile(modelId, file.filename);
      if (blob) {
        // Re-wrap with correct MIME type so WebAssembly.instantiateStreaming
        // works for .wasm files (requires Content-Type: application/wasm)
        const typed = blob.type
          ? blob
          : new Blob([blob], { type: ModelManager.getMimeType(file.filename) });
        urls[file.filename] = URL.createObjectURL(typed);
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

  // ─── Variant Info ──────────────────────────────────────────────────────────

  /**
   * Get the variant info for a downloaded model.
   * Used by engines to pass the correct dtype to workers.
   */
  async getModelVariantInfo(modelId: string): Promise<{
    variantKey: string;
    dtype: string | Record<string, string>;
    files: ModelFileEntry[];
  }> {
    const entry = getManifestEntry(modelId);
    if (!entry) throw new Error(`Unknown model: ${modelId}`);
    const metadata = await storage.getMetadata(modelId);
    const variantKey = metadata?.variant ?? getBaselineVariant(entry);
    const variant = entry.variants[variantKey];
    if (!variant) throw new Error(`Unknown variant "${variantKey}" for model ${modelId}`);
    return { variantKey, dtype: variant.dtype, files: variant.files };
  }

  // ─── Status Queries ──────────────────────────────────────────────────────

  /** Check if a model is ready (downloaded, compatible variant, all files present) */
  async isModelReady(modelId: string): Promise<boolean> {
    const entry = getManifestEntry(modelId);
    if (!entry) return false;
    const metadata = await storage.getMetadata(modelId);
    if (!metadata || metadata.status !== 'downloaded') return false;

    const variantKey = metadata.variant ?? getBaselineVariant(entry);
    const variant = entry.variants[variantKey];
    if (!variant) return false;

    // Incompatibility check: variant requires features this device doesn't have
    const deviceFeatures = getDeviceFeatures();
    if (variant.requiredFeatures?.some(f => !deviceFeatures.includes(f))) return false;

    return storage.hasAllFiles(modelId, variant.files.map(f => f.filename));
  }

  /** Delete a model from IndexedDB */
  async deleteModel(modelId: string): Promise<void> {
    await storage.deleteModel(modelId);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private static getMimeType(filename: string): string {
    if (filename.endsWith('.wasm')) return 'application/wasm';
    if (filename.endsWith('.json')) return 'application/json';
    return 'application/octet-stream';
  }

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
