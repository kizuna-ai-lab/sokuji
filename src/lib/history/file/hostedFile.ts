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
/** How long the pricing table is waited for: past this, the terms cannot be read. */
export const TERMS_TIMEOUT_MS = 10_000;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const positive = (v: unknown): v is number => finite(v) && v > 0;

/**
 * The table's block; null when it has none, or one this app cannot use (the service does not offer file jobs yet): a
 * figure that is not a number, a negative rate, or a longest length or a largest size of nothing, which would refuse
 * every recording.
 */
async function readTerms(send: typeof fetch): Promise<HostedFileTerms | null> {
  const response = await send(`${getApiUrl()}/pricing`, { method: 'GET', signal: AbortSignal.timeout(TERMS_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`The pricing could not be read (${response.status})`);
  const block = ((await response.json()) as { fileTranscription?: Record<keyof HostedFileTerms, unknown> } | null)?.fileTranscription;
  if (!block) return null;
  const { usdPerHour, translatedUsdPerHour, maxAudioMs, maxBytes, maxBytesPerMs, bytesSlack } = block;
  if (![usdPerHour, translatedUsdPerHour, maxBytesPerMs, bytesSlack].every(finite) || ![maxAudioMs, maxBytes].every(positive)) return null;
  return { usdPerHour, translatedUsdPerHour, maxAudioMs, maxBytes, maxBytesPerMs, bytesSlack } as HostedFileTerms;
}

/** The terms asked for, or being asked for: only an answer that has them is kept. */
let asked: Promise<HostedFileTerms | null> | null = null;

/** `promise`, or its caller's abort once `signal` aborts first. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/**
 * The terms from `<apiUrl>/pricing`; null when the service has none; rejects when they cannot be read (no answer
 * within `TERMS_TIMEOUT_MS`, a refusal, not JSON). Kept once read, as the notes' prices are; a failure or an answer
 * without them is asked again next time, so a connection back or a service that gained the feature is seen.
 * `signal` (a job's cancel) ends the caller's wait at once; the request itself goes on, bounded by its timeout, since
 * another caller may be waiting on the same answer.
 */
export function fetchHostedFileTerms(send: typeof fetch = (input, init) => fetch(input, init), signal?: AbortSignal): Promise<HostedFileTerms | null> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  asked ??= readTerms(send).then(
    (terms) => { if (!terms) asked = null; return terms; },
    (error: unknown) => { asked = null; throw error; },
  );
  return signal ? untilAborted(asked, signal) : asked;
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

/** Whether the tracks are translated: one answer for all of them, or one per track, in order. */
export type TracksTranslated = boolean | readonly boolean[];

/** A published rate per hour in whole micro-USD (the table's dollars carry no finer fraction). */
const microUsdPerHour = (usd: number) => Math.round(usd * 1_000_000);

/**
 * The estimated price in micro-USD of transcribing the tracks: each one's length at its rate, translated or not,
 * rounded up to a whole micro-USD as the service rounds its estimate. Worked in whole numbers (a length in ms times
 * micro-USD an hour stays exact far beyond any recording), so no fraction drifts in: 90 minutes at $0.20 an hour is
 * 300 000, never 300 001.
 */
export function hostedEstimateMicroUsd(tracks: readonly TrackSize[], translated: TracksTranslated, terms: HostedFileTerms): number {
  const plain = microUsdPerHour(terms.usdPerHour);
  const withTranslation = microUsdPerHour(terms.translatedUsdPerHour);
  const translatedAt = (i: number) => (typeof translated === 'boolean' ? translated : translated[i] === true);
  const scaled = tracks.reduce((sum, t, i) => sum + t.durationMs * (translatedAt(i) ? withTranslation : plain), 0);
  return Math.ceil(scaled / HOUR_MS);
}

/** The estimated price in USD of transcribing the tracks: `hostedEstimateMicroUsd`, in dollars. */
export function hostedEstimateUsd(tracks: readonly TrackSize[], translated: TracksTranslated, terms: HostedFileTerms): number {
  return hostedEstimateMicroUsd(tracks, translated, terms) / 1_000_000;
}
