import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    clearUsageSidesCache,
    estimateRunwayHours,
    fetchUsageSides,
    parseUsageSides,
    runwayAmount,
    runwayUnit,
    usageCacheKey,
} from './usageSides';

const side = (spendMicroUsd: number, sessionSeconds: number, sessionCount = 1) =>
    ({ spendMicroUsd, sessionSeconds, sessionCount });


describe('parseUsageSides', () => {
    it('reads both blocks', () => {
        expect(parseUsageSides({
            spendMicroUsd: 999,
            personal: side(550, 360),
            organization: side(700, 240, 2),
        })).toEqual({ personal: side(550, 360), organization: side(700, 240, 2) });
    });

    it('an older server sends neither, and that is not a zero', () => {
        expect(parseUsageSides({ spendMicroUsd: 999 })).toEqual({});
    });

    it('a block with a missing number is dropped, never rounded down to zero spend', () => {
        // A zero spend would read as "you used nothing", which is a claim we
        // cannot make from a shape we did not recognise.
        expect(parseUsageSides({ personal: { spendMicroUsd: 5 } })).toEqual({});
        expect(parseUsageSides({ organization: { spendMicroUsd: 5, sessionSeconds: null, sessionCount: 1 } })).toEqual({});
    });

    it('clamps negatives and ignores junk at the top level', () => {
        expect(parseUsageSides(null)).toEqual({});
        expect(parseUsageSides({ personal: side(-5, -1, -2) })).toEqual({ personal: side(0, 0, 0) });
    });
});

describe('estimateRunwayHours', () => {
    it('divides the available balance by the mean spend per hour', () => {
        // 700 µUSD over 240 s is $0.0105/h; $14.99 lasts ~1427 h.
        const hours = estimateRunwayHours(14_990_000, side(700, 240))!;
        expect(hours).toBeCloseTo(14_990_000 / ((700 / 240) * 3600), 6);
    });

    it('has no answer without a rate, rather than inventing one', () => {
        expect(estimateRunwayHours(1_000_000, undefined)).toBeNull();
        expect(estimateRunwayHours(1_000_000, side(0, 600))).toBeNull();
        expect(estimateRunwayHours(1_000_000, side(500, 0))).toBeNull();
        expect(estimateRunwayHours(1_000_000, side(500, -30))).toBeNull();
    });

    it('floors an overdrawn balance at zero hours', () => {
        expect(estimateRunwayHours(-5, side(500, 600))).toBeNull();
        expect(estimateRunwayHours(0, side(500, 600))).toBe(0);
    });
});

describe('runwayUnit and runwayAmount', () => {
    it('speaks hours under two days, days under a month, months beyond', () => {
        expect(runwayUnit(1)).toBe('hour');
        expect(runwayUnit(47.9)).toBe('hour');
        expect(runwayUnit(48)).toBe('day');
        expect(runwayUnit(24 * 30 - 1)).toBe('day');
        expect(runwayUnit(24 * 30)).toBe('month');
    });

    it('rounds inside its unit and never says "0 hours left"', () => {
        expect(runwayAmount(27.4)).toBe(27);
        expect(runwayAmount(0.2)).toBe(1);
        expect(runwayAmount(50)).toBe(2); // days
        expect(runwayAmount(24 * 45)).toBe(2); // months
    });
});

describe('fetchUsageSides', () => {
    const ok = (body: unknown) => ({ ok: true, json: async () => body });
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        clearUsageSidesCache();
        fetchMock = vi.fn(async () => ok({ personal: side(550, 360), organization: side(700, 240) }));
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    const call = (over: Partial<Parameters<typeof fetchUsageSides>[0]> = {}) => fetchUsageSides({
        apiUrl: 'https://api.test', token: 't', userId: 'u1', organizationId: 'o1', now: 1_000_000, ...over,
    });

    it('asks once for both sides and reuses the answer inside the window', async () => {
        await call();
        const again = await call({ now: 1_000_000 + 60_000 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(again).toEqual({ personal: side(550, 360), organization: side(700, 240) });
    });

    it('asks again after the window, on demand, or for a different day', async () => {
        await call();
        await call({ now: 1_000_000 + 5 * 60_000 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        await call({ now: 1_000_000 + 5 * 60_000, force: true });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        await call({ now: 1_000_000 + 24 * 60 * 60_000 });
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('keys the cache by user and organization, so a second member asks for their own', async () => {
        await call();
        await call({ organizationId: 'o2' });
        await call({ userId: 'u2' });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(usageCacheKey('u1', 'o1', 1_000_000)).not.toBe(usageCacheKey('u1', 'o2', 1_000_000));
    });

    it('resolves null on a failed request and caches nothing', async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
        expect(await call()).toBeNull();
        await call();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not let a superseded response replace the newer figures in the cache', async () => {
        let releaseFirst: (v: unknown) => void = () => {};
        const first = new Promise((resolve) => { releaseFirst = resolve as (v: unknown) => void; });
        const ok = (body: unknown) => ({ ok: true, json: async () => body });
        fetchMock
            .mockImplementationOnce(async () => ok(await first))
            .mockImplementationOnce(async () => ok({ personal: side(900, 600) }));

        // The automatic read goes out first, the user's Refresh second.
        const slow = call({ force: true });
        const fast = await call({ force: true });
        expect(fast).toEqual({ personal: side(900, 600) });
        // Now the older request lands, carrying the older figures.
        releaseFirst({ personal: side(100, 600) });
        await slow;

        // What the panel asks for next must be the newer figures: still inside the
        // five-minute window, so this reads the cache rather than asking again.
        const next = await call({ now: 1_000_000 });
        expect(next).toEqual({ personal: side(900, 600) });
    });

    it('passes the viewer offset so the window is their calendar, not UTC', async () => {
        await call({ tzOffsetMinutes: 540 });
        expect(String(fetchMock.mock.calls[0][0])).toContain('tzOffsetMinutes=540');
    });
});
