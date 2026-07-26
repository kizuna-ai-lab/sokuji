/**
 * Utility functions for formatting data display
 */

/**
 * Format a micro-USD wallet amount (1 USD = 1,000,000 micro-USD) as a display
 * currency string. Mirrors the `formatUsd` helper in the backend web dashboard
 * (sokuji-backend/web/src/pages/dashboard/Wallet.tsx).
 *
 * The argument comes from `QuotaData`, which is built from an untyped JSON
 * payload, so null/undefined/NaN can reach here — callers pass things like
 * `quota.balance ?? 0` and `quota.balance || quota.remaining`, neither of which
 * stops a NaN. Anything non-finite renders "$0.00" rather than the literal
 * "$NaN" appearing in the balance UI.
 *
 * @param microUsd Amount in micro-USD
 * @returns Formatted string (e.g., "$3.42")
 */
export function formatUsd(microUsd: number | null | undefined): string {
  if (typeof microUsd !== 'number' || !Number.isFinite(microUsd)) return '$0.00';
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
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