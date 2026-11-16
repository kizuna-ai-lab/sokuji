// The notes' estimated prices per hour, as the backend publishes them.
import { describe, it, expect, vi } from 'vitest';
import { getApiUrl } from '../../utils/environment';
import { fetchNotesPricing, liveCostUsd, perHour } from './notesPricing';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('the notes pricing', () => {
  it('reads the live and after-session estimates from the pricing table', async () => {
    const fetch = vi.fn(async () => json({ pricesReadOn: '2026-11-16', providers: [], notes: { model: 'gpt-6-luna', inputPerMTok: 0.2, cachedInputPerMTok: 0.02, outputPerMTok: 1, liveUsdPerHour: 0.04, afterSessionUsdPerHour: 0.012 } }));
    expect(await fetchNotesPricing(fetch)).toEqual({ inputPerMTok: 0.2, cachedInputPerMTok: 0.02, outputPerMTok: 1, liveUsdPerHour: 0.04, afterSessionUsdPerHour: 0.012 });
    expect(fetch).toHaveBeenCalledWith(`${getApiUrl()}/pricing`, expect.anything());
  });

  it('is null from a backend without notes, a refusal, or no answer', async () => {
    expect(await fetchNotesPricing(vi.fn(async () => json({ providers: [] })))).toBeNull();
    expect(await fetchNotesPricing(vi.fn(async () => json({ notes: { liveUsdPerHour: 'x', afterSessionUsdPerHour: 1 } })))).toBeNull();
    expect(await fetchNotesPricing(vi.fn(async () => json({}, 500)))).toBeNull();
    expect(await fetchNotesPricing(vi.fn(async () => { throw new TypeError('offline'); }))).toBeNull();
  });

  it('costs what was used at the published rates: uncached input, cached input and output apart', () => {
    const rates = { inputPerMTok: 0.2, cachedInputPerMTok: 0.02, outputPerMTok: 1, liveUsdPerHour: 0.04, afterSessionUsdPerHour: 0.012 };
    // (9000 − 8000) × 0.2 + 8000 × 0.02 + 300 × 1, per million tokens.
    expect(liveCostUsd({ input: 9000, cached: 8000, output: 300 }, rates)).toBeCloseTo((1000 * 0.2 + 8000 * 0.02 + 300 * 1) / 1e6, 12);
    expect(liveCostUsd({ input: 0, cached: 0, output: 0 }, rates)).toBe(0);
  });

  it('writes a price per hour in dollars, to the cent or to the tenth of a cent below ten cents', () => {
    expect(perHour(0.04)).toBe('$0.04');
    expect(perHour(0.012)).toBe('$0.012');
    expect(perHour(0.4)).toBe('$0.40');
    expect(perHour(1.234)).toBe('$1.23');
  });
});
