/**
 * Utility functions for formatting data display
 */

/**
 * Format a micro-USD wallet amount (1 USD = 1,000,000 micro-USD) as a display
 * currency string. Mirrors the `formatUsd` helper in the backend web dashboard
 * (sokuji-backend/web/src/pages/dashboard/Wallet.tsx).
 * @param microUsd Amount in micro-USD
 * @returns Formatted string (e.g., "$3.42")
 */
export function formatUsd(microUsd: number): string {
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