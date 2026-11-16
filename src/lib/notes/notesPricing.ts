// src/lib/notes/notesPricing.ts
//
// The notes written by Kizuna AI cost the payer per call; the backend's public pricing table publishes what an hour of
// meeting costs, live and after the session, as estimates (already including our margin). The notes card shows them.
import { useEffect, useState } from 'react';
import { getApiUrl } from '../../utils/environment';

export interface NotesPricing {
  liveUsdPerHour: number;
  afterSessionUsdPerHour: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** The table's notes estimates; null from a backend that predates them, a refusal, or no answer. */
export async function fetchNotesPricing(send: typeof fetch = (input, init) => fetch(input, init)): Promise<NotesPricing | null> {
  try {
    const response = await send(`${getApiUrl()}/pricing`, { method: 'GET' });
    if (!response.ok) return null;
    const notes = ((await response.json()) as { notes?: { liveUsdPerHour?: unknown; afterSessionUsdPerHour?: unknown } })?.notes;
    if (!notes || !finite(notes.liveUsdPerHour) || !finite(notes.afterSessionUsdPerHour)) return null;
    return { liveUsdPerHour: notes.liveUsdPerHour, afterSessionUsdPerHour: notes.afterSessionUsdPerHour };
  } catch {
    return null;
  }
}

/** Dollars an hour: to the cent, or to the tenth of a cent below ten cents (the notes cost a few cents). */
export function perHour(usd: number): string {
  return usd >= 0.1 ? `$${usd.toFixed(2)}` : `$${Number(usd.toFixed(3))}`;
}

let asked: Promise<NotesPricing | null> | null = null;

/** The estimates, read once per launch while wanted (a failed read is tried again the next time). */
export function useNotesPricing(wanted: boolean): NotesPricing | null {
  const [pricing, setPricing] = useState<NotesPricing | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    asked ??= fetchNotesPricing().then((p) => { if (!p) asked = null; return p; });
    void asked.then((p) => { if (live) setPricing(p); });
    return () => { live = false; };
  }, [wanted]);
  return pricing;
}
