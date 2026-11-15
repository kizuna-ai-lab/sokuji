/**
 * Latency probe: measures the round-trip to each region with a cross-origin
 * HEAD request. Platform-neutral — fetch, clock, sleep and cancellation are
 * injected, nothing is imported.
 */

/** region → median ms; every probed region is present, null = unmeasured. */
export type RegionMedians = Readonly<Record<string, number | null>>;

export interface ProbeTarget {
  region: string;
  url: string;
}

export interface ProbeDeps {
  fetch(url: string, init: RequestInit): Promise<unknown>;
  /** Milliseconds, monotonic (performance.now in the app). */
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Cancels the whole measurement. */
  signal?: AbortSignal;
}

export const PROBE_ROUNDS = 5;
export const PROBE_GAP_MS = 200;
export const PROBE_TIMEOUT_MS = 3000;
export const PROBE_MIN_SUCCESSES = 3;

/** One timed request; the elapsed ms, or null on rejection or timeout. */
async function probeOnce(url: string, deps: ProbeDeps): Promise<number | null> {
  const controller = new AbortController();
  const onCancel = () => controller.abort();
  if (deps.signal?.aborted) controller.abort();
  else deps.signal?.addEventListener('abort', onCancel);

  let settled = false;
  const start = deps.now();
  const request = deps
    .fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: controller.signal })
    .then(() => deps.now() - start);
  const timeout = deps.sleep(PROBE_TIMEOUT_MS).then(() => {
    if (!settled) controller.abort();
    return null;
  });
  try {
    return await Promise.race([request, timeout]);
  } catch {
    return null;
  } finally {
    settled = true;
    deps.signal?.removeEventListener('abort', onCancel);
  }
}

function median(samples: number[]): number | null {
  if (samples.length < PROBE_MIN_SUCCESSES) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

/** Null when `signal` aborted before the last round finished. */
export async function probeRegions(
  targets: readonly ProbeTarget[],
  deps: ProbeDeps,
): Promise<RegionMedians | null> {
  const samples: Record<string, number[]> = {};
  for (const t of targets) samples[t.region] = [];

  // Round 0 is the warm-up (connection setup); its results are dropped.
  for (let round = 0; round <= PROBE_ROUNDS; round++) {
    if (deps.signal?.aborted) return null;
    if (round > 0) {
      await deps.sleep(PROBE_GAP_MS);
      if (deps.signal?.aborted) return null;
    }
    const results = await Promise.all(targets.map((t) => probeOnce(t.url, deps)));
    if (deps.signal?.aborted) return null;
    if (round > 0) {
      results.forEach((ms, i) => {
        if (ms !== null) samples[targets[i].region].push(ms);
      });
    }
  }

  const medians: Record<string, number | null> = {};
  for (const t of targets) medians[t.region] = median(samples[t.region]);
  return medians;
}
