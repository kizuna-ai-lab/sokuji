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

const MICRO_USD_PER_USD = 1_000_000;
const MICRO_USD_PER_CENT = 10_000;

export function compactBalanceLabel(microUsd: number | null | undefined): string {
  if (typeof microUsd !== 'number' || !Number.isFinite(microUsd)) return '$0.00';
  if (microUsd === 0) return '$0.00';

  if (microUsd > 0 && microUsd < MICRO_USD_PER_CENT) return '< $0.01';

  // Math.floor on the cent count moves negatives away from zero, which is the
  // conservative direction for a debt as well as for a credit.
  const cents = Math.floor(microUsd / MICRO_USD_PER_CENT);
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${dollars.toFixed(2)}`;
}
