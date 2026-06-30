import { create } from 'zustand';
import { NativeModelClient } from '../lib/local-inference/native/NativeModelClient';
import type { NativeModelState, NativeModelInfo, NativeVoiceInfo, VariantInfo } from '../lib/local-inference/native/nativeProtocol';
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
  /** Sidecar lifecycle. Drives every native UI surface that depends on the catalog. */
  sidecarStatus: 'idle' | 'starting' | 'ready' | 'unavailable';
  /** Warm the sidecar and load the full model catalog (asr+translate+tts) + hardware.
   *  Idempotent: returns immediately when already `ready`. Sets `unavailable` on any
   *  failure (no silent catch) so surfaces can show an error + retry. */
  ensureCatalog: () => Promise<void>;
  /** Re-attempt catalog load after `unavailable` (user-triggered retry). */
  retrySidecar: () => Promise<void>;
  /** Query the sidecar for the per-machine model catalog (best-effort). */
  refreshCatalog: (models?: string[]) => Promise<void>;
  /** Cached per-model repo overrides (variant repos) pushed by the management section,
   *  so every refresh() caller (gate, ProviderSection) is automatically variant-aware. */
  statusRepos: Record<string, string>;
  setStatusRepos: (repos: Record<string, string>) => void;
  /** Query the sidecar for the cache status of these models (no-op if sidecar down). */
  refresh: (models: string[], repos?: Record<string, string>) => Promise<void>;
  /** Download one model, streaming progress into the store. `repo` selects a chosen
   *  variant's repo (the sidecar fetches it instead of the model's default repo). */
  download: (model: string, repo?: string) => Promise<void>;
  /** Ask the sidecar to stop an in-flight download (takes effect at a file boundary). */
  cancelDownload: (model: string) => Promise<void>;
  /** Delete one model from the sidecar cache (flips its status to absent). */
  deleteModel: (model: string, repo?: string) => Promise<void>;
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
  /** True while a native TTS session is loading its model (init→ready). */
  ttsLoading: boolean;
  /** The resolved TTS plan from the last session `ready` (device + measured rtf + memory). */
  ttsResolved: { model: string; device: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null;
  setAsrLoading: (v: boolean) => void;
  setAsrResolved: (r: { model: string; device: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
  setTranslationResolved: (r: { model: string; device: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
  setTtsLoading: (v: boolean) => void;
  setTtsResolved: (r: { model: string; device: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
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
  sidecarStatus: 'idle',
  modelPreferences: {},
  statusRepos: {},
  asrLoading: false,
  asrResolved: null,
  translationResolved: null,
  ttsLoading: false,
  ttsResolved: null,

  refreshCatalog: async (models) => {
    try {
      const [asr, translate, tts] = await Promise.all([
        client.modelsCatalog(models, 'asr'),
        client.modelsCatalog(models, 'translate'),
        client.modelsCatalog(models, 'tts'),
      ]);
      const list = [...asr, ...translate, ...tts];
      // Sizes ride along with the catalog response — merge them into `sizes` so
      // the panel no longer needs a separate model_sizes round-trip.
      const newSizes = Object.fromEntries(
        list.filter((m) => m.sizeBytes).map((m) => [m.id, m.sizeBytes as number]));
      set((s) => ({
        catalog: { ...s.catalog, ...Object.fromEntries(list.map((m) => [m.id, m])) },
        sizes: { ...s.sizes, ...newSizes },
      }));
    } catch {
      // best-effort badge refresh; ensureCatalog owns the authoritative lifecycle
    }
  },

  ensureCatalog: async () => {
    const st = get().sidecarStatus;
    if (st === 'ready' || st === 'starting') return;
    set({ sidecarStatus: 'starting' });
    try {
      // The first modelsCatalog call's connect() performs the native-host:start
      // handshake; tier availability comes from the catalog tiers array for each
      // model. Three catalog kinds populate the model map.
      const [asr, translate, tts] = await Promise.all([
        client.modelsCatalog(undefined, 'asr'),
        client.modelsCatalog(undefined, 'translate'),
        client.modelsCatalog(undefined, 'tts'),
      ]);
      const list = [...asr, ...translate, ...tts];
      // Sizes arrive with the catalog (sizeBytes per model) — populate `sizes`
      // here too so cards show a download size immediately, no model_sizes call.
      const sizes = Object.fromEntries(
        list.filter((m) => m.sizeBytes).map((m) => [m.id, m.sizeBytes as number]));
      set({
        catalog: Object.fromEntries(list.map((m) => [m.id, m])),
        sizes,
        sidecarStatus: 'ready',
      });
    } catch {
      set({ sidecarStatus: 'unavailable' });
    }
  },

  retrySidecar: async () => {
    set({ sidecarStatus: 'idle' });
    await get().ensureCatalog();
  },

  setStatusRepos: (repos) => set({ statusRepos: repos }),

  refresh: async (models, repos) => {
    if (!models.length) return;
    try {
      const result = await client.status(models, repos ?? get().statusRepos);
      set((s) => ({ statuses: { ...s.statuses, ...result } }));
    } catch {
      // sidecar not available — leave statuses untouched
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

  deleteModel: async (model, repo) => {
    // Optimistic: hide the model immediately. The sidecar delete is a WS round-trip
    // + an rm of a multi-GB dir, so awaiting it first would freeze the card on
    // "Downloaded" for a noticeable beat (mirrors download()'s optimistic 'downloading').
    set((s) => ({ statuses: { ...s.statuses, [model]: 'absent' } }));
    try {
      await client.delete(model, repo);
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
    const updates = autoSelectNative(src, tgt, current, isDownloaded, get().recallModels(src, tgt), isHardwareGated, catalog);
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
  setTtsLoading: (v) => set({ ttsLoading: v }),
  setTtsResolved: (r) => set({ ttsResolved: r }),
}));

/** Best-effort call to the sidecar's list_variants endpoint.
 *  Exported at this module boundary so the renderer can mock it in tests. */
export async function nativeListVariants(
  model: string, asrId: string | null, ttsId: string | null, pin?: string,
): Promise<{ variants: VariantInfo[]; recommended: string }> {
  return client.listVariants(model, asrId, ttsId, pin);
}

/** Best-effort built-in TTS voice names for a voice-capable model. Returns []
 *  when the model isn't downloaded or the sidecar is unavailable (the voice
 *  picker then shows a "download the model first" hint instead of crashing).
 *  Exported at this module boundary so the renderer can mock it in tests. */
export async function nativeListTtsVoices(model?: string): Promise<NativeVoiceInfo[]> {
  try {
    return await client.listTtsVoices(model);
  } catch {
    return [];
  }
}

export const useNativeSidecarStatus = () => useNativeModelStore((s) => s.sidecarStatus);
export const useNativeModelStatuses = () => useNativeModelStore((s) => s.statuses);
export const useNativeModelProgress = () => useNativeModelStore((s) => s.progress);
export const useNativeModelSizes = () => useNativeModelStore((s) => s.sizes);
export const useNativeModelErrors = () => useNativeModelStore((s) => s.errors);
export const useNativeCatalog = () => useNativeModelStore((s) => s.catalog);
export const useNativeAsrLoading = () => useNativeModelStore((s) => s.asrLoading);
export const useNativeAsrResolved = () => useNativeModelStore((s) => s.asrResolved);
export const useNativeTranslationResolved = () => useNativeModelStore((s) => s.translationResolved);
export const useNativeTtsLoading = () => useNativeModelStore((s) => s.ttsLoading);
export const useNativeTtsResolved = () => useNativeModelStore((s) => s.ttsResolved);
