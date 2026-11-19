// Kizuna AI's terms for a file job, as the service publishes them: how long and how large a track may be, and its price.
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { getApiUrl } from '../../../utils/environment';
import {
  fetchHostedFileTerms, fitsHosted, hostedEstimateMicroUsd, hostedEstimateUsd, resetHostedFileTermsForTests, TERMS_TIMEOUT_MS, type HostedFileTerms,
} from './hostedFile';

const TERMS: HostedFileTerms = { usdPerHour: 0.2, translatedUsdPerHour: 0.32, maxAudioMs: 14_400_000, maxBytes: 100_663_296, maxBytesPerMs: 8, bytesSlack: 65_536 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('whether a recording fits the hosted limits', () => {
  it('takes a track exactly as long as the limit, and not a millisecond more', () => {
    expect(fitsHosted([{ durationMs: 14_400_000, bytes: 86_400_000 }], TERMS)).toBe(true);
    expect(fitsHosted([{ durationMs: 14_400_001, bytes: 86_400_000 }], TERMS)).toBe(false);
  });

  it('takes a track as large as the limit, and not a byte more', () => {
    expect(fitsHosted([{ durationMs: 14_400_000, bytes: 100_663_296 }], TERMS)).toBe(true);
    expect(fitsHosted([{ durationMs: 14_400_000, bytes: 100_663_297 }], TERMS)).toBe(false);
  });

  it('takes as many bytes as its length allows, and not a byte more', () => {
    expect(fitsHosted([{ durationMs: 1000, bytes: 1000 * 8 + 65_536 }], TERMS)).toBe(true);
    expect(fitsHosted([{ durationMs: 1000, bytes: 1000 * 8 + 65_536 + 1 }], TERMS)).toBe(false);
  });

  it('asks every track to fit', () => {
    expect(fitsHosted([{ durationMs: 60_000, bytes: 1000 }, { durationMs: 14_400_001, bytes: 1000 }], TERMS)).toBe(false);
    expect(fitsHosted([], TERMS)).toBe(true);
  });
});

describe('the estimated price', () => {
  it('is the length at the published rate, translated or not', () => {
    expect(hostedEstimateUsd([{ durationMs: 3_600_000, bytes: 1 }], false, TERMS)).toBe(0.2);
    expect(hostedEstimateUsd([{ durationMs: 3_600_000, bytes: 1 }], true, TERMS)).toBe(0.32);
  });

  it('adds the tracks up', () => {
    expect(hostedEstimateUsd([{ durationMs: 1_800_000, bytes: 1 }, { durationMs: 1_800_000, bytes: 1 }], false, TERMS)).toBe(0.2);
    expect(hostedEstimateUsd([{ durationMs: 3_600_000, bytes: 1 }, { durationMs: 900_000, bytes: 1 }], true, TERMS)).toBe(0.4);
    expect(hostedEstimateUsd([], true, TERMS)).toBe(0);
  });

  // In floating dollars, 1.5 h × $0.20 is 0.30000000000000004: rounded up, a wallet of exactly $0.30 would fall short.
  it('is counted in whole micro-USD, exactly, and rounded up', () => {
    expect(hostedEstimateMicroUsd([{ durationMs: 5_400_000, bytes: 1 }], false, TERMS)).toBe(300_000);
    expect(hostedEstimateMicroUsd([{ durationMs: 3 * 3_600_000, bytes: 1 }], false, TERMS)).toBe(600_000);
    expect(hostedEstimateMicroUsd([{ durationMs: 1, bytes: 1 }], false, TERMS)).toBe(1);
    expect(hostedEstimateUsd([{ durationMs: 5_400_000, bytes: 1 }], false, TERMS)).toBe(0.3);
  });

  it('prices each track translated or not, as each is sent', () => {
    const hourEach = [{ durationMs: 3_600_000, bytes: 1 }, { durationMs: 3_600_000, bytes: 1 }];
    expect(hostedEstimateMicroUsd(hourEach, [true, false], TERMS)).toBe(520_000);
    expect(hostedEstimateMicroUsd(hourEach, [false, true], TERMS)).toBe(520_000);
    expect(hostedEstimateUsd(hourEach, [true, true], TERMS)).toBe(0.64);
  });
});

describe('the terms from the service', () => {
  beforeEach(() => resetHostedFileTermsForTests());

  it('are read from the pricing table', async () => {
    const send = vi.fn(async () => json({ providers: [], fileTranscription: TERMS }));
    expect(await fetchHostedFileTerms(send)).toEqual(TERMS);
    expect(send).toHaveBeenCalledWith(`${getApiUrl()}/pricing`, expect.objectContaining({ method: 'GET' }));
  });

  it('are none from a service without them, or with a block it cannot use', async () => {
    expect(await fetchHostedFileTerms(vi.fn(async () => json({ providers: [] })))).toBeNull();
    expect(await fetchHostedFileTerms(vi.fn(async () => json({ fileTranscription: { ...TERMS, maxAudioMs: 'x' } })))).toBeNull();
  });

  // A limit of nothing would refuse every recording, and a negative rate is no price: such a block is no terms.
  it('are none when a limit is not above zero or a rate is negative', async () => {
    for (const over of [
      { maxAudioMs: 0 }, { maxAudioMs: -1 }, { maxBytes: 0 }, { maxBytes: -1 }, { usdPerHour: -0.2 }, { translatedUsdPerHour: -0.32 },
    ]) {
      expect(await fetchHostedFileTerms(vi.fn(async () => json({ fileTranscription: { ...TERMS, ...over } }))), JSON.stringify(over)).toBeNull();
    }
    // Free is a price.
    const free = { ...TERMS, usdPerHour: 0, translatedUsdPerHour: 0 };
    expect(await fetchHostedFileTerms(vi.fn(async () => json({ fileTranscription: free })))).toEqual(free);
  });

  it('cannot be read without an answer, or from a refusal', async () => {
    await expect(fetchHostedFileTerms(vi.fn(async () => { throw new TypeError('offline'); }))).rejects.toThrow();
    await expect(fetchHostedFileTerms(vi.fn(async () => json({}, 500)))).rejects.toThrow();
  });

  it('are asked once for two calls', async () => {
    const send = vi.fn(async () => json({ fileTranscription: TERMS }));
    const [first, second] = await Promise.all([fetchHostedFileTerms(send), fetchHostedFileTerms(send)]);
    expect(await fetchHostedFileTerms(send)).toEqual(TERMS);
    expect([first, second]).toEqual([TERMS, TERMS]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  // Offline now is not offline forever, and a service may gain the feature: neither answer is kept.
  it('are asked again after a failure or an answer without them', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json({ providers: [] }))
      .mockResolvedValueOnce(json({ fileTranscription: TERMS }));
    await expect(fetchHostedFileTerms(send)).rejects.toThrow();
    expect(await fetchHostedFileTerms(send)).toBeNull();
    expect(await fetchHostedFileTerms(send)).toEqual(TERMS);
    expect(send).toHaveBeenCalledTimes(3);
  });

  /** A request that answers only by failing once its signal aborts. */
  const hanging = () => vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
  }));

  // A service that does not answer: the panel says it could not be checked, rather than waiting for ever.
  it('give up after ten seconds without an answer, and are asked again next time', async () => {
    const timeout = new AbortController();
    const spy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    try {
      const send = hanging();
      const waiting = fetchHostedFileTerms(send);
      expect(spy).toHaveBeenCalledWith(TERMS_TIMEOUT_MS);
      expect(TERMS_TIMEOUT_MS).toBe(10_000);
      timeout.abort(new DOMException('The operation timed out.', 'TimeoutError'));
      await expect(waiting).rejects.toMatchObject({ name: 'TimeoutError' });
    } finally {
      spy.mockRestore();
    }
    const again = vi.fn(async () => json({ fileTranscription: TERMS }));
    expect(await fetchHostedFileTerms(again)).toEqual(TERMS);
    expect(again).toHaveBeenCalledTimes(1);
  });

  // A job's cancel ends its own wait; another caller still gets the answer the request brings.
  it('stop being waited for when the caller’s signal aborts', async () => {
    let answer!: (r: Response) => void;
    const send = vi.fn(() => new Promise<Response>((resolve) => { answer = resolve; }));
    const job = new AbortController();
    const cancelled = fetchHostedFileTerms(send, job.signal);
    const other = fetchHostedFileTerms(send);
    job.abort(new DOMException('The job was cancelled.', 'AbortError'));
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    answer(json({ fileTranscription: TERMS }));
    expect(await other).toEqual(TERMS);
    expect(send).toHaveBeenCalledTimes(1);
    // Already cancelled: nothing is asked.
    resetHostedFileTermsForTests();
    const unasked = vi.fn(async () => json({ fileTranscription: TERMS }));
    await expect(fetchHostedFileTerms(unasked, job.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(unasked).not.toHaveBeenCalled();
  });
});
