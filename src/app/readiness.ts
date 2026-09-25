/**
 * The app's local-readiness driver (1e-3 ruling 16: a local provider's
 * readiness is checked automatically — no Validate button — and worded by
 * its code). Re-checks the selected `kind: 'local'` provider while its
 * readiness is unknown, and whenever its own inputs change
 * (`Provider.watchReadiness` — LocalInference's model downloads),
 * debounced, and only while the runner is idle: a change seen mid-run is
 * checked once idle again.
 */
import type { Clock } from '../lib/contract/clock';
import type { AnyProvider, AuthContext } from '../lib/provider/types';
import type { Runner } from '../lib/session/runner';
import { useProviderStore } from '../stores/providerStore';

export const READINESS_DELAY_MS = 150;

export interface ReadinessDriverDeps {
  runner: Pick<Runner, 'state'>;
  providers(): readonly AnyProvider[];
  auth(): AuthContext;
  clock: Pick<Clock, 'setTimeout'>;
  delayMs?: number;
}

export function driveLocalReadiness({ runner, providers, auth, clock, delayMs = READINESS_DELAY_MS }: ReadinessDriverDeps): () => void {
  let cancel: (() => void) | null = null;
  let watched: { id: string; off: () => void } | null = null;
  /** Its inputs changed while a run was on: check once the runner is idle again. */
  let stale = false;
  const idle = () => runner.state.getState().phase === 'idle';
  const current = (): AnyProvider | undefined => {
    const { selected, entries } = useProviderStore.getState();
    const p = providers().find((candidate) => candidate.id === selected);
    return p && p.kind === 'local' && entries[p.id] ? p : undefined;
  };
  const check = () => {
    cancel = null;
    const p = current();
    if (p && idle()) void useProviderStore.getState().refreshReadiness(p, auth());
  };
  const schedule = () => {
    cancel?.();
    cancel = clock.setTimeout(check, delayMs);
  };
  const inputsChanged = () => {
    if (idle()) schedule();
    else stale = true;
  };
  const evaluate = () => {
    const p = current();
    if (watched?.id !== p?.id) {
      watched?.off();
      watched = p ? { id: p.id, off: p.watchReadiness?.(inputsChanged) ?? (() => {}) } : null;
    }
    if (!p || !idle()) return;
    const readiness = useProviderStore.getState().readiness[p.id];
    if (stale || !readiness || readiness.state === 'unknown') {
      stale = false;
      schedule();
    }
  };
  const offStore = useProviderStore.subscribe(evaluate);
  const offRun = runner.state.subscribe(evaluate);
  evaluate();
  return () => {
    offStore();
    offRun();
    watched?.off();
    watched = null;
    cancel?.();
    cancel = null;
  };
}
