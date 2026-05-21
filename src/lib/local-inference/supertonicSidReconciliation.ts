/**
 * Settings-side helper that clamps a persisted Supertonic sid to the set of
 * voices actually loaded by the worker.
 *
 * The worker itself has a fallback at generate time (defaults to model's
 * defaultSid if the requested sid isn't available). This helper exists for
 * the UI layer to surface the discrepancy: if the user's saved voice was
 * deleted (or failed to load), set their selection to the default and tell
 * them about it.
 *
 * Pure function — no side effects, no I/O.
 */

export interface SupertonicReadyVoice {
  sid: number;
  name: string;
  source: 'preset' | 'imported';
  gender?: 'M' | 'F';
}

export interface SupertonicReadySettingsInput {
  currentSid: number;
  defaultSid: number;
  voices: SupertonicReadyVoice[];
}

export interface SupertonicReadySettingsResult {
  /** The sid the caller should now use, or null if neither current nor default exists. */
  nextSid: number | null;
  /** True if the value differs from `currentSid` (or no fallback available). */
  wasReset: boolean;
}

export function applySupertonicReadyToSettings({
  currentSid,
  defaultSid,
  voices,
}: SupertonicReadySettingsInput): SupertonicReadySettingsResult {
  const sids = new Set(voices.map((v) => v.sid));
  if (sids.has(currentSid)) {
    return { nextSid: currentSid, wasReset: false };
  }
  if (sids.has(defaultSid)) {
    return { nextSid: defaultSid, wasReset: true };
  }
  return { nextSid: null, wasReset: true };
}
