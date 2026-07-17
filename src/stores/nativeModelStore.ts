import { create } from 'zustand';
import { NativeModelClient } from '../lib/local-inference/native/NativeModelClient';
import type { NativeModelState, NativeModelInfo, NativeVoiceInfo, VariantInfo, HardwareInfoResultMsg } from '../lib/local-inference/native/nativeProtocol';
import {
  autoSelectNative, hardwareGated, statusReposFor,
  nativeAsrCards, nativeTranslationCards, nativeTtsCards,
  requiredNativeModels, resolveNativeTts, supportsLanguage,
  type NativeSelection, type NativeReadinessInput, type NativeReadinessResult, type NativeReadinessReason,
} from '../lib/local-inference/native/nativeCatalog';
import { isElectron } from '../utils/environment';

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
  /** Detected bundle SKU for this machine (linux-nvidia | win-nvidia | win-directml | mac). */
  bundleSku: string | null;
  /** Self-contained sidecar bundle lifecycle (distribution spec S2/S7/S10). */
  bundleStatus: 'unknown' | 'unsupported' | 'absent' | 'mismatch' | 'paused' | 'installing' | 'ready' | 'error';
  /** Install pipeline phase while `bundleStatus === 'installing'`. */
  bundlePhase: 'download' | 'verify' | 'extract' | null;
  /** Installed bundle version (from its bundle.json marker), if any. */
  bundleVersion: string | null;
  /** Engine version this app build requires (package.json sidecarVersion). */
  bundleRequiredVersion: string | null;
  /** Bytes already staged from an interrupted download (drives 'paused'). */
  bundleStagedBytes: number;
  /** Detected GPU marketing name (nvidia-smi), for the engine card. */
  bundleGpuName: string | null;
  /** True when a dev venv python exists — dev checkout, quiet card note. */
  bundleDevVenv: boolean;
  /** Download / unpacked sizes from the manifest peek (null while unknown). */
  bundleSize: number | null;
  bundleInstalledSize: number | null;
  /** Live download progress while `bundleStatus === 'installing'`. */
  bundleProgress: { downloaded: number; total: number };
  /** Last bundle install error (empty when none). */
  bundleError: string;
  /** Query the main process for SKU + install/mismatch/staged state. */
  refreshBundle: () => Promise<void>;
  /** Download + unpack the machine's bundle via IPC, streaming phased progress. */
  installBundle: () => Promise<void>;
  /** Abort the in-flight download; staging is kept so install resumes later. */
  cancelBundle: () => Promise<void>;
  /** Delete the installed engine (frees disk) and re-read status. */
  removeBundle: () => Promise<void>;
  /** Best-effort manifest peek for exact sizes on the absent/mismatch card. */
  fetchBundleEntry: () => Promise<void>;
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
  /** Full LOCAL_NATIVE session-readiness gate: warm the sidecar, check the
   *  lifecycle, refresh the pair's statuses (variant-aware), auto-select stale
   *  choices, and judge compat + downloaded state. Returns ready + a reason and
   *  the auto-select corrections (the caller persists them). Mirrors the WASM
   *  useModelStore.ensureSelectionReady in shape (peers, not a shared layer).
   *  `read` is a thunk, called only once the sidecar is warm — see
   *  NativeReadinessInput for why a snapshot would be wrong. */
  ensureSelectionReady: (read: () => NativeReadinessInput) => Promise<NativeReadinessResult>;
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
  asrResolved: { model: string; device: string; backend?: string; computeType?: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null;
  /** The resolved translation plan from the last session `ready` (model + device + memory). */
  translationResolved: { model: string; device: string; backend?: string; computeType?: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null;
  /** True while a native TTS session is loading its model (init→ready). */
  ttsLoading: boolean;
  /** The resolved TTS plan from the last session `ready` (device + measured rtf + memory). */
  ttsResolved: { model: string; device: string; backend?: string; computeType?: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null;
  setAsrLoading: (v: boolean) => void;
  setAsrResolved: (r: { model: string; device: string; backend?: string; computeType?: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
  setTranslationResolved: (r: { model: string; device: string; backend?: string; computeType?: string; tokensPerSec?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
  setTtsLoading: (v: boolean) => void;
  setTtsResolved: (r: { model: string; device: string; backend?: string; computeType?: string; rtf?: number; memoryBytes?: number; fallbackReason?: string } | null) => void;
}

// Singleton management connection (separate from session-stage clients).
const client = new NativeModelClient();

// Re-run provider validation so the Start button gates with the cache state.
/**
 * Catalog-derived statusRepos defaults: each multi-variant card's CHOSEN
 * (pinned ?? recommended) quant repo. Populated the moment the catalog lands,
 * so every bare refresh() caller — ProviderSection's chips before the Settings
 * panel ever mounts, and any future one — is variant-aware from cold start.
 * Before this, the Settings panel was the only cache writer: a card whose
 * downloaded quant is the recommended one (Fun-ASR: default Q6_K, downloaded
 * Q8_0) read 'absent' from the default-repo check and the ASR chip showed
 * "None" until a variant-aware caller happened to run.
 */
/** A card's CHOSEN (pinned ?? recommended) variant repo, for each multi-variant
 * card in `cards`. Single-variant cards are skipped (their status uses the
 * default-repo cache). Pure: no store/settings reads — pins are injected.
 * Exported for direct unit testing (avoids routing through the store's async
 * settingsStore-import path in tests).
 *
 * A persisted pin can outlive its variant's support on this machine (e.g.
 * pinned bf16, then the box loses CUDA) — the variant picker already shows it
 * disabled, but a stale pin here would still drive the readiness gate to
 * validate a repo the sidecar's runnable-filter never loads. An unsupported
 * pin is therefore ignored here (falls back to the recommended variant),
 * mirroring what the picker itself already enforces visually. */
export function deriveVariantRepos(cards: NativeModelInfo[], pins: Record<string, string>): Record<string, string> {
  const vd: Record<string, { variants: { id: string; repo: string }[]; recommended: string }> = {};
  const effectivePins: Record<string, string> = { ...pins };
  for (const m of cards) {
    const vs = m.variants;
    if (!vs || vs.length < 2) continue;
    vd[m.id] = {
      variants: vs.map((v) => ({ id: v.id, repo: v.repo ?? '' })),
      recommended: vs.find((v) => v.recommended)?.id ?? vs[0].id,
    };
    const pinned = pins[m.id];
    if (pinned !== undefined && vs.find((v) => v.id === pinned)?.supported === false) {
      delete effectivePins[m.id];
    }
  }
  return statusReposFor(Object.keys(vd), vd, effectivePins);
}

async function catalogStatusRepos(list: NativeModelInfo[]): Promise<Record<string, string>> {
  let pins: Record<string, string> = {};
  try {
    const { useSettingsStore } = await import('./settingsStore');
    pins = useSettingsStore.getState().localNative.translationVariantByModel ?? {};
  } catch { /* settings store unavailable — fall back to recommendations */ }
  return deriveVariantRepos(list, pins);
}

async function revalidateNativeProvider(): Promise<void> {
  try {
    const { useSettingsStore } = await import('./settingsStore');
    if (useSettingsStore.getState().provider === 'local_native') {
      await useSettingsStore.getState().validateApiKey();
    }
  } catch { /* best-effort */ }
}

// Direct main-process IPC for the self-contained bundle flow. The bundle is
// downloaded by the main process (the sidecar it provides is not yet running),
// so this bypasses the WS NativeModelClient and talks to window.electron.
function bundleInvoke(channel: string, data?: unknown): Promise<any> {
  // isElectron() does not check window.electron specifically (that's the preload's
  // custom invoke bridge, distinct from the electronAPI/require/userAgent/process
  // signals it does check) — gate on isElectron() per the project's centralized
  // detection convention, then defensively re-check window.electron itself.
  const e = isElectron() ? (window as unknown as { electron?: { invoke(c: string, d?: unknown): Promise<any> } }).electron : undefined;
  if (!e) throw new Error('window.electron unavailable (not running in Electron)');
  return e.invoke(channel, data);
}

function onBundleProgress(cb: (p: { downloaded: number; total: number }) => void): (() => void) | null {
  const e = isElectron() ? (window as unknown as {
    electron?: {
      receive?: (c: string, f: (p: any) => void) => void;
      removeListener?: (c: string, f: (p: any) => void) => void;
    };
  }).electron : undefined;
  if (!e?.receive) return null;
  const handler = (p: any) => cb(p);
  e.receive('sidecar-bundle-progress', handler);
  return () => e.removeListener?.('sidecar-bundle-progress', handler);
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
  bundleSku: null,
  bundleStatus: 'unknown',
  bundlePhase: null,
  bundleVersion: null,
  bundleRequiredVersion: null,
  bundleStagedBytes: 0,
  bundleGpuName: null,
  bundleDevVenv: false,
  bundleSize: null,
  bundleInstalledSize: null,
  bundleProgress: { downloaded: 0, total: 0 },
  bundleError: '',

  refreshBundle: async () => {
    if (get().bundleStatus === 'installing') return; // never clobber a live install
    try {
      const r = await bundleInvoke('sidecar-bundle:status');
      if (!r?.ok) return;
      const base = r.sku === null ? 'unsupported' : (r.state as 'absent' | 'mismatch' | 'ready');
      // Staged bytes from an interrupted download surface as 'paused' (spec S7)
      // so the card offers Resume instead of a from-scratch Download.
      const status = (base === 'absent' || base === 'mismatch') && r.stagedBytes > 0 ? 'paused' : base;
      set({
        bundleSku: r.sku ?? null,
        bundleStatus: status,
        bundleVersion: r.installedVersion ?? null,
        bundleRequiredVersion: r.requiredVersion ?? null,
        bundleStagedBytes: r.stagedBytes ?? 0,
        bundleGpuName: r.gpuName ?? null,
        bundleDevVenv: !!r.devVenvPresent,
        bundleError: '',
        bundleProgress: { downloaded: 0, total: 0 },
        bundlePhase: null,
      });
    } catch {
      // best-effort; a dev checkout with no bundle simply stays 'unknown'
    }
  },

  installBundle: async () => {
    // Reentrancy guard: a double-click must not race two IPC installs.
    if (get().bundleStatus === 'installing') return;
    set({
      bundleStatus: 'installing', bundlePhase: 'download',
      bundleProgress: { downloaded: get().bundleStagedBytes, total: 0 }, bundleError: '',
    });
    const off = onBundleProgress((p) =>
      set({
        bundleProgress: { downloaded: p.downloaded ?? 0, total: p.total ?? 0 },
        bundlePhase: p.phase ?? 'download',
      }));
    try {
      const r = await bundleInvoke('sidecar-bundle:install');
      off?.();
      if (r?.ok) {
        set({
          bundleStatus: 'ready', bundleSku: r.sku ?? null, bundleVersion: r.version ?? null,
          bundlePhase: null, bundleStagedBytes: 0,
        });
        // Unlock the provider gate + warm the freshly installed sidecar.
        void revalidateNativeProvider();
      } else if (r?.cancelled) {
        set({
          bundleStatus: 'paused', bundlePhase: null,
          bundleStagedBytes: get().bundleProgress.downloaded,
        });
      } else {
        set({ bundleStatus: 'error', bundlePhase: null, bundleError: r?.error || 'bundle install failed' });
      }
    } catch (err) {
      off?.();
      set({
        bundleStatus: 'error', bundlePhase: null,
        bundleError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  cancelBundle: async () => {
    try { await bundleInvoke('sidecar-bundle:cancel'); } catch { /* main unreachable */ }
  },

  removeBundle: async () => {
    try {
      const r = await bundleInvoke('sidecar-bundle:remove');
      if (r?.ok) {
        // The remove handler stops the sidecar process and deletes the install
        // tree. A stale 'ready' would let ensureCatalog early-return and keep
        // the Start gate open against a nonexistent engine, so force the
        // lifecycle back to a state the next validation re-derives from.
        set({ sidecarStatus: 'idle', catalog: {}, statuses: {} });
        await get().refreshBundle();
        void revalidateNativeProvider();
      }
    } catch { /* best-effort */ }
  },

  fetchBundleEntry: async () => {
    try {
      const r = await bundleInvoke('sidecar-bundle:manifest');
      if (r?.ok) set({ bundleSize: r.size ?? null, bundleInstalledSize: r.installedSize ?? null });
    } catch { /* offline — the card shows a placeholder size */ }
  },

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
      const derivedRepos = await catalogStatusRepos(list);
      set((s) => ({
        catalog: { ...s.catalog, ...Object.fromEntries(list.map((m) => [m.id, m])) },
        sizes: { ...s.sizes, ...newSizes },
        statusRepos: { ...s.statusRepos, ...derivedRepos },
      }));
    } catch {
      // best-effort badge refresh; ensureCatalog owns the authoritative lifecycle
    }
  },

  ensureCatalog: async () => {
    const st = get().sidecarStatus;
    if (st === 'ready' || st === 'starting') return;
    // Flip to 'starting' synchronously (UI shows it immediately and re-entry is
    // blocked), THEN check the bundle. Strict matching (spec S2): never boot a
    // stale bundle — 'mismatch' surfaces as unavailable + the card's update CTA.
    set({ sidecarStatus: 'starting' });
    await get().refreshBundle();
    if (get().bundleStatus === 'mismatch') {
      set({ sidecarStatus: 'unavailable' });
      return;
    }
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
      const derivedRepos = await catalogStatusRepos(list);
      set((s) => ({
        catalog: Object.fromEntries(list.map((m) => [m.id, m])),
        sizes,
        sidecarStatus: 'ready',
        statusRepos: { ...s.statusRepos, ...derivedRepos },
      }));
    } catch {
      set({ sidecarStatus: 'unavailable' });
    }
  },

  retrySidecar: async () => {
    set({ sidecarStatus: 'idle' });
    await get().ensureCatalog();
    // validateApiKey owns settingsStore's validationMessage / isApiKeyValid
    // (the Start-button gate and the provider banner); nothing else re-runs it
    // after a manual retry, so a successful boot would leave a stale
    // "unavailable" message and a locked Start button without this.
    await revalidateNativeProvider();
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

  ensureSelectionReady: async (read) => {
    if (!isElectron()) return { ready: false, reason: 'not-electron', corrections: null };
    await get().ensureCatalog();
    const status = get().sidecarStatus;
    if (status !== 'ready') {
      const bundle = get().bundleStatus;
      const reason: NativeReadinessReason =
        bundle === 'mismatch' ? 'engine-mismatch'
        : (bundle === 'absent' || bundle === 'paused') ? 'engine-absent'
        : status === 'unavailable' ? 'unavailable'
        : 'starting';
      return { ready: false, reason, corrections: null };
    }
    // Settings are read HERE, not at the call site: the warmup above can take
    // seconds on a cold start, during which the user may change the pair or
    // toggle text-only. The pre-facade gate read them at this same point.
    const { selection, textOnly } = read();
    const catalog = get().catalog;
    const pins = selection.translationVariantByModel ?? {};
    const asCards = (ids: string[]): NativeModelInfo[] =>
      ids.map((id) => catalog[id]).filter((c): c is NativeModelInfo => !!c);
    // FIRST refresh: this pair's candidate statuses, variant-aware — so a cold
    // start doesn't read the default repo and wipe a valid pinned selection.
    const candidateIds = Array.from(new Set([
      ...nativeAsrCards(selection.sourceLanguage, catalog),
      ...nativeTranslationCards(selection.sourceLanguage, selection.targetLanguage, catalog),
      ...nativeTtsCards(selection.targetLanguage, catalog),
    ].map((c) => c.downloadId).filter((id): id is string => !!id)));
    const candidateRepos = deriveVariantRepos(asCards(candidateIds), pins);
    await get().refresh(candidateIds, Object.keys(candidateRepos).length > 0 ? candidateRepos : undefined);
    // Reconcile the stale selection against catalog + live statuses. autoSelect
    // also persists to modelPreferences internally; it RETURNS the changed
    // settings fields (the caller applies them to settingsStore).
    const corrections = get().autoSelect(selection.sourceLanguage, selection.targetLanguage, {
      asrModel: selection.asrModel, translationModel: selection.translationModel, ttsModel: selection.ttsModel,
    });
    const effective = corrections ? { ...selection, ...corrections } : selection;
    const asrOpt = catalog[effective.asrModel];
    const asrCompatible = !!asrOpt && asrOpt.kind === 'asr' && supportsLanguage(asrOpt, effective.sourceLanguage);
    const trCompatible = nativeTranslationCards(effective.sourceLanguage, effective.targetLanguage, catalog)
      .some((c) => c.selectId === effective.translationModel);
    const models = requiredNativeModels(
      effective.asrModel, effective.translationModel, effective.ttsModel,
      effective.sourceLanguage, effective.targetLanguage, catalog, textOnly);
    // SECOND refresh: the selected models' chosen variant repos (pin ?? recommended).
    // Includes ttsModel alongside asrModel/translationModel — omitting it here
    // meant a pinned non-recommended TTS variant (e.g. fp32 on a box where bf16
    // is recommended) was checked against the recommended/default repo instead
    // of the pin, so readiness could report ready/missing against the wrong repo.
    // effective.ttsModel is resolved through resolveNativeTts FIRST, not passed
    // raw: '' means Auto, and asCards() below drops '' (catalog[''] is
    // undefined) — passing it raw silently dropped the pin lookup for Auto-TTS
    // users even though `models` above (via requiredNativeModels) already
    // status-checks the concrete Auto-resolved id. Mirrors
    // LocalNativeProviderConfig's ttsModelId resolution (same "not
    // settings.ttsModel, which can be '' for Auto" reasoning).
    const resolvedTtsId = resolveNativeTts(effective.ttsModel, effective.targetLanguage, catalog) ?? '';
    const resolved = deriveVariantRepos(asCards([effective.asrModel, effective.translationModel, resolvedTtsId]), pins);
    const statusRepos = Object.keys(resolved).length > 0 ? resolved : undefined;
    await get().refresh(models, statusRepos);
    const ready = asrCompatible && trCompatible && get().isReady(models);
    const reason: NativeReadinessReason = ready ? 'ready'
      : !asrCompatible ? 'asr-incompatible'
      : !trCompatible ? 'translation-incompatible'
      : 'models-missing';
    return { ready, reason, corrections: corrections ?? null };
  },

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

/** Best-effort detected hardware (CPU/GPU + installed backends) for the Logs
 *  panel. Returns null when the sidecar is unavailable (e.g. not running in
 *  Electron) so callers can skip the log line rather than crash. Exported at
 *  this module boundary so the renderer can mock it in tests. */
export async function nativeHardwareInfo(): Promise<HardwareInfoResultMsg | null> {
  try {
    return await client.hardwareInfo();
  } catch {
    return null;
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
export const useNativeBundleStatus = () => useNativeModelStore((s) => s.bundleStatus);
export const useNativeBundleProgress = () => useNativeModelStore((s) => s.bundleProgress);
export const useNativeBundlePhase = () => useNativeModelStore((s) => s.bundlePhase);
