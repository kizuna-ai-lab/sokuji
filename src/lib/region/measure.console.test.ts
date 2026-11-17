// A region latency test does not flood the console, and its results still come out.
// What Chromium itself prints for each 404 / aborted request is outside the app's reach (see measure.ts) and needs a
// real browser to observe; here: what the app writes, how many requests one test sends, and that the results arrive.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { measureRegionFamily, setRegionMeasure } from './measure';
import { useRegionLatencyStore } from '../../stores/regionLatencyStore';

/** Every probe host answers 404 at its root; one region cannot be reached at all. */
const answers = vi.fn(async (url: string) => {
  if (url.includes('.jp.')) throw new TypeError('Failed to fetch');
  return new Response(null, { status: 404 });
});

function spyConsole() {
  return {
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  answers.mockClear();
  setRegionMeasure(null);
  useRegionLatencyStore.setState({ families: {} });
});

describe('the region latency test does not flood the console', () => {
  it('the app writes no error, warning or log line of its own for the 404s and failures, only the two info lines', async () => {
    const console_ = spyConsole();
    vi.stubGlobal('fetch', answers);
    setRegionMeasure(null);
    vi.useFakeTimers();
    const run = measureRegionFamily('soniox');
    await vi.runAllTimersAsync();
    await run;
    expect(answers).toHaveBeenCalledTimes(16);
    expect(console_.error).not.toHaveBeenCalled();
    expect(console_.warn).not.toHaveBeenCalled();
    expect(console_.log).not.toHaveBeenCalled();
    expect(console_.debug).not.toHaveBeenCalled();
    expect(console_.info).toHaveBeenCalledTimes(2);
  });

  it('opening the region list again and again runs one test, not one per opening', async () => {
    spyConsole();
    vi.stubGlobal('fetch', answers);
    setRegionMeasure(null);
    vi.useFakeTimers();
    const { ensureFresh } = useRegionLatencyStore.getState();
    for (let i = 0; i < 5; i++) ensureFresh('soniox');
    await vi.runAllTimersAsync();
    for (let i = 0; i < 5; i++) ensureFresh('soniox');
    await vi.runAllTimersAsync();
    // One test of the 4 Soniox regions: a warm-up and 3 rounds.
    expect(answers).toHaveBeenCalledTimes(16);
  });

  it('the results still come out: a 404 answer is timed, an unreachable region reads unreachable', async () => {
    spyConsole();
    vi.stubGlobal('fetch', answers);
    setRegionMeasure(null);
    vi.useFakeTimers();
    useRegionLatencyStore.getState().ensureFresh('soniox');
    await vi.runAllTimersAsync();
    const soniox = useRegionLatencyStore.getState().families.soniox;
    expect(soniox?.measuring).toBe(false);
    expect(soniox?.medians).toEqual({ us: expect.any(Number), eu: expect.any(Number), jp: 'unreachable', in: expect.any(Number) });
  });
});
