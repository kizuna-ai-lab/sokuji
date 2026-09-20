import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useShallow } from 'zustand/shallow';
import type { PunctuationModelId } from '../lib/segmentation/SegmentationRuntime';
import type { SegmentationMode } from '../lib/segmentation/segmentationMode';
import { MODEL_IDS } from '../lib/segmentation/PunctuationRuntime';
import { getManifestEntry } from '../lib/local-inference/modelManifest';
import { ModelManager } from '../lib/local-inference/ModelManager';
import * as modelStorage from '../lib/local-inference/modelStorage';
import { useModelStore } from './modelStore';
import { reportWarning, describeCause } from '../lib/diagnostics/report';

/**
 * Sentence segmentation's three punctuation models are one thing to the user:
 * a single opt-in download, all three or none. This store owns that one
 * download — its phase, how many bytes of it are on disk, and why it stopped
 * — and nothing else. Per-model status is deliberately not modelled: no
 * surface offers a model on its own, and a partial pack is not a usable state
 * (a zh<->en session needs two of the three at once).
 *
 * Bytes, never formatted strings: the UI owns `formatBytes`.
 */

export type PackPhase = 'unknown' | 'missing' | 'downloading' | 'ready' | 'error';

export interface PackModel {
  model: PunctuationModelId;
  manifestId: string;
  /** The manifest's display name, e.g. "FireRedPunc (Chinese)". */
  name: string;
  sizeBytes: number;
}

/**
 * The three models, in manifest order, with their sizes read from the
 * manifest. Derived rather than hand-kept, so a file list or a size edited in
 * the manifest moves the confirmation dialog's total with it — the number the
 * user is asked to approve can never drift from the number that downloads.
 * Each punctuation entry has exactly one variant (no dtype ladder, no
 * device-dependent pick), so the first variant is the variant.
 */
export const PACK_MODELS: PackModel[] = (Object.keys(MODEL_IDS) as PunctuationModelId[])
  .map((model) => {
    const manifestId = MODEL_IDS[model];
    const entry = getManifestEntry(manifestId);
    if (!entry) throw new Error(`Punctuation model missing from the manifest: ${manifestId}`);
    const variant = entry.variants[Object.keys(entry.variants)[0]];
    return {
      model,
      manifestId,
      name: entry.name,
      sizeBytes: variant.files.reduce((sum, f) => sum + f.sizeBytes, 0),
    };
  });

export const PACK_TOTAL_BYTES = PACK_MODELS.reduce((sum, m) => sum + m.sizeBytes, 0);

/**
 * Bumped by every `download()`, every `cancel()` and every `refresh()` that
 * gets past its early return. A download captures it and checks it before each
 * write, so a fetch that resolves, rejects or reports progress after the user
 * cancelled — or after a second download started — cannot flip the phase or
 * move the bar under the run that replaced it.
 * `ModelManager.cancelDownload` aborts the request but never unhooks the
 * callbacks already in flight, which is why the guard lives here.
 *
 * `refresh()` bumps it too, so the later of two overlapping refreshes wins.
 * Reading the disk is not instant, and a delete lands between the read and the
 * write often enough to matter: `deleteModels()` ends with a refresh of its
 * own, and the Storage page's Clear all triggers one. Without the bump, a
 * refresh that read "present" before the delete writes `ready` over a wiped
 * disk, and the section then offers a feature whose models are gone.
 */
let generation = 0;

/** The manifest id currently being fetched, so `cancel()` knows what to abort. */
let inFlightModelId: string | null = null;

interface SegmentationStore {
  phase: PackPhase;
  /** Bytes on disk or fetched so far, summed over the three models. */
  downloadedBytes: number;
  error: string | null;
  /**
   * The segmentation mode the user was in when this download was agreed to,
   * so cancelling it can put them back there rather than on Off.
   *
   * It lives here rather than in the settings section because the download
   * outlives that section: `AdvancedSettings` keys `.settings-content` on the
   * active tab, so switching tab and back unmounts and remounts it, and
   * anything it remembered in a ref is gone — Cancel would then quietly take
   * By pause away from someone who only changed their mind about the 402 MB.
   *
   * Null while nothing is running, and null for a download whose caller did
   * not say where it came from (the status line's Retry), which the section
   * reads as Off.
   */
  modeBeforeDownload: SegmentationMode | null;
  /** Ask the disk. Never interrupts an in-flight download. */
  refresh(): Promise<void>;
  /** Download every model that is not already on disk, one after another.
   *  `modeBefore` is remembered for the life of the download; see above. */
  download(modeBefore?: SegmentationMode): Promise<void>;
  /** Abort the in-flight download. Finished files stay for the next resume. */
  cancel(): void;
  /** Delete all three models' files. */
  deleteModels(): Promise<void>;
}

/**
 * Best-effort refresh of the Storage page's used-storage figure.
 *
 * The pack's download and delete go straight to `ModelManager`, so nothing
 * updates `modelStore`'s own estimate; without this it stays at whatever
 * `modelStore.initialize()` measured at launch and drifts by up to 402 MB for
 * the rest of it. Same call and same rounding `modelStore` uses, and swallowed
 * the same way: the figure is cosmetic and the operation that just succeeded is
 * not failed over it.
 */
async function refreshStorageEstimate(): Promise<void> {
  try {
    const usedBytes = await modelStorage.estimateStorageUsedBytes();
    useModelStore.setState({ storageUsedMb: Math.round(usedBytes / (1024 * 1024)) });
  } catch { /* estimate is cosmetic */ }
}

/** `isModelReady` reaches IndexedDB; a storage failure means "not usable", not a crash. */
async function onDisk(manifestId: string): Promise<boolean> {
  try {
    return await ModelManager.getInstance().isModelReady(manifestId);
  } catch {
    return false;
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export const useSegmentationStore = create<SegmentationStore>()(
  subscribeWithSelector((set, get) => ({
    phase: 'unknown',
    downloadedBytes: 0,
    error: null,
    modeBeforeDownload: null,

    refresh: async () => {
      // A download already knows more than the disk does: mid-fetch, files are
      // half-written and `isModelReady` would report the pack missing.
      if (get().phase === 'downloading') return;
      // Bumped, not merely captured, and only past the early return above — so
      // the later of two overlapping refreshes wins, while a live download is
      // never invalidated by one.
      const gen = ++generation;

      let present = 0;
      let all = true;
      for (const m of PACK_MODELS) {
        if (await onDisk(m.manifestId)) present += m.sizeBytes;
        else all = false;
      }

      // A download that started while we were asking owns the state now.
      if (gen !== generation || get().phase === 'downloading') return;
      set({ phase: all ? 'ready' : 'missing', downloadedBytes: present, error: null });
    },

    download: async (modeBefore) => {
      const gen = ++generation;
      const current = () => gen === generation;
      set({ phase: 'downloading', error: null, modeBeforeDownload: modeBefore ?? null });

      // Bytes of the models already finished — on disk before we started, or
      // fetched by this run. The bar is this plus the current model's progress.
      let completed = 0;
      try {
        for (const m of PACK_MODELS) {
          const ready = await onDisk(m.manifestId);
          // Re-checked after every await: a run that has been replaced must
          // not write `inFlightModelId`, or `cancel()` would abort a fetch
          // belonging to the run that replaced it.
          if (!current()) return;
          if (ready) {
            completed += m.sizeBytes;
            set({ downloadedBytes: completed });
            continue;
          }
          inFlightModelId = m.manifestId;
          // Frozen, so a tick arriving late cannot be added to a later model's
          // running total and jump the bar forward.
          const base = completed;
          await ModelManager.getInstance().downloadModel(m.manifestId, (p) => {
            if (current()) set({ downloadedBytes: base + p.downloadedBytes });
          });
          if (!current()) return;
          inFlightModelId = null;
          completed += m.sizeBytes;
          set({ downloadedBytes: completed });
        }
        // Needs no generation check of its own: the loop cannot exit without
        // having passed one since its last await.
        set({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES, error: null, modeBeforeDownload: null });
        await refreshStorageEstimate();
      } catch (err) {
        // `cancel()` has already written 'missing' and bumped the generation;
        // this branch is what catches an abort from anywhere else.
        if (!current()) return;
        inFlightModelId = null;
        if (isAbort(err)) {
          set({ phase: 'missing', error: null, modeBeforeDownload: null });
          return;
        }
        const message = describeCause(err);
        set({ phase: 'error', error: message, modeBeforeDownload: null });
        reportWarning('Segmentation', `Punctuation model download failed: ${message}`, {
          cause: err,
          dedupeKey: 'segmentation:download',
        });
      }
    },

    cancel: () => {
      // A Cancel button clicked in the frame after the download finished must
      // not un-say 'ready' — there is nothing left to abort by then.
      if (get().phase !== 'downloading') return;
      generation++;
      if (inFlightModelId) {
        ModelManager.getInstance().cancelDownload(inFlightModelId);
        inFlightModelId = null;
      }
      // Whatever was fetched stays on disk, file by file, and the next
      // download resumes over it — so the bytes count survives the cancel.
      // The mode this download came from is dropped with it; the one caller
      // that needs it reads it before calling this.
      set({ phase: 'missing', error: null, modeBeforeDownload: null });
    },

    deleteModels: async () => {
      for (const m of PACK_MODELS) {
        // Deleting a model that was never downloaded is a no-op, not an error.
        await ModelManager.getInstance().deleteModel(m.manifestId);
      }
      await get().refresh();
      await refreshStorageEstimate();
    },
  })),
);

export const useSegmentationPhase = (): PackPhase =>
  useSegmentationStore((state) => state.phase);

export const useSegmentationProgress = (): { downloadedBytes: number; totalBytes: number } =>
  useSegmentationStore(
    useShallow((state) => ({ downloadedBytes: state.downloadedBytes, totalBytes: PACK_TOTAL_BYTES })),
  );
