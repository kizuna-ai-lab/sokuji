import { describe, it, expect } from 'vitest';
import { formatUsd, formatUsdFloor, formatRemainingTime } from './formatters';

/**
 * MIRROR OF the backend's adaptive-precision case table
 * (`sokuji-backend/src/services/money-format.ts` and its browser twin
 * `sokuji-backend/web/src/lib/money-format.ts`). sokuji-react, the Worker and
 * the dashboard are three separate TypeScript projects that cannot import each
 * other, so the rule necessarily exists three times; restating the SAME
 * micro-USD inputs and decimal counts here means a change to one copy surfaces
 * as a failure on the others.
 *
 * Two conventions deliberately differ on this side and are pinned below:
 *   - the minus sits INSIDE the currency symbol ("$-1.50"), where the backend
 *     emits "-$1.50";
 *   - unusable input renders "$0.00", where the dashboard renders an em dash.
 * Both predate the shared precision rule, so only the precision rule is
 * mirrored, not the whole formatter.
 */
describe('formatUsd', () => {
  // Dollar-magnitude amounts - balances and top-ups - keep the familiar 2dp.
  it('formats amounts >= $1 to 2 decimals', () => {
    expect(formatUsd(3_420_000)).toBe('$3.42');
    expect(formatUsd(12_500_000)).toBe('$12.50');
    expect(formatUsd(1_000_000)).toBe('$1.00');
    expect(formatUsd(1_500_000)).toBe('$1.50');
  });

  // Cent-magnitude amounts get 4dp: 2dp already discards most of the value.
  it('formats amounts >= $0.01 to 4 decimals', () => {
    expect(formatUsd(26_499)).toBe('$0.0265');
    expect(formatUsd(10_000)).toBe('$0.0100');
  });

  // Below a cent, render the full micro-USD precision: nothing is lost,
  // because micro-USD IS the stored atom.
  it('formats amounts under $0.01 to 6 decimals, losing nothing', () => {
    // The measured case that motivated the whole rule: a 10.08s Soniox stream
    // with translation cost $0.000776, charged at K=2.0 -> 1552 micro-USD. At a
    // fixed 2dp the 30-day usage line read "$0.00" for every short session.
    expect(formatUsd(1_552)).toBe('$0.001552');
    expect(formatUsd(9_999)).toBe('$0.009999');
    expect(formatUsd(1)).toBe('$0.000001');
  });

  // Zero is carved OUT of the magnitude table, which never really applied to
  // it: zero has no magnitude to select a bucket by. An empty balance reads as
  // "$0.00"; "$0.000000" would read as a precision artifact rather than as
  // "nothing".
  it('renders an exact zero at 2 decimals, outside the magnitude table', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  // The asymmetry with the case above is deliberate: "$0.00" means no money
  // moved, "$0.000000" means a very small amount did, and those must not look
  // alike.
  it('distinguishes a sub-micro-USD amount from an exact zero', () => {
    expect(formatUsd(0.4)).toBe('$0.000000');
    expect(formatUsd(0.4)).not.toBe(formatUsd(0));
  });

  // Rounding happens within the bucket the RAW magnitude selected, so a value
  // just under a bucket edge can round up to it. Pinned so the behaviour is
  // deliberate rather than incidental - and so the contrast with
  // `formatUsdFloor`, which cannot round up, stays visible.
  it('rounds within the bucket its magnitude selected', () => {
    expect(formatUsd(999_999)).toBe('$1.0000');
    expect(formatUsd(9_999_999)).toBe('$10.00');
  });

  // Rounding happens on the exact integer micro-USD, NOT on the float dollars,
  // so an amount sitting exactly half a display unit from its neighbours lands
  // by rule instead of by IEEE 754 accident. 10,050 µUSD is
  // 0.010049999999999999906 as a double, so `(m / 1e6).toFixed(4)` rounds it
  // DOWN to "$0.0100"; 1,005,000 µUSD does the same at 2dp. Neither direction
  // was a decision: a sweep of the 4dp bucket's 9,900 exact ties splits 4,943
  // down and 4,957 up purely on how each value happens to be representable.
  it('resolves an exact tie by rule rather than by float representation', () => {
    expect(formatUsd(10_050)).toBe('$0.0101');
    expect(formatUsd(1_005_000)).toBe('$1.01');
  });

  // Ties resolve away from zero on both sides, because the magnitude is what
  // gets rounded - the same magnitude the sign is then applied to.
  it('resolves ties symmetrically for negative amounts', () => {
    expect(formatUsd(-10_050)).toBe('$-0.0101');
    expect(formatUsd(-1_005_000)).toBe('$-1.01');
  });

  it('keeps negative amounts signed at every precision bucket', () => {
    expect(formatUsd(-1_500_000)).toBe('$-1.50');
    expect(formatUsd(-26_499)).toBe('$-0.0265');
    expect(formatUsd(-1_552)).toBe('$-0.001552');
  });

  // A negative magnitude too small to survive its own bucket would render
  // "$-0.000000", which reads as a rendering bug rather than as a balance a
  // fraction of a micro-USD overdrawn.
  it('drops the sign when the magnitude rounds away entirely', () => {
    expect(formatUsd(-0.4)).toBe('$0.000000');
    expect(formatUsd(-0)).toBe('$0.00');
  });

  // QuotaData is built from an untyped JSON payload, and the call sites
  // (`quota.balance ?? 0`, `quota.balance || quota.remaining`) do not stop a
  // NaN - without the guard the balance UI rendered the literal "$NaN".
  it('renders non-finite input as $0.00 rather than $NaN', () => {
    expect(formatUsd(NaN)).toBe('$0.00');
    expect(formatUsd(Infinity)).toBe('$0.00');
    expect(formatUsd(-Infinity)).toBe('$0.00');
  });

  it('renders null / undefined as $0.00', () => {
    expect(formatUsd(null)).toBe('$0.00');
    expect(formatUsd(undefined)).toBe('$0.00');
  });

  it('rejects a non-number that would coerce (a string balance from bad JSON)', () => {
    expect(formatUsd('3420000' as unknown as number)).toBe('$0.00');
  });
});

/**
 * `formatUsdFloor` picks its precision bucket exactly as `formatUsd` does, then
 * truncates toward negative infinity instead of rounding to nearest. It exists
 * for the ONE quantity where rounding to nearest is actively misleading: a
 * balance, which must never be displayed as more money than the wallet holds.
 */
describe('formatUsdFloor', () => {
  // The reported symptom, exactly. Top up $5, run one short session charged
  // 1552 micro-USD, and the true balance is $4.998448. `toFixed(2)` renders
  // that as "$5.00" - so the balance appeared frozen at the top-up amount and
  // the session looked free. Truncation shows the money moved.
  it('never renders a balance as more money than the wallet holds', () => {
    expect(formatUsdFloor(5_000_000 - 1_552)).toBe('$4.99');
    expect(formatUsd(5_000_000 - 1_552)).toBe('$5.00');
  });

  // Truncation must not shave a cent off an amount that already sits exactly on
  // the grid. Done in float dollars this fails: 4.95 * 100 is 494.99999999999994
  // in IEEE 754, so `Math.floor` would render "$4.94". The floor therefore
  // happens in integer micro-USD, where the grid points are exact.
  it('leaves an amount already on the displayed grid untouched', () => {
    expect(formatUsdFloor(4_950_000)).toBe('$4.95');
    expect(formatUsdFloor(12_500_000)).toBe('$12.50');
    expect(formatUsdFloor(1_000_000)).toBe('$1.00');
    expect(formatUsdFloor(10_000)).toBe('$0.0100');
  });

  // Same magnitude buckets as `formatUsd`: a sub-cent balance still shows its
  // full micro-USD precision, where truncation is a no-op because micro-USD is
  // the stored atom.
  it('uses the same magnitude buckets, losing nothing below a cent', () => {
    expect(formatUsdFloor(26_499)).toBe('$0.0264');
    expect(formatUsdFloor(1_552)).toBe('$0.001552');
    expect(formatUsdFloor(1)).toBe('$0.000001');
  });

  // The bucket comes from the RAW magnitude, and truncation can only move the
  // value down, so - unlike `formatUsd` - a balance can never round up across
  // a bucket edge into a number the user does not have.
  it('cannot round up across a bucket edge', () => {
    expect(formatUsdFloor(999_999)).toBe('$0.9999');
    expect(formatUsdFloor(9_999_999)).toBe('$9.99');
  });

  // Balances may go negative (charging is post-paid, so a session can overrun
  // the balance). Truncating toward negative infinity moves a debt AWAY from
  // zero, which is the same conservative direction: never show less debt than
  // is owed.
  it('never renders a negative balance as less debt than is owed', () => {
    expect(formatUsdFloor(-1_234_000)).toBe('$-1.24');
    expect(formatUsdFloor(-1_500_000)).toBe('$-1.50');
  });

  it('renders an exact zero at 2 decimals, as formatUsd does', () => {
    expect(formatUsdFloor(0)).toBe('$0.00');
    expect(formatUsdFloor(-0)).toBe('$0.00');
  });

  it('renders unusable input as $0.00 rather than $NaN', () => {
    expect(formatUsdFloor(NaN)).toBe('$0.00');
    expect(formatUsdFloor(Infinity)).toBe('$0.00');
    expect(formatUsdFloor(null)).toBe('$0.00');
    expect(formatUsdFloor(undefined)).toBe('$0.00');
    expect(formatUsdFloor('3420000' as unknown as number)).toBe('$0.00');
  });
});

describe('formatRemainingTime', () => {
  it('renders sub-hour durations as mm:ss', () => {
    expect(formatRemainingTime(0)).toBe('00:00');
    expect(formatRemainingTime(59_000)).toBe('00:59');
    expect(formatRemainingTime(60_000)).toBe('01:00');
    expect(formatRemainingTime(1_800_000)).toBe('30:00');
  });

  it('renders hour-plus durations as h:mm:ss', () => {
    expect(formatRemainingTime(3_600_000)).toBe('01:00:00');
    expect(formatRemainingTime(3_661_000)).toBe('01:01:01');
  });

  it('rounds to the nearest second', () => {
    expect(formatRemainingTime(59_600)).toBe('01:00');
    expect(formatRemainingTime(59_400)).toBe('00:59');
  });

  it('clamps negative or non-finite input to 00:00 rather than a garbled clock', () => {
    expect(formatRemainingTime(-5_000)).toBe('00:00');
    expect(formatRemainingTime(NaN)).toBe('00:00');
    expect(formatRemainingTime(Infinity)).toBe('00:00');
  });
});
