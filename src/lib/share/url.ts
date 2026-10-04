// src/lib/share/url.ts
import type { ShareStatus } from './types';

/** The address viewers open, or null when sharing is off or no address is chosen. */
export function shareUrl(status: ShareStatus): string | null {
  if (!status.running || !status.selected || !status.port) return null;
  return `http://${status.selected}:${status.port}/`;
}
