/**
 * Download resilience helpers — connect timeout, stall detection, and retry.
 *
 * The in-app model download path (ModelManager) fetches large model files
 * directly from a CDN. When that CDN is unreachable (e.g. the HF Xet backend
 * black-holed on a censored network), a bare `fetch` + `reader.read()` loop
 * hangs forever with no error. These helpers convert those two hang modes —
 * "headers never arrive" and "stream stops mid-flight" — into a typed
 * {@link DownloadTimeoutError}, and add per-attempt retry with backoff.
 *
 * Everything here is transport-agnostic and dependency-injected (fetchImpl,
 * reader, sleep) so it can be unit-tested without a real network or timers.
 */

/** Thrown when a download stalls: no response headers, or no stream progress. */
export class DownloadTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownloadTimeoutError';
  }
}

// ─── Retry ─────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Total number of attempts (including the first). */
  attempts: number;
  /** Delay before each retry; index i is the wait after attempt i+1 fails. Last value repeats. */
  backoffsMs?: number[];
  /** Return false to stop retrying and rethrow immediately (e.g. user cancel). Default: always retry. */
  shouldRetry?: (err: unknown) => boolean;
  /** Called before each backoff wait, for logging/progress. */
  onRetry?: (err: unknown, nextAttempt: number) => void;
  /** Injectable sleep for tests. Default: real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying on failure up to `attempts` times with backoff.
 * Rethrows the last error once attempts are exhausted or `shouldRetry` says stop.
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const { attempts, backoffsMs = [], shouldRetry, onRetry, sleep = defaultSleep } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = attempt === attempts - 1;
      if (isLast || (shouldRetry && !shouldRetry(err))) throw err;
      onRetry?.(err, attempt + 2);
      const wait = backoffsMs[Math.min(attempt, backoffsMs.length - 1)] ?? 0;
      if (wait > 0) await sleep(wait);
    }
  }
  throw lastErr;
}

// ─── Connect timeout ─────────────────────────────────────────────────────────

export interface FetchTimeoutOptions {
  /** Abort the fetch if response headers have not arrived within this many ms. */
  timeoutMs: number;
  /** User-cancel signal — composed with the internal timeout so either aborts the fetch. */
  signal?: AbortSignal;
  /** Injectable fetch for tests. Default: global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * `fetch` with a connect timeout. Aborts (and rejects with
 * {@link DownloadTimeoutError}) if the response does not arrive within
 * `timeoutMs`. A user cancel via `signal` rejects with an AbortError instead,
 * so callers can tell "network is blocked" apart from "user pressed cancel".
 */
export async function fetchWithConnectTimeout(
  url: string,
  opts: FetchTimeoutOptions,
): Promise<Response> {
  const { timeoutMs, signal, fetchImpl = fetch } = opts;
  if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError');

  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onUserAbort = () => controller.abort();
  signal?.addEventListener('abort', onUserAbort, { once: true });

  try {
    return await fetchImpl(url, { signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      if (timedOut) {
        throw new DownloadTimeoutError(
          `Timed out connecting to ${url} after ${timeoutMs}ms`,
        );
      }
      // User-initiated cancel — preserve AbortError semantics.
      throw new DOMException('Download cancelled', 'AbortError');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onUserAbort);
  }
}

// ─── Stall-guarded streaming ─────────────────────────────────────────────────

/** Minimal reader contract satisfied by ReadableStreamDefaultReader and test fakes. */
export interface ChunkReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void> | void;
}

export interface StreamToBlobOptions {
  /** Abort if no chunk arrives for this many ms (idle/stall guard). */
  stallTimeoutMs: number;
  /** User-cancel signal. */
  signal?: AbortSignal;
  /** Cumulative bytes read so far. */
  onProgress?: (downloadedBytes: number) => void;
}

/**
 * Drain a chunk reader into a Blob, aborting with {@link DownloadTimeoutError}
 * if no chunk arrives within `stallTimeoutMs` (the watchdog resets on every
 * chunk). A user cancel via `signal` rejects with an AbortError.
 */
export async function readStreamToBlob(
  reader: ChunkReader,
  opts: StreamToBlobOptions,
): Promise<Blob> {
  const { stallTimeoutMs, signal, onProgress } = opts;
  const chunks: BlobPart[] = [];
  let downloaded = 0;

  const abortError = () => new DOMException('Download cancelled', 'AbortError');

  while (true) {
    if (signal?.aborted) {
      await reader.cancel(abortError());
      throw abortError();
    }

    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const stall = new Promise<never>((_resolve, reject) => {
      stallTimer = setTimeout(
        () => reject(new DownloadTimeoutError(`Stream stalled: no data for ${stallTimeoutMs}ms`)),
        stallTimeoutMs,
      );
    });

    const races: Promise<{ done: boolean; value?: Uint8Array }>[] = [reader.read(), stall];
    if (signal) {
      races.push(
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError()), { once: true });
        }),
      );
    }

    let result: { done: boolean; value?: Uint8Array };
    try {
      result = await Promise.race(races);
    } catch (err) {
      clearTimeout(stallTimer);
      await Promise.resolve(reader.cancel(err)).catch(() => {});
      throw err;
    }
    clearTimeout(stallTimer);

    if (result.done) break;
    const value = result.value!;
    chunks.push(value);
    downloaded += value.byteLength;
    onProgress?.(downloaded);
  }

  return new Blob(chunks);
}
