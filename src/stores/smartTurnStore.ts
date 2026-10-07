import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { getManifestEntry } from '../lib/local-inference/modelManifest';
import { ModelManager } from '../lib/local-inference/ModelManager';
import { SMART_TURN_MODEL_ID } from '../lib/turn/smartTurn';
import { describeCause, reportWarning } from '../lib/diagnostics/report';

export type SmartTurnPhase = 'unknown' | 'missing' | 'downloading' | 'ready' | 'error';

export const SMART_TURN_TOTAL_BYTES = (() => {
  const entry = getManifestEntry(SMART_TURN_MODEL_ID);
  if (!entry) throw new Error(`Smart Turn model missing from the manifest: ${SMART_TURN_MODEL_ID}`);
  return entry.variants.default.files.reduce((sum, f) => sum + f.sizeBytes, 0);
})();

/** Bumped by every download and every refresh past its early return: the later one wins. */
let generation = 0;

interface SmartTurnStore {
  phase: SmartTurnPhase;
  downloadedBytes: number;
  error: string | null;
  /** Ask the disk. Never interrupts a download. */
  refresh(): Promise<void>;
  /** Forget a failed download: error -> missing. */
  dismiss(): void;
  /** Fetch the model unless it is on disk. Never rejects: ends 'ready' or 'error'. */
  download(): Promise<void>;
}

async function onDisk(): Promise<boolean> {
  try {
    return await ModelManager.getInstance().isModelReady(SMART_TURN_MODEL_ID);
  } catch {
    return false;
  }
}

/** The Smart Turn model's one download: its phase, its bytes so far, why it stopped. */
export const useSmartTurnStore = create<SmartTurnStore>()(
  subscribeWithSelector((set, get) => ({
    phase: 'unknown',
    downloadedBytes: 0,
    error: null,

    refresh: async () => {
      if (get().phase === 'downloading') return;
      const gen = ++generation;
      const ready = await onDisk();
      if (gen !== generation || get().phase === 'downloading') return;
      set({ phase: ready ? 'ready' : 'missing', downloadedBytes: ready ? SMART_TURN_TOTAL_BYTES : 0, error: null });
    },

    dismiss: () => {
      if (get().phase === 'error') set({ phase: 'missing', error: null });
    },

    download: async () => {
      if (get().phase === 'downloading') return;
      const gen = ++generation;
      set({ phase: 'downloading', downloadedBytes: 0, error: null });
      try {
        if (!(await onDisk())) {
          await ModelManager.getInstance().downloadModel(SMART_TURN_MODEL_ID, (p) => {
            if (gen === generation) set({ downloadedBytes: p.downloadedBytes });
          });
        }
        if (gen !== generation) return;
        set({ phase: 'ready', downloadedBytes: SMART_TURN_TOTAL_BYTES, error: null });
      } catch (err) {
        if (gen !== generation) return;
        const message = describeCause(err);
        set({ phase: 'error', error: message });
        reportWarning('SmartTurn', `Smart Turn model download failed: ${message}`, {
          cause: err,
          dedupeKey: 'smart-turn:download',
        });
      }
    },
  })),
);

export const useSmartTurnPhase = (): SmartTurnPhase => useSmartTurnStore((state) => state.phase);
