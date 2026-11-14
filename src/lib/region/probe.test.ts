import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probeRegions, type ProbeDeps } from './probe';

/** Per URL, per call index (0 = warm-up): ms until answered; null = never answers. */
type Script = Record<string, Array<number | null>>;

function makeDeps(script: Script, extra: Partial<ProbeDeps> = {}) {
  const calls: Record<string, number> = {};
  const signals: Array<{ url: string; signal: AbortSignal }> = [];
  const fetch = vi.fn((url: string, init: RequestInit) => {
    const index = (calls[url] = (calls[url] ?? -1) + 1);
    const delay = script[url]?.[index];
    const signal = init.signal as AbortSignal;
    signals.push({ url, signal });
    return new Promise<unknown>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
      if (delay !== null && delay !== undefined) setTimeout(() => resolve({}), delay);
    });
  });
  const deps: ProbeDeps = {
    fetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    ...extra,
  };
  return { deps, fetch, signals };
}

const US = { region: 'us', url: 'https://us.example/' };
const JP = { region: 'jp', url: 'https://jp.example/' };
const EU = { region: 'eu', url: 'https://eu.example/' };

describe('probeRegions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends HEAD, no-cors, no-store, no credentials — 1 warm-up + 5 rounds per region', async () => {
    const { deps, fetch } = makeDeps({});
    const run = probeRegions([US, JP], deps);
    await vi.advanceTimersByTimeAsync(60_000);
    await run;
    expect(fetch.mock.calls[0][1]).toEqual({
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: expect.any(AbortSignal),
    });
    for (const call of fetch.mock.calls) expect(call[1]).toMatchObject({ method: 'HEAD' });
    expect(fetch).toHaveBeenCalledTimes(12);
  });

  it('discards the warm-up: a 900 ms first request does not reach the median', async () => {
    const { deps } = makeDeps({
      [US.url]: [900, 170, 180, 175, 160, 190],
      [JP.url]: [800, 12, 14, 13, 11, 15],
    });
    const run = probeRegions([US, JP], deps);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(run).resolves.toEqual({ us: 175, jp: 13 });
  });

  it('issues one request per region per round, in parallel', async () => {
    const { deps, fetch } = makeDeps({});
    void probeRegions([US, JP], deps);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((c) => c[0]).sort()).toEqual([JP.url, US.url]);
  });

  it('spaces rounds 200 ms apart and does not wait after the last', async () => {
    const { deps, fetch } = makeDeps({ [US.url]: [0, 0, 0, 0, 0, 0] });
    const run = probeRegions([US], deps);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(199);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(805);
    expect(fetch).toHaveBeenCalledTimes(6);
    // answered at once: the result lands without waiting a trailing gap
    await expect(run).resolves.toEqual({ us: expect.any(Number) });
  });

  it('a request still pending at 3000 ms fails and is aborted; fewer than 3 successes is unmeasured', async () => {
    const { deps, signals } = makeDeps({
      [EU.url]: [10, null, null, null, 20, 30],
    });
    const run = probeRegions([EU], deps);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(run).resolves.toEqual({ eu: null });
    const hung = signals.slice(1, 4);
    expect(hung).toHaveLength(3);
    for (const s of hung) expect(s.signal.aborted).toBe(true);
  });

  it('a request that answers in time is never aborted afterwards', async () => {
    const { deps, signals } = makeDeps({ [US.url]: [10, 10, 10, 10, 10, 10] });
    const run = probeRegions([US], deps);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(run).resolves.toEqual({ us: 10 });
    for (const s of signals) expect(s.signal.aborted).toBe(false);
  });

  it('a rejection counts as a failure for that region only', async () => {
    const { deps } = makeDeps({
      [US.url]: [5, 10, 10, 10, 10, 10],
    });
    const fetch = vi.fn((url: string, init: RequestInit) =>
      url === JP.url ? Promise.reject(new Error('net')) : deps.fetch(url, init));
    const run = probeRegions([US, JP], { ...deps, fetch });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(run).resolves.toEqual({ us: 10, jp: null });
  });

  it('takes the median of 4 successes as the mean of the middle two, rounded', async () => {
    const { deps } = makeDeps({ [US.url]: [5, 10, 20, 31, 40, null] });
    const run = probeRegions([US], deps);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(run).resolves.toEqual({ us: 26 });
  });

  it('answers null when its signal aborts mid-measurement, aborting in-flight requests', async () => {
    const controller = new AbortController();
    const { deps, signals } = makeDeps(
      { [US.url]: [10, 10, 10, null, 10, 10] },
      { signal: controller.signal },
    );
    const run = probeRegions([US], deps);
    await vi.advanceTimersByTimeAsync(700); // warm-up and rounds 1-2 done; round 3 is hung
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(run).resolves.toBeNull();
    expect(signals[3].signal.aborted).toBe(true);
  });

  it('answers null without requesting when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, fetch } = makeDeps({}, { signal: controller.signal });
    await expect(probeRegions([US], deps)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
