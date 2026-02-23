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
  getAsrModelsForLanguage,
  getTranslationModel,
  getTtsModelsForLanguage,
  type ModelStatus,
} from '../lib/local-inference/modelManifest';
import * as modelStorage from '../lib/local-inference/modelStorage';

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
  /** Total storage used in MB */
  storageUsedMb: number;
  /** Whether the store has been initialized */
  initialized: boolean;

  /** Initialize: scan IndexedDB for existing models */
  initialize: () => Promise<void>;
  /** Start downloading a model */
  downloadModel: (modelId: string) => Promise<void>;
  /** Cancel an in-progress download */
  cancelDownload: (modelId: string) => void;
  /** Delete a downloaded model */
  deleteModel: (modelId: string) => Promise<void>;
  /**
   * Check if the LOCAL_INFERENCE provider has required models for a language pair.
   * Returns true when: ASR model for sourceLang + translation model for src→tgt
   * + TTS model for targetLang are all downloaded.
   */
  isProviderReady: (sourceLang: string, targetLang: string) => boolean;
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useModelStore = create<ModelStoreState>()(
  subscribeWithSelector((set, get) => ({
    modelStatuses: {},
    downloads: {},
    storageUsedMb: 0,
    initialized: false,

    initialize: async () => {
      if (get().initialized) return;

      const manager = ModelManager.getInstance();
      const statuses: Record<string, ModelStatus> = {};

      // Check each model in the manifest
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

      // Estimate storage
      const usedBytes = await modelStorage.estimateStorageUsedBytes();

      set({
        modelStatuses: statuses,
        storageUsedMb: Math.round(usedBytes / (1024 * 1024)),
        initialized: true,
      });
    },

    downloadModel: async (modelId: string) => {
      const manager = ModelManager.getInstance();

      set(state => ({
        modelStatuses: { ...state.modelStatuses, [modelId]: 'downloading' },
        downloads: {
          ...state.downloads,
          [modelId]: { downloadedBytes: 0, totalBytes: 0, currentFile: '', percent: 0 },
        },
      }));

      try {
        await manager.downloadModel(modelId, (progress: DownloadProgress) => {
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

      set(state => ({
        modelStatuses: { ...state.modelStatuses, [modelId]: 'not_downloaded' },
        storageUsedMb: Math.round(usedBytes / (1024 * 1024)),
      }));
    },

    isProviderReady: (sourceLang: string, targetLang: string): boolean => {
      const { modelStatuses } = get();

      // 1. At least 1 ASR model supporting sourceLang is downloaded
      const asrModels = getAsrModelsForLanguage(sourceLang);
      const hasAsr = asrModels.some(
        model => modelStatuses[model.id] === 'downloaded'
      );
      if (!hasAsr) return false;

      // 2. Translation model for src→tgt is downloaded
      const translationEntry = getTranslationModel(sourceLang, targetLang);
      if (!translationEntry) return false;
      if (modelStatuses[translationEntry.id] !== 'downloaded') return false;

      // 3. At least 1 TTS model supporting targetLang is downloaded
      const ttsModels = getTtsModelsForLanguage(targetLang);
      const hasTts = ttsModels.some(
        model => modelStatuses[model.id] === 'downloaded'
      );
      if (!hasTts) return false;

      return true;
    },
  })),
);

// ─── Selector Hooks ──────────────────────────────────────────────────────────

export const useModelStatuses = () => useModelStore(s => s.modelStatuses);
export const useModelDownloads = () => useModelStore(s => s.downloads);
export const useStorageUsedMb = () => useModelStore(s => s.storageUsedMb);
export const useModelInitialized = () => useModelStore(s => s.initialized);
export const useIsProviderReady = () => useModelStore(s => s.isProviderReady);
