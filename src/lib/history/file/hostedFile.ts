// src/lib/history/file/hostedFile.ts
//
// What Kizuna AI's service publishes for a file job in its public pricing table: how long and how large a track may
// be, and what an hour costs, untranslated or translated. The History page reads them before Start, so a recording the
// service would refuse is never sent, and the price is known first. The estimate is the length at the published rate,
// not padded (owner, 2026-11-18).
import { getApiUrl } from '../../../utils/environment';

export interface HostedFileTerms {
  /** Dollars per hour of audio, untranslated and translated. */
  usdPerHour: number;
  translatedUsdPerHour: number;
  /** The longest track the service takes, in ms. */
  maxAudioMs: number;
  /** The largest track the service takes, in bytes. */
  maxBytes: number;
  /** A track may hold at most `durationMs * maxBytesPerMs + bytesSlack` bytes. */
  maxBytesPerMs: number;
  bytesSlack: number;
}

/** A track as the terms weigh it: its length and its size. */
export interface TrackSize { durationMs: number; bytes: number }

const HOUR_MS = 3_600_000;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** The table's block; null when it has none, or one this app cannot use (the service does not offer file jobs yet). */
async function readTerms(send: typeof fetch): Promise<HostedFileTerms | null> {
  const response = await send(`${getApiUrl()}/pricing`, { method: 'GET' });
  if (!response.ok) throw new Error(`The pricing could not be read (${response.status})`);
  const block = ((await response.json()) as { fileTranscription?: Record<keyof HostedFileTerms, unknown> } | null)?.fileTranscription;
  if (!block) return null;
  const { usdPerHour, translatedUsdPerHour, maxAudioMs, maxBytes, maxBytesPerMs, bytesSlack } = block;
  if (![usdPerHour, translatedUsdPerHour, maxAudioMs, maxBytes, maxBytesPerMs, bytesSlack].every(finite)) return null;
  return { usdPerHour, translatedUsdPerHour, maxAudioMs, maxBytes, maxBytesPerMs, bytesSlack } as HostedFileTerms;
}

/** The terms asked for, or being asked for: only an answer that has them is kept. */
let asked: Promise<HostedFileTerms | null> | null = null;

/**
 * The terms from `<apiUrl>/pricing`; null when the service has none; rejects when they cannot be read (no answer, a
 * refusal, not JSON). Kept once had, as the notes' prices are; a failure or an answer without them is asked again
 * next time, so a connection back or a service that gained the feature is seen.
 */
export function fetchHostedFileTerms(send: typeof fetch = (input, init) => fetch(input, init)): Promise<HostedFileTerms | null> {
  asked ??= readTerms(send).then(
    (terms) => { if (!terms) asked = null; return terms; },
    (error: unknown) => { asked = null; throw error; },
  );
  return asked;
}

/** Forgets the terms kept, for tests. */
export function resetHostedFileTermsForTests(): void {
  asked = null;
}

/** Whether every track fits the hosted limits: its length, its size, and its size for its length. */
export function fitsHosted(tracks: readonly TrackSize[], terms: HostedFileTerms): boolean {
  return tracks.every((t) => t.durationMs <= terms.maxAudioMs && t.bytes <= terms.maxBytes
    && t.bytes <= t.durationMs * terms.maxBytesPerMs + terms.bytesSlack);
}

/** The estimated price in USD of transcribing the tracks: their length at the published rate. */
export function hostedEstimateUsd(tracks: readonly TrackSize[], translated: boolean, terms: HostedFileTerms): number {
  const ms = tracks.reduce((sum, t) => sum + t.durationMs, 0);
  return (ms / HOUR_MS) * (translated ? terms.translatedUsdPerHour : terms.usdPerHour);
}
