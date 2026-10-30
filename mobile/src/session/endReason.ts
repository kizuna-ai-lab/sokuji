import type { Status } from './session';

/** What a stored session records as its end: a terminal error's detail by name, otherwise a stop. */
export function endReason(status: Status | 'idle', detail: string | undefined): string {
  if (status === 'error') return detail || 'error';
  return 'stopped';
}
