// The website's billing page, mirrored: how long the balance lasts.

/** Hours the balance covers at the account's own 30-day rate, or at the preset's without one. Never negative. */
export function hoursLeft(balanceUsd: number, usdPerHour: number | null, fallbackUsdPerHour: number): number {
  const rate = usdPerHour !== null && usdPerHour > 0 ? usdPerHour : fallbackUsdPerHour;
  if (!(rate > 0)) return 0;
  return Math.max(0, balanceUsd) / rate;
}

/**
 * Hours for display, always rounded DOWN: an estimate of how long money lasts
 * must not promise the last partial hour. Whole hours from ten up, one decimal
 * below, and "< 1" rather than a fraction of an hour.
 */
export function formatHours(hours: number): string {
  if (hours <= 0) return '0';
  if (hours < 1) return '< 1';
  if (hours < 10) return (Math.floor(hours * 10) / 10).toString();
  return Math.floor(hours).toString();
}
