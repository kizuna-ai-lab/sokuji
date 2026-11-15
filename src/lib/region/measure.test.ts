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
    expect(fetchMock).toHaveBeenCalledTimes(4 * 6);
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
});
