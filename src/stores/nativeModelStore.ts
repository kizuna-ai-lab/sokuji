import { create } from 'zustand';
import { NativeModelClient } from '../lib/local-inference/native/NativeModelClient';
import type { NativeModelState } from '../lib/local-inference/native/nativeProtocol';
import { autoSelectNative, type NativeSelection } from '../lib/local-inference/native/nativeCatalog';

export type NativeModelStatus = NativeModelState | 'downloading';

interface NativeModelStore {
  statuses: Record<string, NativeModelStatus>;
  progress: Record<string, { downloaded: number; total: number }>;
  sizes: Record<string, number>;
  /** Remembered selection per language pair, keyed `${src}→${tgt}` (mirrors modelStore.modelPreferences). */
  modelPreferences: Record<string, NativeSelection>;
  /** Query the sidecar for the cache status of these models (no-op if sidecar down). */
  refresh: (models: string[]) => Promise<void>;
  /** Query the sidecar for download sizes (bytes) of these models (best-effort). */
  refreshSizes: (models: string[]) => Promise<void>;
  /** Download one model, streaming progress into the store. */
  download: (model: string) => Promise<void>;
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
  modelPreferences: {},

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

  download: async (model) => {
    set((s) => ({
      statuses: { ...s.statuses, [model]: 'downloading' },
      progress: { ...s.progress, [model]: { downloaded: 0, total: 0 } },
    }));
    try {
      const status = await client.download(model, (p) =>
        set((s) => ({ progress: { ...s.progress, [model]: { downloaded: p.downloaded, total: p.total } } })));
      // 'cancelled' (or a partial fetch) leaves the model incomplete → absent.
      set((s) => ({ statuses: { ...s.statuses, [model]: status === 'ready' ? 'ready' : 'absent' } }));
      if (status === 'ready') await revalidateNativeProvider();
    } catch {
      set((s) => ({ statuses: { ...s.statuses, [model]: 'absent' } }));
    }
  },

  cancelDownload: async (model) => {
    // Fire the signal; the in-flight download() resolves 'cancelled' and flips the
    // status to absent. (A single-file model already past its only file finishes
    // as 'ready' — cancellation is checked between files, not mid-file.)
    await client.cancel(model);
  },

  deleteModel: async (model) => {
    try {
      await client.delete(model);
    } catch {
      // sidecar refused/unavailable — fall through and reflect best-effort state
    }
    set((s) => ({ statuses: { ...s.statuses, [model]: 'absent' } }));
    await revalidateNativeProvider();
  },

  isReady: (models) => models.length > 0 && models.every((m) => get().statuses[m] === 'ready'),

  rememberModels: (src, tgt, sel) => {
    set((s) => ({ modelPreferences: { ...s.modelPreferences, [`${src}→${tgt}`]: sel } }));
  },

  recallModels: (src, tgt) => get().modelPreferences[`${src}→${tgt}`] ?? null,

  autoSelect: (src, tgt, current) => {
    const statuses = get().statuses;
    const isDownloaded = (id: string | null) => id === null || statuses[id] === 'ready';
    const updates = autoSelectNative(src, tgt, current, isDownloaded, get().recallModels(src, tgt));
    const final: NativeSelection = {
      asrModel: updates?.asrModel ?? current.asrModel,
      translationModel: updates?.translationModel ?? current.translationModel,
      ttsModel: updates?.ttsModel ?? current.ttsModel,
    };
    // Remember the resolved choice for this direction (mirrors modelStore.autoSelectModels).
    if (final.asrModel) get().rememberModels(src, tgt, final);
    return updates;
  },
}));

export const useNativeModelStatuses = () => useNativeModelStore((s) => s.statuses);
export const useNativeModelProgress = () => useNativeModelStore((s) => s.progress);
export const useNativeModelSizes = () => useNativeModelStore((s) => s.sizes);
