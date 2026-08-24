// src/components/TitleBar/compactBalance.ts
//
// The title bar shows a GLANCE at the balance; the popover shows the exact
// floored value. Measured: rendering `$0.001552` here pushes the Electron
// Win/Linux safe width from 335px to 600px, because the label sits in the
// same flex row as three window buttons. Collapsing sub-cent amounts to a
// bound costs nothing a user reads at this size and buys back 265px.
//
// Truncation direction matches formatUsdFloor: never claim more money than
// the wallet holds. `< $0.01` understates, and a negative balance floors
// AWAY from zero so a debt is never shown as smaller than it is.

const MICRO_USD_PER_CENT = 10_000;
const CENTS_PER_USD = 100;

// Returns null when there is no balance to show. An unloaded wallet used to
// render as '$0.00', so signing in flashed a zero balance before the real one
// arrived — and $0.00 is the one number a user cannot help but act on. "Not
// known yet" and "empty" have to look different, because they mean opposite
// things.
export function compactBalanceLabel(microUsd: number | null | undefined): string | null {
  if (typeof microUsd !== 'number' || !Number.isFinite(microUsd)) return null;
  if (microUsd === 0) return '$0.00';

  if (microUsd > 0 && microUsd < MICRO_USD_PER_CENT) return '< $0.01';

  // Math.floor on the cent count moves negatives away from zero, which is the
  // conservative direction for a debt as well as for a credit.
  const cents = Math.floor(microUsd / MICRO_USD_PER_CENT);
  const dollars = Math.abs(cents) / CENTS_PER_USD;
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${dollars.toFixed(2)}`;
}
