/**
 * The turn mode: one global setting (D15), since holding a key is the user's
 * habit, not a property of a provider. Plan 1e migrates the old per-provider
 * `turnDetectionMode` values into it.
 */
import { create } from 'zustand';
import type { TurnMode } from '../lib/run/types';
import { DEFAULT_PUSH_KEY, pushKeyAllowed } from '../lib/turn/pushKey';
import { persistSetting } from '../services/persistSetting';

const KEY = 'settings.common.turnMode';
/** The key that holds a push-to-talk or push-to-translate turn (owner, 2026-11-21): its `KeyboardEvent.code`. */
export const PUSH_KEY = 'settings.common.pushKey';

interface TurnModeStore {
  turnMode: TurnMode;
  setTurnMode(turnMode: TurnMode): void;
  pushKey: string;
  /** A key a hold cannot take (`pushKeyAllowed`) changes nothing. */
  setPushKey(code: string): void;
}

export const useTurnModeStore = create<TurnModeStore>()((set) => ({
  turnMode: 'auto',
  setTurnMode(turnMode) {
    set({ turnMode });
    void persistSetting(KEY, turnMode);
  },
  pushKey: DEFAULT_PUSH_KEY,
  setPushKey(code) {
    if (!pushKeyAllowed(code)) return;
    set({ pushKey: code });
    void persistSetting(PUSH_KEY, code);
  },
}));
