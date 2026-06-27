import { create } from 'zustand';
import { NativeModelClient } from '../lib/local-inference/native/NativeModelClient';
import type { NativeModelState, NativeModelInfo, VariantInfo } from '../lib/local-inference/native/nativeProtocol';
import { autoSelectNative, hardwareGated, type NativeSelection } from '../lib/local-inference/native/nativeCatalog';

export type NativeModelStatus = NativeModelState | 'downloading';

interface NativeModelStore {
  statuses: Record<string, NativeModelStatus>;
  progress: Record<string, { downloaded: number; total: number }>;
  sizes: Record<string, number>;
  errors: Record<string, string>;
  /** Remembered selection per language pair, keyed `${src}→${tgt}` (mirrors modelStore.modelPreferences). */
  modelPreferences: Record<string, NativeSelection>;
  /** Per-machine model catalog from the sidecar (languages, recommended, tier availability). */
  catalog: Record<string, NativeModelInfo>;
  /** Query the sidecar for the per-machine model catalog (best-effort). */
  refreshCatalog: (models?: string[]) => Promise<void>;
  /** Query the sidecar for the cache status of these models (no-op if sidecar down). */
  refresh: (models: string[]) => Promise<void>;
  /** Query the sidecar for download sizes (bytes) of these models (best-effort). */
  refreshSizes: (models: string[]) => Promise<void>;
  /** Download one model, streaming progress into the store. `repo` selects a chosen
   *  variant's repo (the sidecar fetches it instead of the model's default repo). */
  download: (model: string, repo?: string) => Promise<void>;
  /** Ask the sidecar to stop an in-flight download (takes effect at a file boundary). */
  cancelDownload: (model: string) => Promise<void>;
  /** Delete one model from the sidecar cache (flips its status to absent). */
  deleteModel: (model: string) => Promise<void>;
  /** True only if every listed model is cached. */
  isReady: (models: string[]) => boolean;
  /** Persist the chosen models for a language pair/direction. */
  rememberModels: (src: string, tgt: string, sel: NativeSelection) => void;
  /** The remembered selection for a direction (raw; readiness is re-checked by autoSelect). */
  recallModels: (src: string, tgt: string) => NativeSelection | null;
  /**
   * Reconcile a selection for the pair using the catalog reconciler + recalled
   * history + live download statuses, and remember the final choice. Returns the
   * changed fields (null if nothing changed) — the caller applies them to settings.
   */
  autoSelect: (src: string, tgt: string, current: NativeSelection) => Partial<NativeSelection> | null;
  /** True while a native ASR session is loading its model (init→ready). */
  asrLoading: boolean;
  /** The resolved ASR plan from the last session `ready` (device + measured rtf + memory). */
  asrResolved: { model: string; device: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null;
  /** The resolved translation plan from the last session `ready` (model + device + memory). */
  translationResolved: { model: string; device: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null;
  setAsrLoading: (v: boolean) => void;
  setAsrResolved: (r: { model: string; device: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
  setTranslationResolved: (r: { model: string; device: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
}

// Singleton management connection (separate from session-stage clients).
const client = new NativeModelClient();

// Re-run provider validation so the Start button gates with the cache state.
async function revalidateNativeProvider(): Promise<void> {
  try {
    const { useSettingsStore } = await import('./settingsStore');
    if (useSettingsStore.getState().provider === 'local_native') {
      await useSettingsStore.getState().validateApiKey();
    }
  } catch { /* best-effort */ }
}

export const useNativeModelStore = create<NativeModelStore>((set, get) => ({
  statuses: {},
  progress: {},
  sizes: {},
  errors: {},
  catalog: {},
  modelPreferences: {},
  asrLoading: false,
  asrResolved: null,
  translationResolved: null,

  refreshCatalog: async (models) => {
    try {
      // ASR and translation are separate catalogs sidecar-side; fetch both so
      // translation cards get tier badges too. Ids never collide, so they merge
      // into one map. Both share the same per-machine tier-availability data.
      const [asr, translate] = await Promise.all([
        client.modelsCatalog(models, 'asr'),
        client.modelsCatalog(models, 'translate'),
      ]);
      const list = [...asr, ...translate];
      set((s) => ({ catalog: { ...s.catalog, ...Object.fromEntries(list.map((m) => [m.id, m])) } }));
    } catch {
      // best-effort — tier badges are cosmetic; sidecar may be down
    }
  },

  refresh: async (models) => {
    if (!models.length) return;
    try {
      const result = await client.status(models);
      set((s) => ({ statuses: { ...s.statuses, ...result } }));
    } catch {
      // sidecar not available — leave statuses untouched
    }
  },

  refreshSizes: async (models) => {
    if (!models.length) return;
    try {
      const result = await client.sizes(models);
      set((s) => ({ sizes: { ...s.sizes, ...result } }));
    } catch {
      // best-effort — sizes are cosmetic
    }
  },

  download: async (model, repo) => {
    set((s) => ({
      statuses: { ...s.statuses, [model]: 'downloading' },
      progress: { ...s.progress, [model]: { downloaded: 0, total: 0 } },
      errors: { ...s.errors, [model]: '' },
    }));
    try {
      const status = await client.download(model, (p) =>
        set((s) => ({ progress: { ...s.progress, [model]: { downloaded: p.downloaded, total: p.total } } })), repo);
      // 'cancelled' (or a partial fetch) leaves the model incomplete → absent.
      set((s) => ({
        statuses: { ...s.statuses, [model]: status === 'ready' ? 'ready' : 'absent' },
        errors: { ...s.errors, [model]: '' },
      }));
      if (status === 'ready') await revalidateNativeProvider();
    } catch (err) {
      set((s) => ({
        statuses: { ...s.statuses, [model]: 'absent' },
        errors: { ...s.errors, [model]: err instanceof Error ? err.message : String(err) },
      }));
    }
  },

  cancelDownload: async (model) => {
    // Fire the signal; the in-flight download() resolves 'cancelled' and flips the
    // status to absent. (A single-file model already past its only file finishes
    // as 'ready' — cancellation is checked between files, not mid-file.)
    await client.cancel(model);
  },

  deleteModel: async (model) => {
    // Optimistic: hide the model immediately. The sidecar delete is a WS round-trip
    // + an rm of a multi-GB dir, so awaiting it first would freeze the card on
    // "Downloaded" for a noticeable beat (mirrors download()'s optimistic 'downloading').
    set((s) => ({ statuses: { ...s.statuses, [model]: 'absent' } }));
    try {
      await client.delete(model);
    } catch {
      // sidecar refused/unavailable — keep the best-effort 'absent' (the model is
      // hidden either way; readiness re-checks against the real cache on next refresh).
    }
    await revalidateNativeProvider();
  },

  isReady: (models) => models.length > 0 && models.every((m) => get().statuses[m] === 'ready'),

  rememberModels: (src, tgt, sel) => {
    set((s) => ({ modelPreferences: { ...s.modelPreferences, [`${src}→${tgt}`]: sel } }));
  },

  recallModels: (src, tgt) => get().modelPreferences[`${src}→${tgt}`] ?? null,

  autoSelect: (src, tgt, current) => {
    const statuses = get().statuses;
    const catalog = get().catalog;
    const isDownloaded = (id: string | null) => id === null || statuses[id] === 'ready';
    // A GPU-only model on a CPU-only machine is hardware-gated — never auto-select it
    // (it would pass readiness but fail at Start with NoUsablePlan).
    const isHardwareGated = (id: string | null) => id !== null && hardwareGated(catalog[id]);
    const updates = autoSelectNative(src, tgt, current, isDownloaded, get().recallModels(src, tgt), isHardwareGated);
    const final: NativeSelection = {
      asrModel: updates?.asrModel ?? current.asrModel,
      translationModel: updates?.translationModel ?? current.translationModel,
      ttsModel: updates?.ttsModel ?? current.ttsModel,
    };
    // Remember the resolved choice for this direction (mirrors modelStore.autoSelectModels).
    if (final.asrModel) get().rememberModels(src, tgt, final);
    return updates;
  },

  setAsrLoading: (v) => set({ asrLoading: v }),
  setAsrResolved: (r) => set({ asrResolved: r }),
  setTranslationResolved: (r) => set({ translationResolved: r }),
}));

/** Best-effort call to the sidecar's list_variants endpoint.
 *  Exported at this module boundary so the renderer can mock it in tests. */
export async function nativeListVariants(
  model: string, asrId: string | null, ttsId: string | null, pin?: string,
): Promise<{ variants: VariantInfo[]; recommended: string }> {
  return client.listVariants(model, asrId, ttsId, pin);
}

export const useNativeModelStatuses = () => useNativeModelStore((s) => s.statuses);
export const useNativeModelProgress = () => useNativeModelStore((s) => s.progress);
export const useNativeModelSizes = () => useNativeModelStore((s) => s.sizes);
export const useNativeModelErrors = () => useNativeModelStore((s) => s.errors);
export const useNativeCatalog = () => useNativeModelStore((s) => s.catalog);
export const useNativeAsrLoading = () => useNativeModelStore((s) => s.asrLoading);
export const useNativeAsrResolved = () => useNativeModelStore((s) => s.asrResolved);
export const useNativeTranslationResolved = () => useNativeModelStore((s) => s.translationResolved);
