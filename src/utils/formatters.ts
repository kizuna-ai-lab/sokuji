/**
 * Utility functions for formatting data display
 */

/** Conversion anchor: 1 USD = 1,000,000 micro-USD. */
const MICRO_USD_PER_USD = 1_000_000;

/** A formatted magnitude carrying no value at all: "0.00", "0.000000". */
const ALL_ZEROS = /^0(?:\.0+)?$/;

/**
 * Decimal places for a NON-NEGATIVE USD magnitude, chosen by its size.
 *
 * WHY THE DECIMAL COUNT ADAPTS. A fixed 2 decimals is right for a balance and
 * catastrophic for a usage row. At the magnitudes this product actually bills
 * at, `toFixed(2)` does not round an amount — it deletes it. A measured
 * example: a 10.08-second Soniox stream with translation cost $0.000776 from
 * the provider, charged at `cost × K` (K = 2.0) = 1552 µUSD. Two decimals
 * render that as "$0.00", so the account panel's "30D" line read as zero for
 * every short session, and the balance beside it — $4.998448 after a $5
 * top-up — rounded straight back to "$5.00". Both numbers said no money had
 * moved when it had.
 *
 *   |x| >= $1      2 decimals   "$12.50"
 *   |x| >= $0.01   4 decimals   "$0.0265"
 *   otherwise      6 decimals   "$0.001552"   (the full µUSD atom, lossless)
 *
 * Exact zero is carved OUT of the table, which never really applied to it:
 * zero has no magnitude to select a bucket by, and "$0.000000" reads as a
 * precision artifact rather than as "nothing". That leaves 0 rendering "$0.00"
 * while 1 µUSD renders "$0.000001", which looks asymmetric but is the point:
 * one means no money moved, the other means a very small amount did.
 *
 * MIRRORED IN `sokuji-backend/src/services/money-format.ts` (the Worker) and
 * `sokuji-backend/web/src/lib/money-format.ts` (the dashboard). Those two and
 * this one are separate TypeScript projects built by different toolchains, so
 * none can import another and the rule exists three times; the case table in
 * `formatters.test.ts` restates the backend's so a change to one copy fails
 * the others. The backend copies emit "-$1.50" and render unusable input as an
 * em dash; this one keeps "$-1.50" and "$0.00" (see below). Only the precision
 * rule is shared.
 */
function usdDecimals(absUsd: number): 2 | 4 | 6 {
  if (absUsd === 0) return 2;
  if (absUsd >= 1) return 2;
  if (absUsd >= 0.01) return 4;
  return 6;
}

/**
 * µUSD per displayed unit at a given precision: 10,000 (a cent) at 2dp, 100 at
 * 4dp, 1 at 6dp. Exact, because both operands are powers of ten.
 */
function stepMicroUsd(decimals: 2 | 4 | 6): number {
  return 10 ** (6 - decimals);
}

/**
 * Assemble the final string from an amount ALREADY quantized onto the display
 * grid by `quantize`.
 *
 * The sign is applied to the FORMATTED magnitude, not the raw number, so an
 * amount too small to survive its own precision bucket cannot render as
 * "$-0.000000" — which reads as a rendering bug rather than as a balance a
 * fraction of a micro-USD overdrawn. A representable negative stays signed.
 */
function render(microUsd: number, decimals: 2 | 4 | 6): string {
  const magnitude = Math.abs(microUsd / MICRO_USD_PER_USD).toFixed(decimals);
  const sign = microUsd < 0 && !ALL_ZEROS.test(magnitude) ? '-' : '';
  return `$${sign}${magnitude}`;
}

/**
 * Snap an exact integer µUSD amount onto the display grid.
 *
 * BOTH ROUNDING MODES QUANTIZE IN INTEGER µUSD RATHER THAN IN FLOAT DOLLARS,
 * for the same reason: the grid points are exact there and are not in IEEE 754.
 *
 *   - `round`: dividing first and letting `toFixed` round decides ties on
 *     representation accident. 10,050 µUSD is exactly half a 4dp unit, but as a
 *     double it is 0.010049999999999999906, so `toFixed(4)` rounds it DOWN to
 *     "0.0100". That is not a rule — sweeping the 9,900 exact ties in the 4dp
 *     bucket splits 4,943 down and 4,957 up. Rounding `|micro| / step` instead
 *     resolves every tie away from zero, symmetrically for either sign.
 *   - `floor`: `4.95 * 100` is 494.99999999999994, so flooring in dollars would
 *     render an exact $4.95 balance as "$4.94".
 *
 * The magnitude is what gets quantized — the same magnitude `render` then
 * applies the sign to — so the two agree on which side of a tie an amount sits
 * regardless of sign.
 */
function quantize(microUsd: number, decimals: 2 | 4 | 6, mode: 'round' | 'floor'): number {
  const step = stepMicroUsd(decimals);
  if (mode === 'floor') return Math.floor(microUsd / step) * step;
  const magnitude = Math.round(Math.abs(microUsd) / step) * step;
  return microUsd < 0 ? -magnitude : magnitude;
}

/**
 * Format a micro-USD amount (1 USD = 1,000,000 micro-USD) as a display currency
 * string, rounded to nearest at a precision that adapts to its magnitude (see
 * `usdDecimals`).
 *
 * For a BALANCE use `formatUsdFloor` instead: rounding to nearest can render
 * more money than the wallet holds.
 *
 * The argument comes from `QuotaData`, which is built from an untyped JSON
 * payload, so null/undefined/NaN can reach here — callers pass things like
 * `quota.balance ?? 0` and `quota.balance || quota.remaining`, neither of which
 * stops a NaN. Anything non-finite renders "$0.00" rather than the literal
 * "$NaN" appearing in the balance UI.
 *
 * @param microUsd Amount in micro-USD
 * @returns Formatted string (e.g., "$3.42", "$0.001552")
 */
export function formatUsd(microUsd: number | null | undefined): string {
  if (typeof microUsd !== 'number' || !Number.isFinite(microUsd)) return '$0.00';
  const decimals = usdDecimals(Math.abs(microUsd / MICRO_USD_PER_USD));
  return render(quantize(microUsd, decimals, 'round'), decimals);
}

/**
 * Format a micro-USD amount as `formatUsd` does, but TRUNCATING toward negative
 * infinity instead of rounding to nearest.
 *
 * For a balance, rounding to nearest is not merely imprecise, it is wrong in a
 * specific direction: it can claim the wallet holds money it does not. Half a
 * cent of usage against a $5 balance leaves $4.995, which rounds back up to
 * "$5.00" — the display says the session was free. Truncation can only ever
 * understate, so what the user sees is money they are certain to have.
 *
 * A negative balance is reachable (charging is post-paid, so a session can
 * overrun the balance) and truncating toward negative infinity moves a debt
 * away from zero — the same conservative direction: never show less debt than
 * is owed.
 *
 * Like `formatUsd`, it quantizes in integer µUSD rather than float dollars —
 * see `quantize` for why each mode needs that.
 *
 * @param microUsd Amount in micro-USD
 * @returns Formatted string (e.g., "$4.99" for a balance of $4.998448)
 */
export function formatUsdFloor(microUsd: number | null | undefined): string {
  if (typeof microUsd !== 'number' || !Number.isFinite(microUsd)) return '$0.00';
  // Bucket chosen from the RAW magnitude, exactly as `formatUsd` does, so the
  // two agree on precision and differ only in direction.
  const decimals = usdDecimals(Math.abs(microUsd / MICRO_USD_PER_USD));
  return render(quantize(microUsd, decimals, 'floor'), decimals);
}

/**
 * Calculate usage percentage
 * @param used Amount used
 * @param total Total quota
 * @returns Percentage (0-100)
 */
export function formatPercentage(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

/**
 * Format date for display (e.g., "Feb 1", "Dec 31")
 * @param dateString ISO date string
 * @returns Formatted date string
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric' 
  });
}

/**
 * Determine quota warning level based on usage percentage
 * @param used Amount used
 * @param total Total quota
 * @returns Warning level: 'normal' | 'warning' | 'critical'
 */
export function getQuotaWarningLevel(used: number, total: number): 'normal' | 'warning' | 'critical' {
  const percentage = formatPercentage(used, total);
  if (percentage >= 95) return 'critical';
  if (percentage >= 80) return 'warning';
  return 'normal';
}

/**
 * Format a millisecond duration as a countdown clock: `mm:ss`, or `h:mm:ss`
 * once it reaches an hour. Matches the format MainPanel's session-duration
 * stopwatch already uses, so a managed-session remaining-time countdown
 * reads consistently with it.
 *
 * @param ms Duration in milliseconds. Negative/non-finite input renders as
 *           "00:00" rather than a garbled or negative clock.
 */
export function formatRemainingTime(ms: number): string {
  const totalSeconds = typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}