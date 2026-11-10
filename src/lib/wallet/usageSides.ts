/**
 * The two 30-day figures the account panel shows, and the running time they
 * imply.
 *
 * `GET /api/wallet/usage-summary` answers with the caller's own wallet and —
 * for a member — their own charges on the organization's wallet. Both sides
 * arrive in ONE request, which is why this lives here rather than on the
 * polled `/wallet/status` payload: status is fetched every 60 s during a
 * session for the balance alone, and two more aggregates there would be paid
 * by every one of those polls for numbers only an opened panel draws.
 *
 * Nothing here throws into a render: a failed fetch resolves to `null`, and a
 * side with no spend or no duration has no runway rather than an invented one.
 */

/** One side's totals, in the units the server sends. */
export interface UsageSide {
    spendMicroUsd: number;
    /** Sum over sessions of each session's longest stream — audio time, not wall time. */
    sessionSeconds: number;
    sessionCount: number;
}

/** Both sides of one answer; either may be absent, and absent is not zero. */
export interface UsageSides {
    /** The caller's own wallet. Absent when the server did not send it (an older server, or a failed read). */
    personal?: UsageSide;
    /** The caller's own charges on their organization's wallet. Absent for a non-member, an older server, or a failed read. */
    organization?: UsageSide;
}

/** How long a cached answer is reused. The panel is opened far more often than the figures change. */
/** How long an answer is reused: the panel is opened far more often than the figures change. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Keyed by user, organization and the LOCAL date: the window is calendar days
 * in the viewer's timezone, so an answer fetched yesterday evening is not the
 * answer for today's first bar.
 */
const cache = new Map<string, { at: number; sides: UsageSides }>();

/**
 * How many requests have been issued per cache key. A response is only stored
 * when no LATER request for the same key has been issued, so an automatic read
 * that was overtaken by the panel's Refresh cannot put the older figures back
 * into the cache for the next five minutes.
 */
const issued = new Map<string, number>();

/** The local calendar date as `y-m-d`: the window is a run of days where the viewer is, not where UTC is. */
function localDay(now: number): string {
    const d = new Date(now);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * The cache key for one identity on one local day. The window is calendar days
 * in the viewer's zone, so an answer fetched yesterday evening is not the answer
 * for today's first bar.
 */
export function usageCacheKey(userId: string, organizationId: string | undefined, now: number): string {
    return `${userId}|${organizationId ?? ''}|${localDay(now)}`;
}

/** Drop every cached answer — for sign-out, and for tests. */
export function clearUsageSidesCache(): void {
    cache.clear();
}

/**
 * One side's block, or `undefined` when it is missing or does not carry all
 * three figures. Never a zero: a shape we did not recognise says nothing about
 * what was spent.
 */
function numbers(v: unknown): UsageSide | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const b = v as Record<string, unknown>;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
    const spend = num(b.spendMicroUsd);
    const seconds = num(b.sessionSeconds);
    const count = num(b.sessionCount);
    // A block with no numbers is the same as no block: never turn a shape we do
    // not recognise into a zero spend, which would read as "you used nothing".
    if (spend === undefined || seconds === undefined || count === undefined) return undefined;
    return {
        spendMicroUsd: Math.max(0, spend),
        sessionSeconds: Math.max(0, seconds),
        sessionCount: Math.max(0, count),
    };
}

/** Parse the payload's two optional blocks, tolerating a server that predates them. */
export function parseUsageSides(raw: unknown): UsageSides {
    const body = (raw ?? {}) as Record<string, unknown>;
    const personal = numbers(body.personal);
    const organization = numbers(body.organization);
    return { ...(personal ? { personal } : {}), ...(organization ? { organization } : {}) };
}

/**
 * Fetch both sides, through a cache. `force` is the panel's own refresh
 * button: it must actually ask again, or the number the user is trying to fix
 * would stay the same for five minutes.
 *
 * Resolves `null` on any failure. The panel then shows the balances it already
 * has and omits the usage lines, which is strictly better than an error row in
 * a popover opened to read a balance.
 */
export async function fetchUsageSides(opts: {
    apiUrl: string;
    token: string;
    userId: string;
    organizationId?: string;
    now?: number;
    force?: boolean;
    tzOffsetMinutes?: number;
}): Promise<UsageSides | null> {
    const now = opts.now ?? Date.now();
    const key = usageCacheKey(opts.userId, opts.organizationId, now);
    const hit = cache.get(key);
    if (!opts.force && hit && now - hit.at < CACHE_TTL_MS) return hit.sides;

    // Claim the newest slot for this key before asking.
    const mine = (issued.get(key) ?? 0) + 1;
    issued.set(key, mine);

    const tz = opts.tzOffsetMinutes;
    const query = tz === undefined ? '' : `?tzOffsetMinutes=${tz}`;
    try {
        const res = await fetch(`${opts.apiUrl}/wallet/usage-summary${query}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}` },
        });
        if (!res.ok) return null;
        const sides = parseUsageSides(await res.json());
        // Superseded by a later request for the same key: answer this caller, but
        // do not let its older figures win the cache.
        if (issued.get(key) === mine) cache.set(key, { at: now, sides });
        return sides;
    } catch {
        return null;
    }
}

/**
 * Hours the available balance lasts at this side's average spend, or null when
 * there is nothing to divide by.
 *
 * The average's denominator is AUDIO time (each session's longest stream), not
 * wall time, so a session with pauses burns the estimate slower than reality —
 * the figure is deliberately conservative, which is why every string that
 * shows it says "about".
 */
export function estimateRunwayHours(availableMicroUsd: number, side: UsageSide | undefined): number | null {
    if (!side || side.spendMicroUsd <= 0 || side.sessionSeconds <= 0) return null;
    if (!Number.isFinite(availableMicroUsd) || availableMicroUsd < 0) return null;
    const perHour = (side.spendMicroUsd / side.sessionSeconds) * 3600;
    if (!Number.isFinite(perHour) || perHour <= 0) return null;
    return availableMicroUsd / perHour;
}

/** The unit a runway is spoken in: hours under two days, days under a month, months beyond. */
export function runwayUnit(hours: number): 'hour' | 'day' | 'month' {
    if (hours < 48) return 'hour';
    if (hours < 24 * 30) return 'day';
    return 'month';
}

/** The runway's rounded magnitude in its own unit, never below 1 (a sub-hour figure reads as "none left"). */
export function runwayAmount(hours: number): number {
    const unit = runwayUnit(hours);
    const divisor = unit === 'hour' ? 1 : unit === 'day' ? 24 : 24 * 30;
    return Math.max(1, Math.round(hours / divisor));
}
