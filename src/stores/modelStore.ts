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
  getManifestByType,
  getAsrModelsForLanguage,
  getTranslationModel,
  getTtsModelsForLanguage,
  isTranslationModelCompatible,
  isAstCompatible,
  pickBestModel,
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

export interface ParticipantModelStatus {
  asrAvailable: boolean;
  asrModelId: string | null;
  asrFallback: boolean;
  asrOriginalModelId: string;
  translationAvailable: boolean;
  translationModelId: string | null;
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
  /** In-memory model preferences per language pair (key: "src→tgt") */
  modelPreferences: Record<string, { asrModel: string; translationModel: string; ttsModel: string }>;

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

  /**
   * Check if reverse-direction models are available for participant mode.
   * Participant reverses direction: recognizes targetLang (ASR) and translates target→source.
   * Returns detailed status for each model type (ASR and translation).
   */
  getParticipantModelStatus: (sourceLang: string, targetLang: string, currentAsrModelId: string, currentTranslationModelId?: string) => ParticipantModelStatus;

  /**
   * Auto-correct stale model selections when languages change.
   * Returns partial update object with corrected model IDs, or null if no changes needed.
   * This mirrors the auto-select logic in ModelManagementSection but can run without that component mounted.
   */
  autoSelectModels: (
    sourceLang: string, targetLang: string,
    currentAsrModel: string, currentTranslationModel: string, currentTtsModel: string,
  ) => { asrModel?: string; translationModel?: string; ttsModel?: string } | null;
  /** Save model selection for a language pair */
  rememberModels: (sourceLang: string, targetLang: string, asrModel: string, translationModel: string, ttsModel: string) => void;
  /** Recall saved model selection — per-field degradation if models deleted */
  recallModels: (sourceLang: string, targetLang: string) => { asrModel: string; translationModel: string; ttsModel: string } | null;
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
    modelPreferences: {},

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
        if (asrEntry && !asrEntry.multilingual && !asrEntry.languages.includes(sourceLang)) return false;
      } else {
        const asrModels = getAsrModelsForLanguage(sourceLang);
        const hasAsr = asrModels.some(
          model => modelStatuses[model.id] === 'downloaded'
        );
        if (!hasAsr) return false;
      }

      // 2. Translation: AST short-circuit when translation model === ASR model
      if (selectedTranslationModel && selectedTranslationModel === selectedAsrModel) {
        const asrEntry = getManifestEntry(selectedAsrModel);
        if (!asrEntry || !isAstCompatible(asrEntry, sourceLang, targetLang)) return false;
      } else if (selectedTranslationModel) {
        if (modelStatuses[selectedTranslationModel] !== 'downloaded') return false;
        const entry = getManifestEntry(selectedTranslationModel);
        if (entry?.requiredDevice === 'webgpu' && !webgpuAvailable) return false;
        if (entry && !isTranslationModelCompatible(entry, sourceLang, targetLang)) return false;
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
        const ttsEntry = getManifestEntry(selectedTtsModel);
        if (ttsEntry && !ttsEntry.languages.includes(targetLang)) return false;
      } else {
        const ttsModels = getTtsModelsForLanguage(targetLang);
        const hasTts = ttsModels.some(
          model => modelStatuses[model.id] === 'downloaded'
        );
        if (!hasTts) return false;
      }

      return true;
    },

    getParticipantModelStatus: (sourceLang: string, targetLang: string, currentAsrModelId: string, currentTranslationModelId?: string): ParticipantModelStatus => {
      const { modelStatuses, webgpuAvailable } = get();

      // Participant reverses direction: participant source = user's target
      const participantSourceLang = targetLang;
      const participantTargetLang = sourceLang;

      // Check recalled preferences for the reverse direction
      const recalled = get().recallModels(participantSourceLang, participantTargetLang);

      // 1. ASR: prefer recalled > current model > fallback
      let asrModelId: string | null = null;
      let asrFallback = false;

      const allAsrModels = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];

      // Try recalled ASR first
      if (recalled?.asrModel) {
        const recalledAsr = allAsrModels.find(m => m.id === recalled.asrModel);
        if (recalledAsr
          && (recalledAsr.multilingual || recalledAsr.languages.includes(participantSourceLang))
          && modelStatuses[recalled.asrModel] === 'downloaded'
          && !(recalledAsr.requiredDevice === 'webgpu' && !webgpuAvailable)) {
          asrModelId = recalled.asrModel;
          asrFallback = recalled.asrModel !== currentAsrModelId;
        }
      }

      // Try current model
      if (!asrModelId) {
        const currentAsr = allAsrModels.find(m => m.id === currentAsrModelId);
        const currentAsrOk = currentAsr
          && (currentAsr.multilingual || currentAsr.languages.includes(participantSourceLang))
          && modelStatuses[currentAsrModelId] === 'downloaded'
          && !(currentAsr.requiredDevice === 'webgpu' && !webgpuAvailable);

        if (currentAsrOk) {
          asrModelId = currentAsrModelId;
        } else {
          const match = allAsrModels.find(m =>
            (m.multilingual || m.languages.includes(participantSourceLang))
            && modelStatuses[m.id] === 'downloaded'
            && !(m.requiredDevice === 'webgpu' && !webgpuAvailable)
          );
          if (match) {
            asrModelId = match.id;
            asrFallback = true;
          }
        }
      }

      // 2. Translation: prefer recalled > current model > fallback
      //    AST short-circuit: if translation model === ASR model and isAstCompatible, it's valid
      let translationModelId: string | null = null;

      // Helper: check if a model is valid as translation (standard or AST)
      const isValidTranslation = (modelId: string, forAsrId: string | null) => {
        if (!modelId || modelStatuses[modelId] !== 'downloaded') return false;
        const entry = getManifestEntry(modelId);
        if (!entry) return false;
        if (entry.requiredDevice === 'webgpu' && !webgpuAvailable) return false;
        // AST: translation model === ASR model with AST support
        if (modelId === forAsrId && isAstCompatible(entry, participantSourceLang, participantTargetLang)) return true;
        // Standard translation model
        return isTranslationModelCompatible(entry, participantSourceLang, participantTargetLang);
      };

      // Try recalled translation first
      if (recalled?.translationModel && isValidTranslation(recalled.translationModel, asrModelId)) {
        translationModelId = recalled.translationModel;
      }

      // Try current model
      if (!translationModelId && currentTranslationModelId && isValidTranslation(currentTranslationModelId, asrModelId)) {
        translationModelId = currentTranslationModelId;
      }

      // Fallback
      if (!translationModelId) {
        const match = getManifestByType('translation').find(m =>
          isTranslationModelCompatible(m, participantSourceLang, participantTargetLang)
          && modelStatuses[m.id] === 'downloaded'
          && !(m.requiredDevice === 'webgpu' && !webgpuAvailable)
        );
        if (match) {
          translationModelId = match.id;
        }
      }

      return {
        asrAvailable: asrModelId !== null,
        asrModelId,
        asrFallback,
        asrOriginalModelId: currentAsrModelId,
        translationAvailable: translationModelId !== null,
        translationModelId,
      };
    },

    autoSelectModels: (sourceLang, targetLang, currentAsrModel, currentTranslationModel, currentTtsModel) => {
      const { modelStatuses, webgpuAvailable } = get();
      const updates: { asrModel?: string; translationModel?: string; ttsModel?: string } = {};

      // Save original input to detect recall overrides later
      const inputAsrModel = currentAsrModel;
      const inputTranslationModel = currentTranslationModel;
      const inputTtsModel = currentTtsModel;

      // Check recalled preferences — override "current" with recalled values if available
      const recalled = get().recallModels(sourceLang, targetLang);
      console.log('[autoSelectModels]', `${sourceLang}→${targetLang}`, {
        input: { currentAsrModel, currentTranslationModel, currentTtsModel },
        recalled,
      });
      if (recalled) {
        if (recalled.asrModel && recalled.asrModel !== currentAsrModel) {
          console.log('[autoSelectModels] Overriding ASR with recalled:', recalled.asrModel);
          currentAsrModel = recalled.asrModel;
        }
        if (recalled.translationModel && recalled.translationModel !== currentTranslationModel) {
          console.log('[autoSelectModels] Overriding translation with recalled:', recalled.translationModel);
          currentTranslationModel = recalled.translationModel;
        }
        if (recalled.ttsModel && recalled.ttsModel !== currentTtsModel) {
          console.log('[autoSelectModels] Overriding TTS with recalled:', recalled.ttsModel);
          currentTtsModel = recalled.ttsModel;
        }
      }

      // ASR: must support sourceLanguage and be downloaded
      const allAsrModels = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];
      const currentAsr = currentAsrModel ? allAsrModels.find(m => m.id === currentAsrModel) : null;
      const asrOk = currentAsr
        && (currentAsr.multilingual || currentAsr.languages.includes(sourceLang))
        && modelStatuses[currentAsrModel] === 'downloaded';
      if (!asrOk) {
        const match = pickBestModel(allAsrModels.filter(m =>
          (m.multilingual || m.languages.includes(sourceLang)) && modelStatuses[m.id] === 'downloaded'
        ));
        const newId = match?.id || '';
        if (newId !== currentAsrModel) updates.asrModel = newId;
      }

      // Translation: must be compatible with source→target pair, downloaded, and device-ready
      // AST short-circuit: if translation model === ASR model and it has astLanguages, it's valid
      const asrEntryForAst = currentTranslationModel && currentTranslationModel === currentAsrModel
        ? getManifestEntry(currentTranslationModel) : null;
      const isAstValid = asrEntryForAst
        && isAstCompatible(asrEntryForAst, sourceLang, targetLang)
        && modelStatuses[currentTranslationModel] === 'downloaded';

      const currentTrans = !isAstValid && currentTranslationModel ? getManifestByType('translation').find(m => m.id === currentTranslationModel) : null;
      const transOk = isAstValid || (currentTrans
        && isTranslationModelCompatible(currentTrans, sourceLang, targetLang)
        && modelStatuses[currentTranslationModel] === 'downloaded'
        && !(currentTrans.requiredDevice === 'webgpu' && !webgpuAvailable));
      if (!transOk) {
        const match = pickBestModel(getManifestByType('translation').filter(m =>
          isTranslationModelCompatible(m, sourceLang, targetLang)
          && modelStatuses[m.id] === 'downloaded'
          && !(m.requiredDevice === 'webgpu' && !webgpuAvailable)
        ));
        const newId = match?.id || '';
        if (newId !== currentTranslationModel) updates.translationModel = newId;
      }

      // TTS: must support targetLanguage and be downloaded
      const currentTts = currentTtsModel ? getManifestByType('tts').find(m => m.id === currentTtsModel) : null;
      const ttsOk = currentTts
        && currentTts.languages.includes(targetLang)
        && modelStatuses[currentTtsModel] === 'downloaded';
      if (!ttsOk) {
        const match = pickBestModel(getManifestByType('tts').filter(m =>
          m.languages.includes(targetLang) && modelStatuses[m.id] === 'downloaded'
        ));
        const newId = match?.id || '';
        if (newId !== currentTtsModel) updates.ttsModel = newId;
      }

      // Emit updates for recalled overrides that survived validation
      // (recalled value was used as "current", passed checks, but settings still have the old value)
      if (!updates.asrModel && currentAsrModel !== inputAsrModel) updates.asrModel = currentAsrModel;
      if (!updates.translationModel && currentTranslationModel !== inputTranslationModel) updates.translationModel = currentTranslationModel;
      if (!updates.ttsModel && currentTtsModel !== inputTtsModel) updates.ttsModel = currentTtsModel;

      // Remember the final selection for this language pair
      const finalAsr = updates.asrModel ?? currentAsrModel;
      const finalTranslation = updates.translationModel ?? currentTranslationModel;
      const finalTts = updates.ttsModel ?? currentTtsModel;
      if (finalAsr) {
        get().rememberModels(sourceLang, targetLang, finalAsr, finalTranslation, finalTts);
      }

      return Object.keys(updates).length > 0 ? updates : null;
    },

    rememberModels: (src, tgt, asr, translation, tts) => {
      set(state => ({
        modelPreferences: {
          ...state.modelPreferences,
          [`${src}→${tgt}`]: { asrModel: asr, translationModel: translation, ttsModel: tts },
        },
      }));
    },

    recallModels: (src, tgt) => {
      const { modelPreferences, modelStatuses, webgpuAvailable } = get();
      const key = `${src}→${tgt}`;
      const pref = modelPreferences[key];
      if (!pref) return null;

      // Check downloaded + device compatibility
      const isUsable = (id: string) => {
        if (!id || modelStatuses[id] !== 'downloaded') return false;
        const entry = getManifestEntry(id);
        if (entry?.requiredDevice === 'webgpu' && !webgpuAvailable) return false;
        return true;
      };

      return {
        asrModel: isUsable(pref.asrModel) ? pref.asrModel : '',
        translationModel: isUsable(pref.translationModel) ? pref.translationModel : '',
        ttsModel: isUsable(pref.ttsModel) ? pref.ttsModel : '',
      };
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
