/**
 * The screen context of the run, for whoever draws it (spec 2026-10-22 §3.1,
 * §3.4): the sampler whose `source` the run's legs subscribe to, and its state
 * as it last told it — a mirror `src/app/screenContext.ts` fills before a run
 * and empties when the run is over.
 *
 * Beside it, the area the user chose (the settings' switch, a Start-time
 * picker, Choose again): held in memory for the next Start across runs, and
 * never persisted — a window id dies with its window and a title match is
 * unreliable, so an app restart asks again. And the panel's picker, for the
 * settings to ask.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { CaptureSourceInfo } from '../lib/screen/desktopFrames';
import type { Sampler, SamplerState } from '../lib/screen/sampler';

/** What the picker answers: a window or screen from Sokuji's list, or the portal's button (the desktop's own chooser decides at Start). */
export type PickedSource = { kind: 'desktop'; source: CaptureSourceInfo } | { kind: 'portal' };
/** Why the picker is shown at Start: the area picked yielded no frame, or the window held is gone (its capture would not open). */
export type PickReason = 'nothingVisible' | 'gone';

export interface ScreenContextStore {
  /** The sampler whose `source` the run gets; null between runs. */
  sampler: Sampler | null;
  state: SamplerState | null;
  /** A chosen area is being checked for its first frame before the run starts (about a second, up to four on a blank one): Start shows it, and a picker just answered stays up. */
  preparing: boolean;
  /** The area the next Start opens without asking; null when nothing is chosen. Memory only: a run's end keeps it, an app restart clears it. */
  picked: PickedSource | null;
  /** The panel's picker, for the settings to ask (desktop only); null while no panel is mounted. Null on Cancel. */
  pickSource: ((reason?: PickReason) => Promise<PickedSource | null>) | null;
  set(sampler: Sampler | null): void;
  setState(state: SamplerState | null): void;
  setPreparing(preparing: boolean): void;
  setPicked(picked: PickedSource | null): void;
  setPickSource(pickSource: ((reason?: PickReason) => Promise<PickedSource | null>) | null): void;
}

export const useScreenContextStore: UseBoundStore<StoreApi<ScreenContextStore>> = create<ScreenContextStore>()((set) => ({
  sampler: null,
  state: null,
  preparing: false,
  picked: null,
  pickSource: null,
  set(sampler) {
    set({ sampler });
  },
  setState(state) {
    set({ state });
  },
  setPreparing(preparing) {
    set({ preparing });
  },
  setPicked(picked) {
    set({ picked });
  },
  setPickSource(pickSource) {
    set({ pickSource });
  },
}));
