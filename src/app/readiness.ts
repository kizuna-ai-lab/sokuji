/**
 * The app's readiness driver (F1; 1e-3 ruling 16 for local providers; the
 * controller's timing ruling). Checks every provider of the plan a start
 * would run, of every kind, while its readiness is unknown, and only while
 * the runner is idle: a change seen mid-run is checked once idle again.
 * Each provider keeps its own timer, so one provider's edit never pushes
 * out another's check.
 * - A local provider: every check after `READINESS_DELAY_MS`, as before;
 *   its own inputs changing (`watchReadiness`: LocalInference's
 *   downloads) re-checks it too.
 * - An own-key or managed provider: at once — on the clock's next turn,
 *   never inside a store's notification — when it joins the plan, when its
 *   entry loads, and on a sign-in flip; every other reset (an edit to its
 *   credentials or to a setting it reads — and, for one whose check reads
 *   them, its pair or the legs) after `NETWORK_READINESS_DELAY_MS`, so
 *   typing a key checks once per pause. No released network provider reads
 *   the pair or the legs: a pick or an audio-mode switch checks none.
 * - The stages each provider serves in the plan are kept in the provider
 *   store, with the stored line-up's id for each, for its check to read; a
 *   provider whose stages or ids changed forgets its readiness and is
 *   checked again, as after an edit.
 * - A sign-in flip forgets every loaded managed provider's readiness.
 * - A flip heard while a run is on forgets those answers at once; the
 *   plan's managed providers are re-checked once idle, after the edit delay.
 */
import type { Clock } from '../lib/contract/clock';
import { checkStagesOf, providersIn } from '../lib/plan/read';
import type { RunPlan } from '../lib/plan/types';
import type { AnyProvider } from '../lib/provider/types';
import type { AuthContext } from '../lib/run/types';
import type { Runner } from '../lib/session/runner';
import { useLineUpStore } from '../stores/lineUpStore';
import { localModels } from '../stores/localModels';
import { useProviderStore } from '../stores/providerStore';

export const READINESS_DELAY_MS = 150;
/** A judgement, not a measurement (choice 7): a pause in typing. */
export const NETWORK_READINESS_DELAY_MS = 800;

export interface ReadinessDriverDeps {
  runner: Pick<Runner, 'state'>;
  /** Every provider offered: a sign-in flip forgets each loaded managed one, in the plan or not. */
  providers(): readonly AnyProvider[];
  /** The plan whose providers are checked, once every entry of it has loaded; null while there is none. */
  plan(): RunPlan | null;
  auth(): AuthContext;
  clock: Pick<Clock, 'setTimeout'>;
  /** Calls back on every sign-in flip; returns the unsubscribe. Absent: no sign-in is watched. */
  watchSignIn?(onChange: () => void): () => void;
  delayMs?: number;
  networkDelayMs?: number;
}

export function driveReadiness({ runner, providers, plan, auth, clock, watchSignIn, delayMs = READINESS_DELAY_MS, networkDelayMs = NETWORK_READINESS_DELAY_MS }: ReadinessDriverDeps): () => void {
  /** Each provider's pending check, by id. */
  const cancel = new Map<string, () => void>();
  /** The providers whose pending check was scheduled at once: a later reset reads the same live inputs when it runs, so it is not pushed out. */
  const pendingAtOnce = new Set<string>();
  /** Each provider of the plan whose own inputs are watched, with its unwatch. */
  const watched = new Map<string, () => void>();
  /** The providers of the plan whose loaded entries were last evaluated: any other one just joined the plan, or just loaded. */
  let seen: ReadonlySet<string> = new Set();
  /** The providers whose inputs changed while a run was on: checked once the runner is idle again. */
  const stale = new Set<string>();
  /** What each provider's last evaluation read of it: a store change that left both as they were was not about this provider. */
  const read = new Map<string, { entry: unknown; readiness: unknown }>();
  const idle = () => runner.state.getState().phase === 'idle';
  const current = (): readonly AnyProvider[] => {
    const p = plan();
    return p ? providersIn(p) : [];
  };
  /** Its pending check, if any, is dropped. */
  const drop = (id: string) => {
    cancel.get(id)?.();
    cancel.delete(id);
    pendingAtOnce.delete(id);
  };
  const check = (id: string) => {
    cancel.delete(id);
    pendingAtOnce.delete(id);
    const p = current().find((candidate) => candidate.id === id);
    if (!p || !idle()) return;
    // A network provider no longer unknown was checked meanwhile (a Validate, a start); a local one re-checks whatever it knows.
    if (p.kind !== 'local' && (useProviderStore.getState().readiness[p.id]?.state ?? 'unknown') !== 'unknown') return;
    void useProviderStore.getState().refreshReadiness(p, auth());
  };
  const schedule = (p: AnyProvider, atOnce: boolean) => {
    if (pendingAtOnce.has(p.id)) return;
    cancel.get(p.id)?.();
    const now = atOnce && p.kind !== 'local';
    if (now) pendingAtOnce.add(p.id);
    cancel.set(p.id, clock.setTimeout(() => check(p.id), p.kind === 'local' ? delayMs : now ? 0 : networkDelayMs));
  };
  const inputsChanged = (id: string) => {
    const p = current().find((candidate) => candidate.id === id);
    if (!p) return;
    if (idle()) schedule(p, false);
    else stale.add(p.id);
  };
  /**
   * Keeps the store's stages on the plan's: what each provider of the plan serves there, when that is only a part
   * of it. True when they moved: the store forgot those providers' readiness and notified, and that evaluation
   * was this one. A provider outside the plan keeps what it was last told, and without a plan nothing moves: a
   * provider that leaves and comes back to the same stages keeps its answer.
   */
  const stagesMoved = (): boolean => {
    const p = plan();
    if (!p) return false;
    const before = useProviderStore.getState().stages;
    const next = { ...before };
    for (const provider of providersIn(p)) {
      const stages = checkStagesOf(p, provider);
      if (stages) next[provider.id] = stages;
      else delete next[provider.id];
    }
    useProviderStore.getState().setStages(next);
    return useProviderStore.getState().stages !== before;
  };
  const evaluate = () => {
    if (stagesMoved()) return;
    const ps = current();
    const ids = new Set(ps.map((p) => p.id));
    // A provider that left the plan is no longer watched, and its pending check and held change go with it.
    for (const [id, off] of watched) {
      if (ids.has(id)) continue;
      off();
      watched.delete(id);
    }
    for (const id of [...cancel.keys()]) if (!ids.has(id)) drop(id);
    for (const id of [...stale]) if (!ids.has(id)) stale.delete(id);
    for (const id of [...read.keys()]) if (!ids.has(id)) read.delete(id);
    // Each provider's watch is handed this device's models; only LocalInference reads them (its downloads).
    for (const p of ps) if (!watched.has(p.id)) watched.set(p.id, p.watchReadiness?.(() => inputsChanged(p.id), localModels) ?? (() => {}));
    if (!ps.length) {
      // No plan has loaded: whichever provider comes next has just joined, even the last one.
      seen = new Set();
      return;
    }
    if (!idle()) return;
    const before = seen;
    seen = ids;
    for (const p of ps) {
      const fresh = !before.has(p.id);
      const { entries, readiness: all } = useProviderStore.getState();
      const readiness = all[p.id];
      const was = read.get(p.id);
      const own = !was || was.entry !== entries[p.id] || was.readiness !== readiness;
      read.set(p.id, { entry: entries[p.id], readiness });
      // The store notifies on every provider's change. A pending check is pushed out only by a change to this
      // provider's own entry or readiness (an edit, a reset): another provider's must not keep moving it later.
      const unknown = !readiness || readiness.state === 'unknown';
      if (stale.has(p.id) || (unknown && (own || !cancel.has(p.id)))) {
        stale.delete(p.id);
        schedule(p, fresh);
      }
    }
  };
  const signInChanged = () => {
    const { entries, forgetReadiness } = useProviderStore.getState();
    for (const p of providers()) if (p.kind === 'managed' && entries[p.id]) forgetReadiness(p);
    // Forgetting notified `evaluate`, which scheduled an edit's delay: a flip checks the plan's managed providers at once.
    if (!idle()) return;
    for (const p of current()) {
      if (p.kind !== 'managed') continue;
      drop(p.id);
      schedule(p, true);
    }
  };
  // The plan follows the line-up as well as the provider store's entries.
  const offLineUp = useLineUpStore.subscribe(evaluate);
  const offStore = useProviderStore.subscribe(evaluate);
  const offRun = runner.state.subscribe(evaluate);
  const offSignIn = watchSignIn?.(signInChanged) ?? (() => {});
  evaluate();
  return () => {
    offLineUp();
    offStore();
    offRun();
    offSignIn();
    for (const off of watched.values()) off();
    watched.clear();
    for (const id of [...cancel.keys()]) drop(id);
  };
}
