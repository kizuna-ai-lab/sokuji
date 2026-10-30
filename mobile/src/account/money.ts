// Money for humans, the website's rule (web/src/lib/money-format.ts in the
// backend repo; the dashboard is what the account screens are compared with).
// A fixed two decimals deletes a usage row's amount: a ten-second session
// costs a few thousandths of a dollar. So the precision follows the magnitude:
//   |x| >= $1     2 decimals   $12.50
//   |x| >= $0.01  4 decimals   $0.0265
//   otherwise     6 decimals   $0.001552  (the full micro-dollar)
// Zero stays "$0.00": it means no money moved, and must not look like a tiny amount.
function magnitude(absUsd: number): string {
  if (absUsd === 0) return '0.00';
  if (absUsd >= 1) return absUsd.toFixed(2);
  if (absUsd >= 0.01) return absUsd.toFixed(4);
  return absUsd.toFixed(6);
}

const ALL_ZEROS = /^0(?:\.0+)?$/;

/** A signed dollar string; a dash for a value that is not a number. */
export function formatUsd(usd: number): string {
  if (typeof usd !== 'number' || !Number.isFinite(usd)) return '—';
  const m = magnitude(Math.abs(usd));
  // The sign goes on the formatted magnitude: an amount too small for its
  // bucket must not read "-$0.000000".
  const sign = usd < 0 && !ALL_ZEROS.test(m) ? '-' : '';
  return `${sign}$${m}`;
}
