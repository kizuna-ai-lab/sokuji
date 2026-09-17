import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { PunctuationModelId } from '../lib/segmentation/SegmentationRuntime';
import { MODEL_IDS, type PunctuationStatus } from '../lib/segmentation/PunctuationRuntime';
import type { ModelStatus } from '../lib/local-inference/modelManifest';

export interface SegmentationModelState {
  status: PunctuationStatus;
  percent: number;
  error: string | null;
}

const MODELS: PunctuationModelId[] = ['fireredpunc', 'edge-punct-en', 'sat-3l-sm'];

const blank = (): Record<PunctuationModelId, SegmentationModelState> =>
  Object.fromEntries(
    MODELS.map((m) => [m, { status: 'not-downloaded', percent: 0, error: null }]),
  ) as Record<PunctuationModelId, SegmentationModelState>;

/**
 * Maps modelStore's on-disk status vocabulary onto this store's own
 * `PunctuationStatus`. The two differ in spelling (`not_downloaded` vs
 * `not-downloaded`) and in richness — modelStore has no notion of `loading`,
 * `ready` or `disabled`, all of which are session facts this store's own
 * runtime events already own. Returns null for "nothing to seed": either
 * modelStore has no data yet, or the on-disk status is one this store never
 * seeds — `not_downloaded` needs no seeding (it is already the placeholder),
 * and `downloading` is never resumed automatically (modelStore.initialize()
 * always resets an in-flight download back to `not_downloaded` on a fresh
 * launch), so it would never legitimately describe an on-disk fact at seed
 * time anyway.
 */
function fromOnDiskStatus(status: ModelStatus | undefined): PunctuationStatus | null {
  switch (status) {
    case 'downloaded': return 'downloaded';
    case 'error': return 'error';
    case 'not_downloaded':
    case 'downloading':
    case undefined:
      return null;
  }
}

interface SegmentationStore {
  models: Record<PunctuationModelId, SegmentationModelState>;
  setModelStatus(model: PunctuationModelId, status: PunctuationStatus, error?: string): void;
  setModelProgress(model: PunctuationModelId, percent: number): void;
  /** Drop what was only true for the session that just ended. */
  resetSession(): void;
  /**
   * Seed a model's on-launch status from modelStore's already-computed
   * on-disk facts (`modelStore.initialize()` / `useModelStatuses()`). This
   * store otherwise starts every model 'not-downloaded' with nothing to tell
   * it otherwise, so a model already on disk would render a Download button
   * and re-download bytes the user already has. A session fact always wins:
   * only a model still at the initial 'not-downloaded' placeholder is ever
   * touched here.
   */
  seedFromModelStatuses(modelStatuses: Record<string, ModelStatus>): void;
}

/**
 * What the Sentence segmentation section renders.
 *
 * The runtime owns the truth and pushes into here; nothing reads back out of
 * the store into the runtime. That is what keeps PunctuationRuntime free of a
 * store import, so it stays unit-testable with a fake worker.
 */
export const useSegmentationStore = create<SegmentationStore>()(
  subscribeWithSelector((set) => ({
    models: blank(),

    setModelStatus: (model, status, error) =>
      set((state) => ({
        models: {
          ...state.models,
          [model]: {
            status,
            percent: status === 'ready' || status === 'downloaded' ? 100 : state.models[model].percent,
            error: status === 'error' ? (error ?? 'unknown error') : null,
          },
        },
      })),

    setModelProgress: (model, percent) =>
      set((state) => ({
        models: { ...state.models, [model]: { ...state.models[model], percent } },
      })),

    resetSession: () =>
      set((state) => ({
        models: Object.fromEntries(
          MODELS.map((m) => {
            const prev = state.models[m];
            // Downloaded bytes survive a session; a loaded model and a
            // session-scoped disable do not. Discarding in-flight state is safe:
            // ModelManager resumes downloads at file granularity (storage.hasFile
            // skips files already complete, and cancelled downloads leave partial
            // files in place), so only the progress bar and current file's
            // unpersisted bytes are lost.
            const keepsDownload = prev.status === 'ready' || prev.status === 'loading'
              || prev.status === 'downloaded' || prev.status === 'disabled';
            return [m, keepsDownload
              ? { status: 'downloaded' as PunctuationStatus, percent: 100, error: null }
              : { status: 'not-downloaded' as PunctuationStatus, percent: 0, error: null }];
          }),
        ) as Record<PunctuationModelId, SegmentationModelState>,
      })),

    seedFromModelStatuses: (modelStatuses) =>
      set((state) => {
        let changed = false;
        const models = { ...state.models };
        for (const model of MODELS) {
          // A session fact — a runtime event, or an earlier seed — always
          // wins: only the initial placeholder is ever replaced here.
          if (state.models[model].status !== 'not-downloaded') continue;
          const mapped = fromOnDiskStatus(modelStatuses[MODEL_IDS[model]]);
          if (mapped === null) continue;
          changed = true;
          models[model] = { status: mapped, percent: mapped === 'downloaded' ? 100 : 0, error: null };
        }
        return changed ? { models } : state;
      }),
  })),
);

export const useSegmentationModelState = (model: PunctuationModelId) =>
  useSegmentationStore((state) => state.models[model]);
