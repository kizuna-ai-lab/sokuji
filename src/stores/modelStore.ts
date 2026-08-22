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
import { directionKey, emptyDirection, type DirectionResult, type ResolutionNote, type Selections, type Stage } from '../lib/local-inference/selection/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DownloadState {
  downloadedBytes: number;
  totalBytes: number;
  currentFile: string;
  percent: number;
  /** True while a manual import writes files — imports are not cancelable. */
  isImport?: boolean;
}

/** Result of {@link ModelStoreState.ensureSelectionReady}: corrected model IDs, or null.
 *  Kept as the interim bridge to `LocalInferenceSettings`'s flat `asrModel`/
 *  `translationModel`/`ttsModel` fields — `buildSessionConfig` still reads
 *  those directly rather than the resolver, so a T15 task rewires it to read
 *  `resolve()` output and this bridge goes away. */
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
  /** Every note the last {@link ensureSelectionReady} call produced (speaker +
   *  participant directions), for the UI to render in place of the generic
   *  `localInferenceModelsRequired` string. Plan 2 owns the rendering; this
   *  store only stashes the value so it has somewhere to live in the
   *  meantime. Cleared to `[]` when nothing is amiss. */
  lastResolutionNotes: ResolutionNote[];

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
   * Full LOCAL_INFERENCE session-readiness check. Initializes the store if
   * needed, reads sourceLanguage/targetLanguage/selections off settingsStore
   * itself (no snapshot is passed in — this is the single readiness entry
   * point for settingsStore.validateApiKey's LOCAL_INFERENCE arm, and it owns
   * its own reads), resolves BOTH the speaker (src→tgt) and participant
   * (tgt→src) directions via {@link resolve}, and applies every prune either
   * resolution surfaced — WITHOUT persisting corrections.
   *
   * The session-gate table this implements is deliberately asymmetric:
   *   - missing speaker ASR or translation → blocks (`ready: false`) — a
   *     session that can't hear or translate the speaker is pointless.
   *   - missing speaker TTS → never blocks — a missing voice degrades to
   *     subtitles, and is never even resolved when the session is text-only.
   *   - missing participant ASR/translation/TTS → never blocks — that
   *     channel is simply skipped at connect time.
   *
   * `notes` carries every stage note from both directions (blocking or not)
   * for the UI to render instead of the generic `localInferenceModelsRequired`
   * string. `corrections` is kept only as the interim bridge to the flat
   * `LocalInferenceSettings.asrModel`/`.translationModel`/`.ttsModel` fields
   * that `buildSessionConfig` still reads directly; it reflects the SPEAKER
   * direction only (there is no flat-field equivalent for the participant
   * direction to correct). The caller applies `corrections` to its own
   * settings slice.
   */
  ensureSelectionReady: () => Promise<{ ready: boolean; notes: ResolutionNote[]; corrections: ModelCorrections }>;
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
    lastResolutionNotes: [],

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

    ensureSelectionReady: async () => {
      // Scan IndexedDB for downloaded models before judging readiness.
      if (!get().initialized) {
        await get().initialize();
      }
      // Dynamic import — same settingsStore-import path nativeModelStore.ts
      // uses — rather than a static one, to avoid a circular static import
      // with settingsStore.ts (which already dynamically imports this
      // module). Unavailable settings store degrades to "nothing explicit
      // and no pair", i.e. every stage resolves purely from the manifest
      // against an empty '→' direction — never ready, but never throws.
      let sourceLanguage = '';
      let targetLanguage = '';
      let asrModel = '';
      let translationModel = '';
      let ttsModel = '';
      let selections: Selections = {};
      try {
        const { useSettingsStore } = await import('./settingsStore');
        const localInference = useSettingsStore.getState().localInference;
        ({ sourceLanguage, targetLanguage, asrModel, translationModel, ttsModel, selections } = localInference);
      } catch { /* settings store unavailable — resolve with no explicit selections */ }

      // Resolve BOTH directions against the WASM manifest + current download
      // statuses. There is deliberately no path by which one direction can
      // influence the other (see resolveDirection's doc comment).
      const speaker = get().resolve(sourceLanguage, targetLanguage, selections);
      const participant = get().resolve(targetLanguage, sourceLanguage, selections);

      // Garbage-collect every id either resolution found dead (an id the
      // manifest no longer knows about at all) in one combined write.
      const prunes = [...speaker.prunes, ...participant.prunes];
      if (prunes.length > 0) {
        await get().applyPrunes(prunes);
      }

      // Surface the SPEAKER direction's resolved ids as corrections whenever
      // they differ from the flat fields on settings — same shape the old
      // autoSelectModels produced, now driven by the resolver instead of a
      // bespoke walk. There is no flat-field equivalent for the participant
      // direction, so it is never a source of corrections.
      const corrections: { asrModel?: string; translationModel?: string; ttsModel?: string } = {};
      if (speaker.asr && speaker.asr.modelId !== asrModel) corrections.asrModel = speaker.asr.modelId;
      if (speaker.translation && speaker.translation.modelId !== translationModel) {
        corrections.translationModel = speaker.translation.modelId;
      }
      if (speaker.tts && speaker.tts.modelId !== ttsModel) corrections.ttsModel = speaker.tts.modelId;

      // The session-gate table (deliberately asymmetric — see the doc
      // comment on the interface member): only the speaker's ASR and
      // translation stages can block Start. Speaker TTS and the entire
      // participant direction never do.
      const ready = Boolean(speaker.asr && speaker.translation);
      const notes = [...speaker.notes, ...participant.notes];
      set({ lastResolutionNotes: notes });

      return {
        ready,
        notes,
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
export const useLastResolutionNotes = () => useModelStore(s => s.lastResolutionNotes);
