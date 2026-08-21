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
  type ModelStatus,
} from '../lib/local-inference/modelManifest';
import * as modelStorage from '../lib/local-inference/modelStorage';
import { filesToImportMap, type NamedBlob } from '../lib/local-inference/modelImport';
import { checkWebGPU } from '../utils/webgpu';
import { resolveDirection } from '../lib/local-inference/selection/resolveStage';
import { wasmCandidates } from '../lib/local-inference/selection/candidates.wasm';
import { directionKey, emptyDirection, type DirectionResult, type Selections, type Stage } from '../lib/local-inference/selection/types';

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

/** Result of {@link ModelStoreState.ensureSelectionReady}: corrected model IDs, or null. */
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
  /** WebGPU works but is backed by a CPU rasteriser, so inference will crawl (#389) */
  webgpuSoftwareOnly: boolean;
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
   * Resolve one direction against the WASM manifest and current download
   * statuses. Pure: `selections` comes in as a parameter rather than being
   * read from settingsStore, so the result is a computed value with no
   * dependency of its own on settings — the caller (which already has
   * settingsStore in scope) decides what "current" selections means. Never
   * written back — that distinction is what lets the system tell a user's
   * choice from a machine's guess.
   */
  resolve: (src: string, tgt: string, selections: Selections) => DirectionResult;
  /**
   * The one write the resolver can cause: an id the manifest no longer knows
   * can never resolve again, so keeping it only produces a note the user
   * cannot act on. Garbage collection, not write-back. Async: reaches
   * settingsStore via a dynamic import (mirrors nativeModelStore.ts's
   * settingsStore-import path) rather than a static one, to avoid a circular
   * static import with settingsStore.ts (which already dynamically imports
   * this module).
   */
  applyPrunes: (prunes: Array<{ direction: string; stage: Stage }>) => Promise<void>;
  /**
   * Full LOCAL_INFERENCE session-readiness check for a selection. Initializes
   * the store if needed, resolves the direction via {@link resolve}, applies
   * any prunes the resolution surfaced, and reports readiness against the
   * resolved stages — WITHOUT persisting. The caller applies the returned
   * `corrections` to its own settings slice. This is the single readiness
   * entry point for settingsStore.validateApiKey's LOCAL_INFERENCE arm.
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
    webgpuSoftwareOnly: false,
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

    /**
     * Resolve one direction. Pure: takes `selections` as a parameter instead
     * of reading settingsStore itself — settingsStore already dynamically
     * imports this module (validateApiKey's LOCAL_INFERENCE arm), so a static
     * import back would create a circular type dependency. Callers that have
     * settingsStore in scope pass `useSettingsStore.getState().localInference
     * .selections` straight through.
     */
    resolve: (src, tgt, selections) => {
      const { modelStatuses, webgpuAvailable, deviceFeatures } = get();
      return resolveDirection(
        directionKey(src, tgt),
        selections,
        wasmCandidates({ modelStatuses, webgpuAvailable, deviceFeatures }),
      );
    },

    /**
     * The one write the resolver can cause: an id the manifest no longer knows
     * can never resolve again, so keeping it only produces a note the user
     * cannot act on. Garbage collection, not write-back.
     *
     * Reaches settingsStore via a dynamic import rather than a static one —
     * same settingsStore-import path nativeModelStore.ts already uses
     * (catalogStatusRepos / revalidateNativeProvider) — so a settings-store
     * failure at this point degrades to "nothing pruned" rather than throwing.
     */
    applyPrunes: async (prunes) => {
      if (prunes.length === 0) return;
      try {
        const { useSettingsStore } = await import('./settingsStore');
        const store = useSettingsStore.getState();
        const next = { ...store.localInference.selections };
        for (const { direction, stage } of prunes) {
          const dir = next[direction] ?? emptyDirection();
          next[direction] = { ...dir, [stage]: { modelId: '' } };
        }
        // A direction with nothing explicit left carries no information.
        for (const key of Object.keys(next)) {
          const d = next[key];
          if (!d.asr.modelId && !d.translation.modelId && !d.tts.modelId) delete next[key];
        }
        await store.updateLocalInference({ selections: next });
      } catch { /* settings store unavailable — nothing to prune */ }
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
      // Dynamic import — same settingsStore-import path nativeModelStore.ts
      // uses — rather than a static one, to avoid a circular static import
      // with settingsStore.ts (which already dynamically imports this
      // module). Unavailable settings store degrades to "nothing explicit",
      // i.e. every stage resolves purely from the manifest.
      let selections: Selections = {};
      try {
        const { useSettingsStore } = await import('./settingsStore');
        selections = useSettingsStore.getState().localInference.selections;
      } catch { /* settings store unavailable — resolve with no explicit selections */ }

      // Resolve the speaker direction against the WASM manifest + current
      // download statuses, then garbage-collect any selection the resolver
      // found dead (an id the manifest no longer knows about at all).
      const result = get().resolve(selection.sourceLanguage, selection.targetLanguage, selections);
      if (result.prunes.length > 0) {
        await get().applyPrunes(result.prunes);
      }

      // Surface the resolved ids as corrections whenever they differ from the
      // flat fields the caller passed in — same shape the old autoSelectModels
      // produced, now driven by the resolver instead of a bespoke walk.
      const corrections: { asrModel?: string; translationModel?: string; ttsModel?: string } = {};
      if (result.asr && result.asr.modelId !== selection.asrModel) corrections.asrModel = result.asr.modelId;
      if (result.translation && result.translation.modelId !== selection.translationModel) {
        corrections.translationModel = result.translation.modelId;
      }
      if (result.tts && result.tts.modelId !== selection.ttsModel) corrections.ttsModel = result.tts.modelId;

      // Readiness is ASR + translation both resolving to something usable.
      // TTS is optional (text-only sessions never load a voice); Task 14 owns
      // the final {ready, notes} contract this will grow into.
      const ready = result.asr !== null && result.translation !== null;

      return {
        ready,
        corrections: Object.keys(corrections).length > 0 ? corrections : null,
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
export const useModelInitError = () => useModelStore(s => s.initError);
export const useIsProviderReady = () => useModelStore(s => s.isProviderReady);
export const useWebGPUAvailable = () => useModelStore(s => s.webgpuAvailable);
export const useWebGPUSoftwareOnly = () => useModelStore(s => s.webgpuSoftwareOnly);
export const useDeviceFeatures = () => useModelStore(s => s.deviceFeatures);
export const useModelVariants = () => useModelStore(s => s.modelVariants);
