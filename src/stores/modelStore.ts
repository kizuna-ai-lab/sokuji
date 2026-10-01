/**
 * Model Store — Zustand store for reactive model download/status UI state.
 *
 * Tracks download progress, model readiness, and storage usage.
 * Used by ModelManagementSection for rendering and by the LocalInference provider's readiness check.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { ModelManager, type DownloadProgress } from '../lib/local-inference/ModelManager';
import {
  MODEL_MANIFEST,
  type ModelStatus,
} from '../lib/local-inference/modelManifest';
import * as modelStorage from '../lib/local-inference/modelStorage';
import { filesToImportMap, type NamedBlob } from '../lib/local-inference/modelImport';
import { checkWebGPU } from '../utils/webgpu';
import { resolveDirection } from '../lib/local-inference/selection/resolveStage';
import { wasmCandidates } from '../lib/local-inference/selection/candidates.wasm';
import { directionKey, type DirectionResult, type Selections } from '../lib/local-inference/selection/types';
import { reportError } from '../lib/diagnostics/report';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DownloadState {
  downloadedBytes: number;
  totalBytes: number;
  currentFile: string;
  percent: number;
  /** True while a manual import writes files — imports are not cancelable. */
  isImport?: boolean;
}

interface ModelStoreState {
  /** Status of each model by ID */
  modelStatuses: Record<string, ModelStatus>;
  /** Active download progress by model ID */
  downloads: Record<string, DownloadState>;
  /** Error messages by model ID (set on download failure) */
  downloadErrors: Record<string, string>;
  /** Total storage used in MB */
  storageUsedMb: number;
  /** Whether the store has been initialized */
  initialized: boolean;
  /** Why initialization failed (null = no failure). Shown by the Models UI
   *  instead of silently rendering nothing; cleared on retry. */
  initError: string | null;
  /** Whether WebGPU is available on this device */
  webgpuAvailable: boolean;
  /** WebGPU works but is backed by a CPU rasteriser, so inference will crawl (#389) */
  webgpuSoftwareOnly: boolean;
  /** GPU features supported by this device (e.g. ['shader-f16']) */
  deviceFeatures: string[];
  /** Downloaded variant key per model (modelId → variant key) */
  modelVariants: Record<string, string>;
  /** Initialize: scan IndexedDB for existing models */
  initialize: () => Promise<void>;
  /** Start downloading a model */
  downloadModel: (modelId: string) => Promise<void>;
  /**
   * Import model files the user obtained out-of-band (bypasses the network path).
   * Marks the model `downloaded` on success; on an incomplete import, records an
   * error listing the still-missing files and rethrows.
   */
  importModel: (modelId: string, files: ArrayLike<NamedBlob>) => Promise<void>;
  /** Cancel an in-progress download */
  cancelDownload: (modelId: string) => void;
  /** Delete a downloaded model */
  deleteModel: (modelId: string) => Promise<void>;
  /** Delete all downloaded models */
  deleteAllModels: () => Promise<void>;
  /**
   * Resolve one direction against the WASM manifest and current download
   * statuses. Pure: `selections` comes in as a parameter rather than being
   * read from settingsStore, so the result is a computed value with no
   * dependency of its own on settings — the caller (which already has
   * settingsStore in scope) decides what "current" selections means. Never
   * written back — that distinction is what lets the system tell a user's
   * choice from a machine's guess.
   */
  resolve: (src: string, tgt: string, selections: Selections) => DirectionResult;
}

// ─── Store ───────────────────────────────────────────────────────────────────

/**
 * The one scan in flight, shared by every caller until it settles (then
 * cleared). Without this, SettingsInitializer and check.ts's
 * `raceInitialize` — both calling `initialize()` at startup, ~150ms apart —
 * could each launch their own independent scan: the later one reads its own,
 * later metadata snapshot and can flip a model a live download has since
 * started back to `not_downloaded` in the UI (review Minor 1).
 */
let modelScan: Promise<void> | null = null;

export const useModelStore = create<ModelStoreState>()(
  subscribeWithSelector((set, get) => ({
    modelStatuses: {},
    downloads: {},
    downloadErrors: {},
    storageUsedMb: 0,
    initialized: false,
    initError: null,
    webgpuAvailable: false,
    webgpuSoftwareOnly: false,
    deviceFeatures: [],
    modelVariants: {},

    initialize: async () => {
      if (get().initialized) return;
      // Share the scan already in flight rather than starting a second one
      // (review Minor 1): `modelScan` is cleared once it settles, so a later,
      // genuinely new call (after a failure, say) still starts its own.
      if (modelScan) return modelScan;
      modelScan = (async () => {
        set({ initError: null });

        try {
        const manager = ModelManager.getInstance();

        // Check WebGPU FIRST so getDeviceFeatures() cache is populated for isModelReady()
        const [usedBytes, capabilities] = await Promise.all([
          modelStorage.estimateStorageUsedBytes(),
          checkWebGPU(),
        ]);

        // Now check each model in the manifest (device features are available)
        const statuses: Record<string, ModelStatus> = {};
        for (const entry of MODEL_MANIFEST) {
          const metadata = await modelStorage.getMetadata(entry.id);
          if (metadata?.status === 'downloaded') {
            // Verify files are actually present
            const ready = await manager.isModelReady(entry.id);
            statuses[entry.id] = ready ? 'downloaded' : 'not_downloaded';
          } else if (metadata?.status === 'downloading') {
            // Was downloading when app closed — reset to not_downloaded
            statuses[entry.id] = 'not_downloaded';
          } else if (metadata?.status === 'error') {
            statuses[entry.id] = 'error';
          } else {
            statuses[entry.id] = 'not_downloaded';
          }
        }

        // Load variant keys from metadata
        const modelVariants: Record<string, string> = {};
        for (const entry of MODEL_MANIFEST) {
          const metadata = await modelStorage.getMetadata(entry.id);
          if (metadata?.variant) {
            modelVariants[entry.id] = metadata.variant;
          }
        }

        set({
          modelStatuses: statuses,
          storageUsedMb: Math.round(usedBytes / (1024 * 1024)),
          initialized: true,
          webgpuAvailable: capabilities.available,
          webgpuSoftwareOnly: capabilities.softwareOnly,
          deviceFeatures: capabilities.features,
          modelVariants,
        });
        } catch (err) {
          // Never fail silently: the Models UI renders initError with a Retry
          // button instead of an empty section. Every await above can reject
          // (IndexedDB VersionError from a newer-schema profile, storage
          // estimate failures, corrupt model metadata).
          const message = err instanceof Error ? err.message : String(err);
          reportError('ModelStore', `Failed to initialize the model library: ${message}`, { cause: err });
          set({ initError: message });
        }
      })();
      try {
        await modelScan;
      } finally {
        modelScan = null;
      }
    },

    downloadModel: async (modelId: string) => {
      const manager = ModelManager.getInstance();

      set(state => {
        const newErrors = { ...state.downloadErrors };
        delete newErrors[modelId];
        return {
          modelStatuses: { ...state.modelStatuses, [modelId]: 'downloading' },
          downloads: {
            ...state.downloads,
            [modelId]: { downloadedBytes: 0, totalBytes: 0, currentFile: '', percent: 0 },
          },
          downloadErrors: newErrors,
        };
      });

      try {
        const variantKey = await manager.downloadModel(modelId, (progress: DownloadProgress) => {
          set(state => ({
            downloads: {
              ...state.downloads,
              [modelId]: {
                downloadedBytes: progress.downloadedBytes,
                totalBytes: progress.totalBytes,
                currentFile: progress.currentFile,
                percent: progress.percent,
              },
            },
          }));
        });

        // Update storage estimate
        const usedBytes = await modelStorage.estimateStorageUsedBytes();

        set(state => {
          const newDownloads = { ...state.downloads };
          delete newDownloads[modelId];
          return {
            modelStatuses: { ...state.modelStatuses, [modelId]: 'downloaded' },
            downloads: newDownloads,
            storageUsedMb: Math.round(usedBytes / (1024 * 1024)),
            modelVariants: { ...state.modelVariants, [modelId]: variantKey },
          };
        });
      } catch (err: any) {
        if (err.name === 'AbortError') {
          // Cancelled: revert to not_downloaded
          set(state => {
            const newDownloads = { ...state.downloads };
            delete newDownloads[modelId];
            return {
              modelStatuses: { ...state.modelStatuses, [modelId]: 'not_downloaded' },
              downloads: newDownloads,
            };
          });
        } else {
          set(state => {
            const newDownloads = { ...state.downloads };
            delete newDownloads[modelId];
            return {
              modelStatuses: { ...state.modelStatuses, [modelId]: 'error' },
              downloads: newDownloads,
              downloadErrors: { ...state.downloadErrors, [modelId]: err.message || String(err) },
            };
          });
        }
        throw err;
      }
    },

    importModel: async (modelId: string, files: ArrayLike<NamedBlob>) => {
      const manager = ModelManager.getInstance();
      const provided = filesToImportMap(files);

      set(state => {
        const newErrors = { ...state.downloadErrors };
        delete newErrors[modelId];
        return {
          modelStatuses: { ...state.modelStatuses, [modelId]: 'downloading' },
          downloads: {
            ...state.downloads,
            [modelId]: { downloadedBytes: 0, totalBytes: 0, currentFile: '', percent: 0, isImport: true },
          },
          downloadErrors: newErrors,
        };
      });

      try {
        const variantKey = await manager.importModelFiles(modelId, provided, (progress) => {
          set(state => ({
            downloads: {
              ...state.downloads,
              [modelId]: {
                downloadedBytes: progress.storedCount,
                totalBytes: progress.totalCount,
                currentFile: progress.currentFile,
                percent: progress.totalCount > 0
                  ? Math.round((progress.storedCount / progress.totalCount) * 100)
                  : 0,
                isImport: true,
              },
            },
          }));
        });

        // The import has fully persisted at this point. Mark it downloaded
        // FIRST, independent of the cosmetic storage estimate below — a failing
        // estimate must not flip a completed import into an error state.
        set(state => {
          const newDownloads = { ...state.downloads };
          delete newDownloads[modelId];
          return {
            modelStatuses: { ...state.modelStatuses, [modelId]: 'downloaded' },
            downloads: newDownloads,
            modelVariants: { ...state.modelVariants, [modelId]: variantKey },
          };
        });

        // Best-effort storage figure; never fail a completed import over it.
        try {
          const usedBytes = await modelStorage.estimateStorageUsedBytes();
          set({ storageUsedMb: Math.round(usedBytes / (1024 * 1024)) });
        } catch { /* estimate is cosmetic */ }
      } catch (err: any) {
        // Includes ModelImportError (incomplete) — its message lists the missing files.
        set(state => {
          const newDownloads = { ...state.downloads };
          delete newDownloads[modelId];
          return {
            modelStatuses: { ...state.modelStatuses, [modelId]: 'error' },
            downloads: newDownloads,
            downloadErrors: { ...state.downloadErrors, [modelId]: err.message || String(err) },
          };
        });
        throw err;
      }
    },

    cancelDownload: (modelId: string) => {
      const manager = ModelManager.getInstance();
      manager.cancelDownload(modelId);
    },

    deleteModel: async (modelId: string) => {
      const manager = ModelManager.getInstance();
      await manager.deleteModel(modelId);

      const usedBytes = await modelStorage.estimateStorageUsedBytes();

      set(state => {
        const newVariants = { ...state.modelVariants };
        delete newVariants[modelId];
        return {
          modelStatuses: { ...state.modelStatuses, [modelId]: 'not_downloaded' },
          storageUsedMb: Math.round(usedBytes / (1024 * 1024)),
          modelVariants: newVariants,
        };
      });
    },

    deleteAllModels: async () => {
      // Clear entire IndexedDB (includes legacy models not in current manifest)
      await modelStorage.clearAll();

      set(state => {
        const newStatuses: Record<string, ModelStatus> = {};
        for (const id of Object.keys(state.modelStatuses)) {
          newStatuses[id] = 'not_downloaded';
        }
        return {
          modelStatuses: newStatuses,
          storageUsedMb: 0,
          modelVariants: {},
        };
      });
    },

    /**
     * Resolve one direction. Pure: takes `selections` as a parameter; the
     * caller (the LocalInference provider, or the engine surface it renders)
     * owns them.
     */
    resolve: (src, tgt, selections) => {
      const { modelStatuses, webgpuAvailable, deviceFeatures } = get();
      return resolveDirection(
        directionKey(src, tgt),
        selections,
        wasmCandidates({ modelStatuses, webgpuAvailable, deviceFeatures }),
      );
    },

  })),
);

// ─── Selector Hooks ──────────────────────────────────────────────────────────

export const useModelStatuses = () => useModelStore(s => s.modelStatuses);
export const useModelDownloads = () => useModelStore(s => s.downloads);
export const useDownloadErrors = () => useModelStore(s => s.downloadErrors);
export const useStorageUsedMb = () => useModelStore(s => s.storageUsedMb);
export const useModelInitialized = () => useModelStore(s => s.initialized);
export const useModelInitError = () => useModelStore(s => s.initError);
export const useWebGPUAvailable = () => useModelStore(s => s.webgpuAvailable);
export const useWebGPUSoftwareOnly = () => useModelStore(s => s.webgpuSoftwareOnly);
export const useDeviceFeatures = () => useModelStore(s => s.deviceFeatures);
export const useModelVariants = () => useModelStore(s => s.modelVariants);
