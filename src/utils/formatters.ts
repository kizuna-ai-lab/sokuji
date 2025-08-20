/**
 * Utility functions for formatting data display
 */

/**
 * Format large numbers (tokens) in a human-readable format
 * @param tokens Number of tokens
 * @returns Formatted string (e.g., "1.5M", "150K", "1234")
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    const millions = tokens / 1000000;
    return millions >= 10 
      ? `${Math.round(millions)}M` 
      : `${millions.toFixed(1)}M`;
  } else if (tokens >= 1000) {
    const thousands = tokens / 1000;
    return thousands >= 10 
      ? `${Math.round(thousands)}K` 
      : `${thousands.toFixed(1)}K`;
  }
  return tokens.toString();
}

/**
 * Calculate usage percentage
 * @param used Number of tokens used
 * @param total Total token quota
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
 * @param used Number of tokens used
 * @param total Total token quota
 * @returns Warning level: 'normal' | 'warning' | 'critical'
 */
export function getQuotaWarningLevel(used: number, total: number): 'normal' | 'warning' | 'critical' {
  const percentage = formatPercentage(used, total);
  if (percentage >= 95) return 'critical';
  if (percentage >= 80) return 'warning';
  return 'normal';
}