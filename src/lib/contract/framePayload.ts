/** A frame payload fit for the Logs panel (spec D8, "What every adapter must honour"): every string redacted and cut below the contract's 2 048-character bound. Shared by every adapter (Stage 2 Soniox, choice 15). */
import { redact } from '../diagnostics/redact';

/** Below the contract's 2048-character bound on any frame string. */
export const FRAME_STRING_MAX = 2000;

/** A frame payload fit for the Logs panel: every string redacted and cut below the bound. */
export function framePayload(value: unknown): unknown {
  if (typeof value === 'string') {
    const clean = redact(value);
    return clean.length > FRAME_STRING_MAX ? `${clean.slice(0, FRAME_STRING_MAX)}…` : clean;
  }
  if (Array.isArray(value)) return value.map(framePayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, framePayload(v)]));
  }
  return value;
}
