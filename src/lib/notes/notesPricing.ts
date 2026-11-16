// src/lib/notes/notesPricing.ts
//
// The notes written by Kizuna AI cost the payer per call; the backend's public pricing table publishes what an hour of
// meeting costs, live and after the session, as estimates (already including our margin). The notes card shows them.
import { useEffect, useState } from 'react';
import { getApiUrl } from '../../utils/environment';

export interface NotesPricing {
  /** Dollars per million tokens, as charged (after K). */
  inputPerMTok: number;
  cachedInputPerMTok: number;
  outputPerMTok: number;
  liveUsdPerHour: number;
  afterSessionUsdPerHour: number;
}

/** Tokens used, summed: all input, the cached part of it, and output. */
export interface NotesUsed { input: number; cached: number; output: number }

/** Below this balance (µUSD) the live notes say it is low: about two and a half hours of live notes. */
export const LOW_BALANCE_MICRO_USD = 100_000;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** The table's notes estimates; null from a backend that predates them, a refusal, or no answer. */
export async function fetchNotesPricing(send: typeof fetch = (input, init) => fetch(input, init)): Promise<NotesPricing | null> {
  try {
    const response = await send(`${getApiUrl()}/pricing`, { method: 'GET' });
    if (!response.ok) return null;
    const notes = ((await response.json()) as { notes?: Record<keyof NotesPricing, unknown> })?.notes;
    if (!notes) return null;
    const { inputPerMTok, cachedInputPerMTok, outputPerMTok, liveUsdPerHour, afterSessionUsdPerHour } = notes;
    if (![inputPerMTok, cachedInputPerMTok, outputPerMTok, liveUsdPerHour, afterSessionUsdPerHour].every(finite)) return null;
    return { inputPerMTok, cachedInputPerMTok, outputPerMTok, liveUsdPerHour, afterSessionUsdPerHour } as NotesPricing;
  } catch {
    return null;
  }
}

/** Dollars: to the cent, or to the tenth of a cent below ten cents (the notes cost a few cents). */
export function usd(amount: number): string {
  if (amount > 0 && amount < 0.001) return '<$0.001';
  return amount >= 0.1 ? `$${amount.toFixed(2)}` : `$${Number(amount.toFixed(3))}`;
}

/** A price per hour, written as `usd` writes it. */
export const perHour = usd;

/** What `used` costs at the published rates: uncached input, cached input and output apart, as the backend charges. */
export function liveCostUsd(used: NotesUsed, p: Pick<NotesPricing, 'inputPerMTok' | 'cachedInputPerMTok' | 'outputPerMTok'>): number {
  return ((used.input - used.cached) * p.inputPerMTok + used.cached * p.cachedInputPerMTok + used.output * p.outputPerMTok) / 1e6;
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
