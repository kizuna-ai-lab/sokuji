/**
 * The page's run, read from React (plan 1e-3b-1 ruling 5): its whole state,
 * its phase, and whether the settings a run fixes are locked. Code outside
 * React reads the phase through `runPhase.ts`.
 */
import { useStore } from 'zustand';
import type { RunState } from '../lib/session/types';
import { getAppSession } from './session';

export function useRunState(): RunState {
  return useStore(getAppSession().runner.state);
}

export function useRunPhase(): RunState['phase'] {
  return useStore(getAppSession().runner.state, (s) => s.phase);
}

/** The settings "What may change during a run" does not list are locked while the phase is not idle — through starting and stopping too (1e-3 ruling 9). */
export function useSessionLocked(): boolean {
  return useRunPhase() !== 'idle';
}
