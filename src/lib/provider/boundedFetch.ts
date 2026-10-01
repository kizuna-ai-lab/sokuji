/**
 * A readiness check's request, bounded (spec: "Readiness is one check" —
 * `check` bounds its own request): the skeleton Soniox's, Gemini's and
 * OpenAI Translate's checks each wrote out, lifted at its fourth user,
 * OpenAI Realtime (Stage 2 OpenAI Realtime, choice 2). `run` is handed a
 * signal that aborts when the caller's does, with its reason, or when
 * `ms` pass on `clock` with no answer — then the request throws `late`,
 * the check's own words. An already aborted caller throws its reason
 * before `run` starts. Nothing is left behind: the timer is cancelled and
 * the caller's listener removed however `run` settles. The settings side
 * only; no session code runs it.
 */
import type { Clock } from '../contract/clock';

export interface Bound {
  clock: Pick<Clock, 'setTimeout'>;
  /** How long the request may take. */
  ms: number;
  /** The caller's signal (`CheckContext.signal`); absent, only the bound aborts. */
  signal?: AbortSignal;
  /** What the request throws when the bound passes: the check's own words, naming its provider. */
  late: string;
}

export async function boundedFetch<T>(bound: Bound, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const { clock, ms, signal, late } = bound;
  if (signal?.aborted) throw signal.reason ?? new Error('aborted');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = clock.setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await run(controller.signal);
  } catch (error) {
    if (timedOut) throw new Error(late);
    throw error;
  } finally {
    cancel();
    signal?.removeEventListener('abort', onAbort);
  }
}
