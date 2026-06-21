import { create } from 'zustand';
import { NativeModelClient } from '../lib/local-inference/native/NativeModelClient';
import type { NativeModelState } from '../lib/local-inference/native/nativeProtocol';

export type NativeModelStatus = NativeModelState | 'downloading';

interface NativeModelStore {
  statuses: Record<string, NativeModelStatus>;
  progress: Record<string, { downloaded: number; total: number }>;
  sizes: Record<string, number>;
  /** Query the sidecar for the cache status of these models (no-op if sidecar down). */
  refresh: (models: string[]) => Promise<void>;
  /** Query the sidecar for download sizes (bytes) of these models (best-effort). */
  refreshSizes: (models: string[]) => Promise<void>;
  /** Download one model, streaming progress into the store. */
  download: (model: string) => Promise<void>;
  /** True only if every listed model is cached. */
  isReady: (models: string[]) => boolean;
}

// Singleton management connection (separate from session-stage clients).
const client = new NativeModelClient();

export const useNativeModelStore = create<NativeModelStore>((set, get) => ({
  statuses: {},
  progress: {},
  sizes: {},

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
      await client.download(model, (p) =>
        set((s) => ({ progress: { ...s.progress, [model]: { downloaded: p.downloaded, total: p.total } } })));
      set((s) => ({ statuses: { ...s.statuses, [model]: 'ready' } }));
      // Re-run provider validation so the Start button flips to enabled once
      // the required models are all present (no manual settings toggle needed).
      try {
        const { useSettingsStore } = await import('./settingsStore');
        if (useSettingsStore.getState().provider === 'local_native') {
          await useSettingsStore.getState().validateApiKey();
        }
      } catch { /* validation re-check is best-effort */ }
    } catch {
      set((s) => ({ statuses: { ...s.statuses, [model]: 'absent' } }));
    }
  },

  isReady: (models) => models.length > 0 && models.every((m) => get().statuses[m] === 'ready'),
}));

export const useNativeModelStatuses = () => useNativeModelStore((s) => s.statuses);
export const useNativeModelProgress = () => useNativeModelStore((s) => s.progress);
export const useNativeModelSizes = () => useNativeModelStore((s) => s.sizes);
