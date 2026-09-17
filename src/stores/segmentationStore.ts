import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { PunctuationModelId } from '../lib/segmentation/SegmentationRuntime';
import type { PunctuationStatus } from '../lib/segmentation/PunctuationRuntime';

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

interface SegmentationStore {
  models: Record<PunctuationModelId, SegmentationModelState>;
  setModelStatus(model: PunctuationModelId, status: PunctuationStatus, error?: string): void;
  setModelProgress(model: PunctuationModelId, percent: number): void;
  /** Drop what was only true for the session that just ended. */
  resetSession(): void;
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
            // session-scoped disable do not.
            const keepsDownload = prev.status === 'ready' || prev.status === 'loading'
              || prev.status === 'downloaded' || prev.status === 'disabled';
            return [m, keepsDownload
              ? { status: 'downloaded' as PunctuationStatus, percent: 100, error: null }
              : { status: 'not-downloaded' as PunctuationStatus, percent: 0, error: null }];
          }),
        ) as Record<PunctuationModelId, SegmentationModelState>,
      })),
  })),
);

export const useSegmentationModelState = (model: PunctuationModelId) =>
  useSegmentationStore((state) => state.models[model]);
