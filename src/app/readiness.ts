/**
 * The app's readiness driver (F1; 1e-3 ruling 16 for local providers; the
 * controller's timing ruling). Checks the selected provider, of every
 * kind, while its readiness is unknown, and only while the runner is idle:
 * a change seen mid-run is checked once idle again.
 * - A local provider: every check after `READINESS_DELAY_MS`, as before;
 *   its own inputs changing (`watchReadiness`: LocalInference's
 *   downloads) re-checks it too.
 * - An own-key or managed provider: at once — on the clock's next turn,
 *   never inside a store's notification — when it is selected, when its
 *   entry loads, and on a sign-in flip; every other reset (an edit to its
 *   settings, credentials or pair; other legs) after
 *   `NETWORK_READINESS_DELAY_MS`, so typing a key checks once per pause.
 * - A sign-in flip forgets every loaded managed provider's readiness.
 * - A flip heard while a run is on forgets those answers at once; the
 *   selected provider is re-checked once idle, after the edit delay.
 */
import type { Clock } from '../lib/contract/clock';
import type { AnyProvider, AuthContext } from '../lib/provider/types';
import type { Runner } from '../lib/session/runner';
import { useProviderStore } from '../stores/providerStore';

export const READINESS_DELAY_MS = 150;
/** A judgement, not a measurement (choice 7): a pause in typing. */
export const NETWORK_READINESS_DELAY_MS = 800;

export interface ReadinessDriverDeps {
  runner: Pick<Runner, 'state'>;
  providers(): readonly AnyProvider[];
  auth(): AuthContext;
  clock: Pick<Clock, 'setTimeout'>;
  /** Calls back on every sign-in flip; returns the unsubscribe. Absent: no sign-in is watched. */
  watchSignIn?(onChange: () => void): () => void;
  delayMs?: number;
  networkDelayMs?: number;
}

export function driveReadiness({ runner, providers, auth, clock, watchSignIn, delayMs = READINESS_DELAY_MS, networkDelayMs = NETWORK_READINESS_DELAY_MS }: ReadinessDriverDeps): () => void {
  let cancel: (() => void) | null = null;
  /** The pending check was scheduled at once: a later reset reads the same live inputs when it runs, so it is not pushed out. */
  let pendingAtOnce = false;
  let watched: { id: string; off: () => void } | null = null;
  /** The selected provider whose loaded entry was last evaluated: any other one is just selected, or just loaded. */
  let seen: string | null = null;
  /** Its inputs changed while a run was on: check once the runner is idle again. */
  let stale = false;
  const idle = () => runner.state.getState().phase === 'idle';
  const current = (): AnyProvider | undefined => {
    const { selected, entries } = useProviderStore.getState();
    const p = providers().find((candidate) => candidate.id === selected);
    return p && entries[p.id] ? p : undefined;
  };
  const check = () => {
    cancel = null;
    pendingAtOnce = false;
    const p = current();
    if (!p || !idle()) return;
    // A network provider no longer unknown was checked meanwhile (a Validate, a start); a local one re-checks whatever it knows.
    if (p.kind !== 'local' && (useProviderStore.getState().readiness[p.id]?.state ?? 'unknown') !== 'unknown') return;
    void useProviderStore.getState().refreshReadiness(p, auth());
  };
  const schedule = (p: AnyProvider, atOnce: boolean) => {
    if (pendingAtOnce) return;
    cancel?.();
    pendingAtOnce = atOnce && p.kind !== 'local';
    cancel = clock.setTimeout(check, p.kind === 'local' ? delayMs : pendingAtOnce ? 0 : networkDelayMs);
  };
  const inputsChanged = () => {
    const p = current();
    if (!p) return;
    if (idle()) schedule(p, false);
    else stale = true;
  };
  const evaluate = () => {
    const p = current();
    if (watched?.id !== p?.id) {
      watched?.off();
      watched = p ? { id: p.id, off: p.watchReadiness?.(inputsChanged) ?? (() => {}) } : null;
    }
    if (!p) {
      // Nothing loaded is selected: whichever provider comes next is just selected, even the last one.
      seen = null;
      return;
    }
    if (!idle()) return;
    const fresh = p.id !== seen;
    seen = p.id;
    // A timer armed for the previous provider must not check this one.
    if (fresh) { cancel?.(); cancel = null; pendingAtOnce = false; }
    const readiness = useProviderStore.getState().readiness[p.id];
    if (stale || !readiness || readiness.state === 'unknown') {
      stale = false;
      schedule(p, fresh);
    }
  };
  const signInChanged = () => {
    const { entries, forgetReadiness } = useProviderStore.getState();
    for (const p of providers()) if (p.kind === 'managed' && entries[p.id]) forgetReadiness(p);
    // Forgetting notified `evaluate`, which scheduled an edit's delay: a flip checks at once.
    const p = current();
    if (p?.kind === 'managed' && idle()) {
      cancel?.();
      cancel = null;
      pendingAtOnce = false;
      schedule(p, true);
    }
  };
  const offStore = useProviderStore.subscribe(evaluate);
  const offRun = runner.state.subscribe(evaluate);
  const offSignIn = watchSignIn?.(signInChanged) ?? (() => {});
  evaluate();
  return () => {
    offStore();
    offRun();
    offSignIn();
    watched?.off();
    watched = null;
    cancel?.();
    cancel = null;
    pendingAtOnce = false;
  };
}
