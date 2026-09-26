/**
 * The turn mode: one global setting (D15), since holding a key is the user's
 * habit, not a property of a provider. Plan 1e migrates the old per-provider
 * `turnDetectionMode` values into it.
 */
import { create } from 'zustand';
import type { TurnMode } from '../lib/session/types';
import { persistSetting } from '../services/persistSetting';

const KEY = 'settings.common.turnMode';

interface TurnModeStore {
  turnMode: TurnMode;
  setTurnMode(turnMode: TurnMode): void;
}

export const useTurnModeStore = create<TurnModeStore>()((set) => ({
  turnMode: 'auto',
  setTurnMode(turnMode) {
    set({ turnMode });
    void persistSetting(KEY, turnMode);
  },
}));
