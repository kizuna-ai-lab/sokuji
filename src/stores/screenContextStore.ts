/**
 * The screen context of the run, for whoever draws it (spec 2026-10-22 §3.4):
 * the sampler whose `source` the run's legs subscribe to, and its state as it
 * last told it. A mirror only — `src/app/screenContext.ts` fills it before a
 * run and empties it when the run is over. Nothing is persisted: every run
 * picks its source from scratch.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { Sampler, SamplerState } from '../lib/screen/sampler';

export interface ScreenContextStore {
  /** The sampler whose `source` the run gets; null between runs. */
  sampler: Sampler | null;
  state: SamplerState | null;
  /** A chosen area is being checked for its first frame before the run starts (about a second, up to four on a blank one): Start shows it, and the picker stays up. */
  preparing: boolean;
  set(sampler: Sampler | null): void;
  setState(state: SamplerState | null): void;
  setPreparing(preparing: boolean): void;
}

export const useScreenContextStore: UseBoundStore<StoreApi<ScreenContextStore>> = create<ScreenContextStore>()((set) => ({
  sampler: null,
  state: null,
  preparing: false,
  set(sampler) {
    set({ sampler });
  },
  setState(state) {
    set({ state });
  },
  setPreparing(preparing) {
    set({ preparing });
  },
}));
