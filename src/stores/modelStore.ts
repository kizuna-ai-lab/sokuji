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
  modelUsable,
  pickBestModel,
  type ModelStatus,
} from '../lib/local-inference/modelManifest';
import * as modelStorage from '../lib/local-inference/modelStorage';
import { filesToImportMap, type NamedBlob } from '../lib/local-inference/modelImport';
import { checkWebGPU } from '../utils/webgpu';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DownloadState {
  downloadedBytes: number;
  totalBytes: number;
  currentFile: string;
  percent: number;
  /** True while a manual import writes files — imports are not cancelable. */
  isImport?: boolean;
}

export interface ParticipantModelStatus {
  asrAvailable: boolean;
  asrModelId: string | null;
  asrFallback: boolean;
  asrOriginalModelId: string;
  translationAvailable: boolean;
  translationModelId: string | null;
}

/**
 * The subset of LOCAL_INFERENCE settings that determine session readiness:
 * the language pair plus the three selected model IDs. Structurally matches
 * `LocalInferenceSettings` so the settings slice can be passed directly.
 */
export interface LocalSelection {
  sourceLanguage: string;
  targetLanguage: string;
  asrModel: string;
  translationModel: string;
  ttsModel: string;
}

/** Result of {@link ModelStoreState.autoSelectModels}: corrected model IDs, or null. */
export type ModelCorrections = { asrModel?: string; translationModel?: string; ttsModel?: string } | null;

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
  ) => ModelCorrections;
  /**
   * Full LOCAL_INFERENCE session-readiness check for a selection. Initializes
   * the store if needed, auto-corrects stale selections, and reports readiness
   * against the corrected selection — WITHOUT persisting. The caller applies the
   * returned `corrections` to its own settings slice. This is the single
   * readiness entry point for settingsStore.validateApiKey's LOCAL_INFERENCE arm.
   */
  ensureSelectionReady: (selection: LocalSelection) => Promise<{ ready: boolean; corrections: ModelCorrections }>;
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
    initError: null,
    webgpuAvailable: false,
    deviceFeatures: [],
    modelVariants: {},
    modelPreferences: {},

    initialize: async () => {
      if (get().initialized) return;
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
        deviceFeatures: capabilities.features,
        modelVariants,
      });
      } catch (err) {
        // Never fail silently: the Models UI renders initError with a Retry
        // button instead of an empty section. Every await above can reject
        // (IndexedDB VersionError from a newer-schema profile, storage
        // estimate failures, corrupt model metadata).
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Sokuji] [ModelStore] initialize failed:', err);
        set({ initError: message });
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

    isProviderReady: (sourceLang: string, targetLang: string, selectedAsrModel?: string, selectedTranslationModel?: string, selectedTtsModel?: string): boolean => {
      const { modelStatuses, webgpuAvailable } = get();
      const ctx = { modelStatuses, webgpuAvailable };

      // 1. ASR: if a specific model is selected, it must be usable (downloaded +
      //    device-ready) and support sourceLang; otherwise at least 1 ASR model
      //    for sourceLang must be usable.
      if (selectedAsrModel) {
        const asrEntry = getManifestEntry(selectedAsrModel);
        if (!modelUsable(asrEntry, ctx)) return false;
        if (asrEntry && !asrEntry.multilingual && !asrEntry.languages.includes(sourceLang)) return false;
      } else {
        const hasAsr = getAsrModelsForLanguage(sourceLang).some(m => modelUsable(m, ctx));
        if (!hasAsr) return false;
      }

      // 2. Translation: AST short-circuit when translation model === ASR model
      if (selectedTranslationModel && selectedTranslationModel === selectedAsrModel) {
        const asrEntry = getManifestEntry(selectedAsrModel);
        if (!asrEntry || !isAstCompatible(asrEntry, sourceLang, targetLang)) return false;
      } else if (selectedTranslationModel) {
        const entry = getManifestEntry(selectedTranslationModel);
        if (!modelUsable(entry, ctx)) return false;
        if (entry && !isTranslationModelCompatible(entry, sourceLang, targetLang)) return false;
      } else {
        const translationEntry = getTranslationModel(sourceLang, targetLang);
        if (!modelUsable(translationEntry, ctx)) return false;
      }

      // 3. TTS: if a specific model is selected, it must be usable and support
      //    targetLang; otherwise at least 1 TTS model for targetLang must be usable.
      if (selectedTtsModel) {
        const ttsEntry = getManifestEntry(selectedTtsModel);
        if (!modelUsable(ttsEntry, ctx)) return false;
        // Language compatibility is orthogonal to cloud/local (a cloud model
        // still can't produce a language it doesn't support). The one current
        // cloud TTS is multilingual, so this is behavior-identical today.
        if (ttsEntry && !ttsEntry.multilingual && !ttsEntry.languages.includes(targetLang)) return false;
      } else {
        const hasTts = getTtsModelsForLanguage(targetLang).some(m => modelUsable(m, ctx));
        if (!hasTts) return false;
      }

      return true;
    },

    getParticipantModelStatus: (sourceLang: string, targetLang: string, currentAsrModelId: string, currentTranslationModelId?: string): ParticipantModelStatus => {
      const { modelStatuses, webgpuAvailable } = get();
      const ctx = { modelStatuses, webgpuAvailable };

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
          && modelUsable(recalledAsr, ctx)) {
          asrModelId = recalled.asrModel;
          asrFallback = recalled.asrModel !== currentAsrModelId;
        }
      }

      // Try current model
      if (!asrModelId) {
        const currentAsr = allAsrModels.find(m => m.id === currentAsrModelId);
        const currentAsrOk = currentAsr
          && (currentAsr.multilingual || currentAsr.languages.includes(participantSourceLang))
          && modelUsable(currentAsr, ctx);

        if (currentAsrOk) {
          asrModelId = currentAsrModelId;
        } else {
          const match = allAsrModels.find(m =>
            (m.multilingual || m.languages.includes(participantSourceLang))
            && modelUsable(m, ctx)
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
        if (!modelId) return false;
        const entry = getManifestEntry(modelId);
        if (!modelUsable(entry, ctx)) return false;
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
          && modelUsable(m, ctx)
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
      const ctx = { modelStatuses, webgpuAvailable };
      const updates: { asrModel?: string; translationModel?: string; ttsModel?: string } = {};

      // Save original input to detect recall overrides later
      const inputAsrModel = currentAsrModel;
      const inputTranslationModel = currentTranslationModel;
      const inputTtsModel = currentTtsModel;

      // Check recalled preferences — override "current" with recalled values if available
      const recalled = get().recallModels(sourceLang, targetLang);
      if (recalled) {
        if (recalled.asrModel && recalled.asrModel !== currentAsrModel) {
          currentAsrModel = recalled.asrModel;
        }
        if (recalled.translationModel && recalled.translationModel !== currentTranslationModel) {
          currentTranslationModel = recalled.translationModel;
        }
        if (recalled.ttsModel && recalled.ttsModel !== currentTtsModel) {
          currentTtsModel = recalled.ttsModel;
        }
      }

      // ASR: must support sourceLanguage and be downloaded
      const allAsrModels = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];
      const currentAsr = currentAsrModel ? allAsrModels.find(m => m.id === currentAsrModel) : null;
      const asrOk = currentAsr
        && (currentAsr.multilingual || currentAsr.languages.includes(sourceLang))
        && modelUsable(currentAsr, ctx);
      if (!asrOk) {
        const match = pickBestModel(allAsrModels.filter(m =>
          (m.multilingual || m.languages.includes(sourceLang)) && modelUsable(m, ctx)
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
        && modelUsable(asrEntryForAst, ctx);

      const currentTrans = !isAstValid && currentTranslationModel ? getManifestByType('translation').find(m => m.id === currentTranslationModel) : null;
      const transOk = isAstValid || (currentTrans
        && isTranslationModelCompatible(currentTrans, sourceLang, targetLang)
        && modelUsable(currentTrans, ctx));
      if (!transOk) {
        const match = pickBestModel(getManifestByType('translation').filter(m =>
          isTranslationModelCompatible(m, sourceLang, targetLang)
          && modelUsable(m, ctx)
        ));
        const newId = match?.id || '';
        if (newId !== currentTranslationModel) updates.translationModel = newId;
      }

      // TTS: must support targetLanguage and be downloaded (cloud models are always ready)
      const currentTts = currentTtsModel ? getManifestByType('tts').find(m => m.id === currentTtsModel) : null;
      const ttsOk = currentTts
        && (currentTts.multilingual || currentTts.languages.includes(targetLang))
        && modelUsable(currentTts, ctx);
      if (!ttsOk) {
        const match = pickBestModel(getManifestByType('tts').filter(m =>
          (m.multilingual || m.languages.includes(targetLang))
          && modelUsable(m, ctx)
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
      const ctx = { modelStatuses, webgpuAvailable };
      const key = `${src}→${tgt}`;
      const pref = modelPreferences[key];
      if (!pref) return null;

      // Check downloaded + device compatibility (cloud models skip the download check)
      const isUsable = (id: string) => Boolean(id) && modelUsable(getManifestEntry(id), ctx);

      return {
        asrModel: isUsable(pref.asrModel) ? pref.asrModel : '',
        translationModel: isUsable(pref.translationModel) ? pref.translationModel : '',
        ttsModel: isUsable(pref.ttsModel) ? pref.ttsModel : '',
      };
    },

    ensureSelectionReady: async (selection) => {
      // Scan IndexedDB for downloaded models before judging readiness.
      if (!get().initialized) {
        await get().initialize();
      }
      // Auto-correct stale selections (e.g. a TTS model for the wrong language
      // after a language change); readiness is judged against the corrected
      // selection so a valid setup isn't rejected for a stale stored ID.
      const corrections = get().autoSelectModels(
        selection.sourceLanguage,
        selection.targetLanguage,
        selection.asrModel,
        selection.translationModel,
        selection.ttsModel,
      );
      const effective = corrections ? { ...selection, ...corrections } : selection;
      const ready = get().isProviderReady(
        effective.sourceLanguage,
        effective.targetLanguage,
        effective.asrModel || undefined,
        effective.translationModel || undefined,
        effective.ttsModel || undefined,
      );
      return { ready, corrections };
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
export const useIsProviderReady = () => useModelStore(s => s.isProviderReady);
export const useWebGPUAvailable = () => useModelStore(s => s.webgpuAvailable);
export const useDeviceFeatures = () => useModelStore(s => s.deviceFeatures);
export const useModelVariants = () => useModelStore(s => s.modelVariants);
