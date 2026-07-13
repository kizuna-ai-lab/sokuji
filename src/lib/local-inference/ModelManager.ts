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
import {
  DownloadTimeoutError,
  fetchWithConnectTimeout,
  readStreamToBlob,
  retryWithBackoff,
} from './downloadRetry';
import { validateModelFile, ModelFileValidationError } from './modelFileValidation';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DownloadProgress {
  modelId: string;
  downloadedBytes: number;
  totalBytes: number;
  currentFile: string;
  percent: number;
}

type ProgressCallback = (progress: DownloadProgress) => void;
/** Timeout/retry tuning for a download. Defaults below; overridable (mainly for tests). */
export interface DownloadTuning {
  /** Abort a file's fetch if response headers don't arrive within this many ms. */
  connectTimeoutMs: number;
  /** Abort a file's stream if no chunk arrives for this many ms. */
  stallTimeoutMs: number;
  /** Total attempts per file (first try + retries). */
  attempts: number;
  /** Backoff before each retry; last value repeats. */
  backoffsMs: number[];
}

const DEFAULT_DOWNLOAD_TUNING: DownloadTuning = {
  connectTimeoutMs: 30_000,
  stallTimeoutMs: 60_000,
  attempts: 3,
  backoffsMs: [2_000, 5_000],
};

/** User-facing message when a download times out after retries (the CDN is unreachable). */
const DOWNLOAD_TIMEOUT_MESSAGE =
  'Network timeout reaching the model download server (it may be blocked on your network). '
  + 'You can retry, or import the model manually.';

const percent = (done: number, total: number): number =>
  total > 0 ? Math.round((done / total) * 100) : 0;

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
    tuning?: Partial<DownloadTuning>,
  ): Promise<string> {
    const cfg: DownloadTuning = { ...DEFAULT_DOWNLOAD_TUNING, ...tuning };
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
            percent: percent(downloadedBytes, totalBytes),
          });
          continue;
        }

        // Fetch + stream + validate, retried per file. Connect and stall
        // timeouts turn a black-holed CDN into a typed error instead of an
        // infinite hang; the retry rides out transient network failures.
        const url = getModelDownloadUrl(entry, file.filename);
        const blob = await retryWithBackoff(
          () => this.fetchFileBlob(url, file, controller.signal, cfg, (fileDownloaded) => {
            onProgress?.({
              modelId,
              downloadedBytes: downloadedBytes + fileDownloaded,
              totalBytes,
              currentFile: file.filename,
              percent: percent(downloadedBytes + fileDownloaded, totalBytes),
            });
          }),
          {
            attempts: cfg.attempts,
            backoffsMs: cfg.backoffsMs,
            // Retry network/timeout failures, but not user cancels or content
            // validation errors (those won't fix themselves on retry).
            shouldRetry: (err) =>
              (err as { name?: string })?.name !== 'AbortError'
              && !(err instanceof ModelFileValidationError),
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
        variant: variantKey,
      });

      return variantKey;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Cancelled — leave partial files for resume, don't mark errored.
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
      // Surface a friendly, actionable message for the unreachable-CDN case.
      if (err instanceof DownloadTimeoutError) {
        throw new Error(DOWNLOAD_TIMEOUT_MESSAGE);
      }
      throw err;
    } finally {
      this.activeDownloads.delete(modelId);
    }
  }

  /**
   * Fetch one file into a validated Blob: connect-timeout guarded fetch,
   * stall-guarded streaming, then content validation. Thrown as a unit so
   * {@link retryWithBackoff} can retry the whole fetch→stream→validate step.
   */
  private async fetchFileBlob(
    url: string,
    file: ModelFileEntry,
    signal: AbortSignal,
    cfg: DownloadTuning,
    onFileProgress: (downloaded: number) => void,
  ): Promise<Blob> {
    const response = await fetchWithConnectTimeout(url, {
      timeoutMs: cfg.connectTimeoutMs,
      signal,
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch ${file.filename}: ${response.status}`);
    }

    const reader = response.body?.getReader();
    let blob: Blob;
    if (!reader) {
      // Fallback: no streaming support
      blob = await response.blob();
      onFileProgress(blob.size);
    } else {
      blob = await readStreamToBlob(reader, {
        stallTimeoutMs: cfg.stallTimeoutMs,
        signal,
        onProgress: onFileProgress,
      });
    }

    // Validate downloaded content before storing (shared with the import path).
    await validateModelFile(file.filename, blob, file.sizeBytes);
    return blob;
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
}
