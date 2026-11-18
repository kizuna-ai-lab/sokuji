// Kizuna AI's terms for a file job, as the service publishes them: how long and how large a track may be, and its price.
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { getApiUrl } from '../../../utils/environment';
import { fetchHostedFileTerms, fitsHosted, hostedEstimateUsd, resetHostedFileTermsForTests, type HostedFileTerms } from './hostedFile';

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
    expect(hostedEstimateUsd([{ durationMs: 3_600_000, bytes: 1 }, { durationMs: 900_000, bytes: 1 }], true, TERMS)).toBeCloseTo(0.4, 12);
    expect(hostedEstimateUsd([], true, TERMS)).toBe(0);
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

  it('cannot be had without an answer, or from a refusal', async () => {
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
});
