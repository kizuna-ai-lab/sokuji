/**
 * Model Store — Zustand store for reactive model download/status UI state.
 *
 * Tracks download progress, model readiness, and storage usage.
 * Used by ModelManagementSection for rendering and by settingsStore for provider gating.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { ModelManager, type DownloadProgress } from '../lib/local-inference/ModelManager';
import {
  MODEL_MANIFEST,
  getManifestEntry,
  getAsrModelsForLanguage,
  getTranslationModel,
  getTtsModelsForLanguage,
  type ModelStatus,
} from '../lib/local-inference/modelManifest';
import * as modelStorage from '../lib/local-inference/modelStorage';
import { checkWebGPU } from '../utils/webgpu';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DownloadState {
  downloadedBytes: number;
  totalBytes: number;
  currentFile: string;
  percent: number;
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
  /** Whether WebGPU is available on this device */
  webgpuAvailable: boolean;
  /** GPU features supported by this device (e.g. ['shader-f16']) */
  deviceFeatures: string[];
  /** Downloaded variant key per model (modelId → variant key) */
  modelVariants: Record<string, string>;

  /** Initialize: scan IndexedDB for existing models */
  initialize: () => Promise<void>;
  /** Start downloading a model */
  downloadModel: (modelId: string) => Promise<void>;
  /** Cancel an in-progress download */
  cancelDownload: (modelId: string) => void;
  /** Delete a downloaded model */
  deleteModel: (modelId: string) => Promise<void>;
  /** Delete all downloaded models */
  deleteAllModels: () => Promise<void>;
  /**
   * Check if the LOCAL_INFERENCE provider has required models for a language pair.
   * Returns true when: ASR model for sourceLang + translation model for src→tgt
   * + TTS model for targetLang are all downloaded.
   *
   * When a selected model ID is provided (non-empty string), that specific model
   * must be downloaded. Otherwise falls back to the default lookup
   * (any compatible model for ASR/TTS, or getTranslationModel preference for translation).
   */
  isProviderReady: (
    sourceLang: string, targetLang: string,
    selectedAsrModel?: string, selectedTranslationModel?: string, selectedTtsModel?: string,
  ) => boolean;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useModelStore = create<ModelStoreState>()(
  subscribeWithSelector((set, get) => ({
    modelStatuses: {},
    downloads: {},
    downloadErrors: {},
    storageUsedMb: 0,
    initialized: false,
    webgpuAvailable: false,
    deviceFeatures: [],
    modelVariants: {},

    initialize: async () => {
      if (get().initialized) return;

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
        deviceFeatures: capabilities.features,
        modelVariants,
      });
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

    isProviderReady: (sourceLang: string, targetLang: string, selectedAsrModel?: string, selectedTranslationModel?: string, selectedTtsModel?: string): boolean => {
      const { modelStatuses, webgpuAvailable } = get();

      // 1. ASR: if a specific model is selected, it must be downloaded;
      //    otherwise at least 1 ASR model for sourceLang must be downloaded
      if (selectedAsrModel) {
        if (modelStatuses[selectedAsrModel] !== 'downloaded') return false;
        const asrEntry = getManifestEntry(selectedAsrModel);
        if (asrEntry?.requiredDevice === 'webgpu' && !webgpuAvailable) return false;
      } else {
        const asrModels = getAsrModelsForLanguage(sourceLang);
        const hasAsr = asrModels.some(
          model => modelStatuses[model.id] === 'downloaded'
        );
        if (!hasAsr) return false;
      }

      // 2. Translation: if a specific model is selected, check it directly;
      //    otherwise use getTranslationModel preference (pair-specific > multilingual)
      if (selectedTranslationModel) {
        if (modelStatuses[selectedTranslationModel] !== 'downloaded') return false;
        const entry = getManifestEntry(selectedTranslationModel);
        if (entry?.requiredDevice === 'webgpu' && !webgpuAvailable) return false;
      } else {
        const translationEntry = getTranslationModel(sourceLang, targetLang);
        if (!translationEntry) return false;
        if (modelStatuses[translationEntry.id] !== 'downloaded') return false;
        if (translationEntry.requiredDevice === 'webgpu' && !webgpuAvailable) return false;
      }

      // 3. TTS: if a specific model is selected, it must be downloaded;
      //    otherwise at least 1 TTS model for targetLang must be downloaded
      if (selectedTtsModel) {
        if (modelStatuses[selectedTtsModel] !== 'downloaded') return false;
      } else {
        const ttsModels = getTtsModelsForLanguage(targetLang);
        const hasTts = ttsModels.some(
          model => modelStatuses[model.id] === 'downloaded'
        );
        if (!hasTts) return false;
      }

      return true;
    },
  })),
);

// ─── Selector Hooks ──────────────────────────────────────────────────────────

export const useModelStatuses = () => useModelStore(s => s.modelStatuses);
export const useModelDownloads = () => useModelStore(s => s.downloads);
export const useDownloadErrors = () => useModelStore(s => s.downloadErrors);
export const useStorageUsedMb = () => useModelStore(s => s.storageUsedMb);
export const useModelInitialized = () => useModelStore(s => s.initialized);
export const useIsProviderReady = () => useModelStore(s => s.isProviderReady);
export const useWebGPUAvailable = () => useModelStore(s => s.webgpuAvailable);
export const useDeviceFeatures = () => useModelStore(s => s.deviceFeatures);
export const useModelVariants = () => useModelStore(s => s.modelVariants);
