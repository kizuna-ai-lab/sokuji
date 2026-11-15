/**
 * The pending "change region?" question a dialog renders and answers: the
 * region change path asks, the dialog answers, nobody else touches it.
 */
import { create } from 'zustand';
import type { SonioxRegion } from '../lib/soniox/regions';
import type { SonioxRegionWarning } from '../providers/soniox/regionChange';

export interface RegionChangeQuestion {
  providerId: 'soniox' | 'kizunaai_soniox';
  managed: boolean;
  from: SonioxRegion;
  to: SonioxRegion;
  warning: SonioxRegionWarning;
}

interface RegionChangeState {
  question: RegionChangeQuestion | null;
  /** Resolves with the answer; an earlier question still open is answered `false`. */
  ask(q: RegionChangeQuestion): Promise<boolean>;
  answer(ok: boolean): void;
}

let resolveOpen: ((ok: boolean) => void) | null = null;

export const useRegionChangeStore = create<RegionChangeState>((set) => ({
  question: null,
  ask(q) {
    resolveOpen?.(false);
    return new Promise<boolean>((resolve) => {
      resolveOpen = resolve;
      set({ question: q });
    });
  },
  answer(ok) {
    const resolve = resolveOpen;
    resolveOpen = null;
    set({ question: null });
    resolve?.(ok);
  },
}));
