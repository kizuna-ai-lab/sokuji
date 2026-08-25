// src/components/Tour/TourProvider.tsx
//
// The tour's state machine (spec §2.1, §2.3). Owns: which steps are visible for
// the context, which one is current, the resolved target element, and the
// persistence + analytics on finish/skip. Rendering is TourOverlay's job.
//
// `next`/`back`/`skip` read the latest state from a ref (written synchronously
// by `commit`, not from an effect) rather than from inside a `setState`
// updater. React may invoke a `setState` updater twice (StrictMode/dev), and
// `goTo`/`finish` do outward side effects (analytics, persistence, store
// calls) that must fire exactly once per user action; reading a ref outside
// the updater keeps that.
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useAnalytics } from '../../lib/analytics';
import { useSetupStore } from '../../stores/setupStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { TOUR_VERSION } from '../../lib/setup/types';
import { visibleSteps } from './steps';
import type { TourActions, TourStep } from './steps';
import { waitForAnchor } from './dom';
import type { WaitOptions } from './dom';
import type { TourCtx } from './tourContext';

const CHAPTER = 'basics' as const;

export interface TourApi {
  active: boolean;
  chapter: typeof CHAPTER;
  ctx: TourCtx | null;
  steps: TourStep[];
  index: number;
  step: TourStep | null;
  target: HTMLElement | null;
  resolving: boolean;
  start: (ctx: TourCtx) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
}

const TourContext = createContext<TourApi | null>(null);

interface State {
  ctx: TourCtx | null;
  steps: TourStep[];
  index: number;
  target: HTMLElement | null;
  resolving: boolean;
  startedAt: number;
}

const idle: State = { ctx: null, steps: [], index: -1, target: null, resolving: false, startedAt: 0 };

export const TourProvider: React.FC<{ children: React.ReactNode; waitOptions?: WaitOptions }> = ({ children, waitOptions }) => {
  const { trackEvent } = useAnalytics();
  const [state, setState] = useState<State>(idle);
  // Mirrors `state` for the action callbacks below, which need the latest
  // value without depending on (and re-creating on) every state change.
  const stateRef = useRef<State>(state);
  stateRef.current = state;
  // Guards a stale resolution from a step the user already left.
  const generation = useRef(0);

  // Every state write goes through here: the ref is updated *synchronously* so
  // a second click landing in the same turn (before React re-renders) already
  // sees the new index/resolving flag. The render-time mirror above stays as a
  // belt for state React reconciles by other means.
  const commit = useCallback((nextState: State) => {
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const actions = useMemo<TourActions>(() => ({
    openSettings: (target) => {
      useLayoutStore.getState().setShowSettings(true);
      useSettingsStore.getState().navigateToSettings(target);
    },
    closeSettings: () => useLayoutStore.getState().setShowSettings(false),
  }), []);

  const finish = useCallback((method: 'finished' | 'skipped', s: State) => {
    generation.current += 1;
    commit(idle);
    trackEvent('onboarding_completed', {
      chapter: CHAPTER, completion_method: method,
      steps_completed: method === 'finished' ? s.steps.length : Math.max(0, s.index),
      total_steps: s.steps.length, duration_ms: Date.now() - s.startedAt, onboarding_version: TOUR_VERSION,
    });
    useSetupStore.getState().completeTour(CHAPTER, method).catch((err) => console.error('[Tour] Could not persist tour completion:', err));
  }, [commit, trackEvent]);

  // Move to `index`, resolving its anchor; on a missing anchor, keep moving in
  // `dir` until a step resolves or the catalogue runs out.
  const goTo = useCallback(async (s: State, index: number, dir: 1 | -1) => {
    const gen = ++generation.current;
    let i = index;
    while (i >= 0 && i < s.steps.length) {
      const step = s.steps[i];
      commit({ ...s, index: i, target: null, resolving: Boolean(step.anchor) });
      // A throwing `prepare` costs its own step, never the tour: without this
      // the rejection escapes goTo and the state is left stuck on `resolving`,
      // where next() and back() are both no-ops — a permanently wedged tour.
      try {
        step.prepare?.(s.ctx!, actions);
      } catch (err) {
        console.warn(`[Tour] prepare failed for step "${step.id}":`, err);
        trackEvent('onboarding_step_skipped', { chapter: CHAPTER, step_id: step.id, reason: 'target-missing' });
        i += dir;
        continue;
      }
      const target = step.anchor ? await waitForAnchor(step.anchor, waitOptions) : null;
      if (gen !== generation.current) return;
      if (step.anchor && !target) {
        console.warn(`[Tour] Anchor "${step.anchor}" for step "${step.id}" did not appear; skipping.`);
        trackEvent('onboarding_step_skipped', { chapter: CHAPTER, step_id: step.id, reason: 'target-missing' });
        i += dir;
        continue;
      }
      commit({ ...s, index: i, target, resolving: false });
      trackEvent('onboarding_step_viewed', { chapter: CHAPTER, step_index: i, step_id: step.id });
      return;
    }
    // Ran off either end: treat as finished (forward) or stay put (backward).
    if (dir === 1) finish('finished', s); else commit({ ...s, resolving: false });
  }, [actions, commit, finish, trackEvent, waitOptions]);

  const start = useCallback((ctx: TourCtx) => {
    const steps = visibleSteps(ctx);
    const s: State = { ctx, steps, index: -1, target: null, resolving: false, startedAt: Date.now() };
    trackEvent('onboarding_started', { chapter: CHAPTER, is_first_time_user: ctx.scenario !== null, onboarding_version: TOUR_VERSION });
    void goTo(s, 0, 1);
  }, [goTo, trackEvent]);

  const next = useCallback(() => {
    const s = stateRef.current;
    // A step whose anchor is still being awaited owns the tour: dropping the
    // click is better than advancing twice and silently skipping a step.
    if (!s.ctx || s.resolving) return;
    if (s.index >= s.steps.length - 1) { finish('finished', s); return; }
    void goTo(s, s.index + 1, 1);
  }, [finish, goTo]);

  const back = useCallback(() => {
    const s = stateRef.current;
    if (!s.ctx || s.resolving || s.index <= 0) return;
    void goTo(s, s.index - 1, -1);
  }, [goTo]);

  const skip = useCallback(() => {
    const s = stateRef.current;
    if (!s.ctx) return;
    finish('skipped', s);
  }, [finish]);

  const api = useMemo<TourApi>(() => ({
    active: state.ctx !== null, chapter: CHAPTER, ctx: state.ctx, steps: state.steps, index: state.index,
    step: state.index >= 0 ? state.steps[state.index] ?? null : null, target: state.target, resolving: state.resolving,
    start, next, back, skip,
  }), [state, start, next, back, skip]);

  return <TourContext.Provider value={api}>{children}</TourContext.Provider>;
};

export function useTour(): TourApi {
  const api = useContext(TourContext);
  if (!api) throw new Error('useTour must be used within a TourProvider');
  return api;
}
