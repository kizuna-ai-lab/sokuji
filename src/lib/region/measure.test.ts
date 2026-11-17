import { describe, it, expect, vi, afterEach } from 'vitest';
import { measureRegionFamily, setRegionMeasure } from './measure';

describe('measureRegionFamily', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setRegionMeasure(null);
  });

  it('the real measurement sends HEAD to every region of the family', async () => {
    setRegionMeasure(null);
    const fetchMock = vi.fn(async () => new Response(null));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const run = measureRegionFamily('soniox');
    await vi.runAllTimersAsync();
    const medians = await run;
    expect(medians).not.toBeNull();
    expect(Object.keys(medians!).sort()).toEqual(['eu', 'in', 'jp', 'us']);
    // 1 warm-up + 3 rounds for each of the 4 regions.
    expect(fetchMock).toHaveBeenCalledTimes(4 * 4);
    expect(fetchMock.mock.calls.every((c) => (c as unknown as [string, RequestInit])[1].method === 'HEAD')).toBe(true);
    const urls = new Set(fetchMock.mock.calls.map((c) => (c as unknown as [string])[0]));
    expect(urls.has('https://tts-rt.in.soniox.com/')).toBe(true);
  });

  it('uses the injected measurement, and null restores the real probe', async () => {
    setRegionMeasure(async () => ({ us: 1 }));
    expect(await measureRegionFamily('soniox')).toEqual({ us: 1 });
    setRegionMeasure(null);
    const fetchMock = vi.fn(async () => new Response(null));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const run = measureRegionFamily('qwen');
    await vi.runAllTimersAsync();
    await run;
    expect(fetchMock).toHaveBeenCalled();
  });

  it('rejects, rather than throws, when the injected measurement throws synchronously', async () => {
    setRegionMeasure(() => { throw new Error('sync'); });
    let promise: Promise<unknown> | undefined;
    expect(() => { promise = measureRegionFamily('soniox'); }).not.toThrow();
    await expect(promise).rejects.toThrow('sync');
  });

  describe('says in the console which errors come from the latency test', () => {
    const SONIOX = ['https://tts-rt.soniox.com/', 'https://tts-rt.eu.soniox.com/', 'https://tts-rt.jp.soniox.com/', 'https://tts-rt.in.soniox.com/'];

    /** console.info lines and requests, in the order they happened. */
    function recordOrder(fetchImpl: (url: string) => Promise<Response>) {
      const events: string[] = [];
      vi.spyOn(console, 'info').mockImplementation((line: unknown) => { events.push(`info ${String(line)}`); });
      vi.stubGlobal('fetch', vi.fn(async (url: string) => { events.push(`fetch ${url}`); return fetchImpl(url); }));
      return events;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('a line before the first request names the addresses and the errors to expect, and a line after the last gives the results', async () => {
      const events = recordOrder(async (url) => {
        if (url === 'https://tts-rt.jp.soniox.com/') throw new TypeError('Failed to fetch');
        return new Response(null, { status: 404 });
      });
      setRegionMeasure(null);
      vi.useFakeTimers();
      const run = measureRegionFamily('soniox');
      await vi.runAllTimersAsync();
      await run;

      const lines = events.filter((e) => e.startsWith('info '));
      expect(lines).toHaveLength(2);
      expect(events[0]).toBe(lines[0]);
      expect(events[events.length - 1]).toBe(lines[1]);
      expect(lines[0]).toContain('Soniox latency test: start');
      for (const url of SONIOX) expect(lines[0]).toContain(url);
      expect(lines[0]).toContain('404 (Not Found)');
      expect(lines[0]).toContain('net::ERR_ABORTED');
      expect(lines[1]).toContain('Soniox latency test: end');
      expect(lines[1]).toMatch(/us \d+ ms, eu \d+ ms, jp no answer, in \d+ ms/);
      expect(lines[1]).toContain('came from this test');
    });

    it('still closes with a line when the measurement is cancelled', async () => {
      const events = recordOrder(() => new Promise<Response>(() => {}));
      setRegionMeasure(null);
      vi.useFakeTimers();
      const cancel = new AbortController();
      const run = measureRegionFamily('qwen', cancel.signal);
      await vi.advanceTimersByTimeAsync(100);
      cancel.abort();
      await vi.runAllTimersAsync();
      await expect(run).resolves.toBeNull();
      const lines = events.filter((e) => e.startsWith('info '));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('Qwen latency test: start');
      expect(lines[1]).toContain('Qwen latency test: end');
      expect(lines[1]).toContain('cancelled');
      expect(events[events.length - 1]).toBe(lines[1]);
    });

    it('prints nothing for a measurement a test swapped in', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      setRegionMeasure(async () => ({ us: 1 }));
      await measureRegionFamily('soniox');
      expect(info).not.toHaveBeenCalled();
    });
  });
});
