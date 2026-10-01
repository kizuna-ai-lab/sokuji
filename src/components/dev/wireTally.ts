/**
 * Development builds only: what the overlay's wire carries, per message
 * type, in the bytes Chrome's extension messaging would — the message as
 * JSON, UTF-8 (plan 1e-4 ruling 6). The preview's `MessageChannel` clones
 * structurally, so its own cost says nothing about the extension's port.
 */
import { OVERLAY_ENTRIES, type WirePort } from '../../lib/subtitle/wire';

export interface WireCount {
  count: number;
  bytes: number;
  max: number;
  /**
   * `subtitle:entries` only: the largest message that carried the full tail
   * (`OVERLAY_ENTRIES` entries or more), the steady state plan 1e-4 ruling 6
   * budgets. Absent until the tail has reached its cap.
   */
  steadyMax?: number;
}
export type WireTally = Record<string, WireCount>;

const encoder = new TextEncoder();

export function tallied(wire: WirePort, tally: WireTally): WirePort {
  return {
    ...wire,
    post(message) {
      const type = typeof message === 'object' && message !== null && typeof (message as { type?: unknown }).type === 'string'
        ? (message as { type: string }).type
        : '?';
      const bytes = encoder.encode(JSON.stringify(message)).length;
      const count = (tally[type] ??= { count: 0, bytes: 0, max: 0 });
      count.count += 1;
      count.bytes += bytes;
      count.max = Math.max(count.max, bytes);
      const entries = (message as { entries?: unknown }).entries;
      if (type === 'subtitle:entries' && Array.isArray(entries) && entries.length >= OVERLAY_ENTRIES) {
        count.steadyMax = Math.max(count.steadyMax ?? 0, bytes);
      }
      wire.post(message);
    },
  };
}
