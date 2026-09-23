/**
 * The turn mode: one global setting (D15), since holding a key is the user's
 * habit, not a property of a provider. Plan 1e migrates the old per-provider
 * `turnDetectionMode` values into it.
 */
import { create } from 'zustand';
import type { TurnMode } from '../lib/session/types';
import { persistSetting } from '../services/persistSetting';
import { ServiceFactory } from '../services/ServiceFactory';

const KEY = 'settings.common.turnMode';
const MODES: readonly TurnMode[] = ['auto', 'push-to-talk', 'push-to-translate'];

interface TurnModeStore {
  turnMode: TurnMode;
  load(): Promise<void>;
  setTurnMode(turnMode: TurnMode): void;
}

export const useTurnModeStore = create<TurnModeStore>()((set) => ({
  turnMode: 'auto',
  async load() {
    const stored = await ServiceFactory.getSettingsService().getSetting(KEY, 'auto');
    set({ turnMode: MODES.find((m) => m === stored) ?? 'auto' });
  },
  setTurnMode(turnMode) {
    set({ turnMode });
    void persistSetting(KEY, turnMode);
  },
}));
