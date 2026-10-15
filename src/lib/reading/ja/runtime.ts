import { describeCause, reportWarning } from '../../diagnostics/report';
import { deleteModelFiles } from '../../local-inference/modelStorage';
import { startJaClient, type JaClient } from './client';
import { DICTIONARY_BYTES, DICTIONARY_STORE_ID, downloadDictionary, isDictionaryStored, storedDictionary } from './dictionary';
import type { JaToken } from './furigana';

/**
 * Where Japanese readings are: off, checking the stored file, downloading, ready,
 * or failed. Ready means the dictionary is stored; the worker starts when a
 * Japanese row first needs a reading (spec §3). A failure is the download's, or
 * the engine's: the stored file could not be checked or read, or the worker
 * could not start or stopped.
 */
export type JapaneseState =
  | { phase: 'off' }
  | { phase: 'loading' }
  | { phase: 'downloading'; done: number; total: number }
  | { phase: 'ready' }
  | { phase: 'failed'; cause: 'download' | 'engine' };

let state: JapaneseState = { phase: 'off' };
let wanted = false;
/** Bumped by every start and stop, so an overtaken start drops what it finishes. */
let generation = 0;
let controller: AbortController | null = null;
let client: JaClient | null = null;
/** The worker on its way up, shared by every tokenize that arrives meanwhile. */
let starting: Promise<JaClient | null> | null = null;
const listeners = new Set<() => void>();

function publish(next: JapaneseState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

export function getJapaneseState(): JapaneseState {
  return state;
}

export function subscribeJapanese(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Starts Japanese readings (the dictionary; the worker on first use) or stops them, giving the worker's memory back. */
export function setJapaneseWanted(next: boolean): void {
  if (next === wanted) return;
  wanted = next;
  if (next) void start();
  else stop();
}

export function retryJapanese(): void {
  if (wanted && state.phase === 'failed') void start();
}

/** The tokens of `text` (null if the worker is gone or cannot start), or null when not ready. Starts the worker. */
export function tokenizeJapanese(text: string): Promise<JaToken[] | null> | null {
  if (state.phase !== 'ready') return null;
  if (client) return client.tokenize(text);
  return startClient().then((started) => (started ? started.tokenize(text) : null));
}

function stop(): void {
  generation++;
  controller?.abort();
  controller = null;
  client?.terminate();
  client = null;
  starting = null;
  publish({ phase: 'off' });
}

function startClient(): Promise<JaClient | null> {
  if (starting) return starting;
  const gen = generation;
  starting = (async (): Promise<JaClient | null> => {
    try {
      // The only read of the file's bytes: start() checked that it is there.
      const bytes = await storedDictionary();
      if (gen !== generation) return null;
      if (!bytes) throw new Error('the stored dictionary is gone');
      // A worker that stops later fails like one that would not start, but keeps the
      // file: nothing says it is bad, and Retry starts a new worker on it.
      const started = await startJaClient(bytes, (err) => {
        if (gen !== generation || client !== started) return;
        client = null;
        reportWarning('Readings', `Japanese readings stopped: ${describeCause(err)}`, { cause: err });
        publish({ phase: 'failed', cause: 'engine' });
      });
      if (gen !== generation) {
        started.terminate();
        return null;
      }
      client = started;
      return started;
    } catch (err) {
      if (gen !== generation) return null;
      // A file of the right size that will not start would fail every time: Retry downloads it again.
      await deleteModelFiles(DICTIONARY_STORE_ID).catch(() => {});
      if (gen !== generation) return null;
      reportWarning('Readings', `Japanese readings could not start: ${describeCause(err)}`, { cause: err });
      publish({ phase: 'failed', cause: 'engine' });
      return null;
    } finally {
      // One attempt per generation: a stop has cleared it already, and a later start owns the next.
      if (gen === generation) starting = null;
    }
  })();
  return starting;
}

async function start(): Promise<void> {
  const gen = ++generation;
  controller?.abort();
  const own = new AbortController();
  controller = own;
  publish({ phase: 'loading' });
  let downloading = false;
  try {
    // Check storage on every start: clearing local models deletes the file.
    const stored = await isDictionaryStored();
    if (gen !== generation) return;
    if (!stored) {
      publish({ phase: 'downloading', done: 0, total: DICTIONARY_BYTES });
      downloading = true;
      await downloadDictionary({
        signal: own.signal,
        onProgress: (done, total) => {
          if (gen === generation) publish({ phase: 'downloading', done, total });
        },
      });
      if (gen !== generation) return;
    }
    publish({ phase: 'ready' });
  } catch (err) {
    if (gen !== generation || (err as Error)?.name === 'AbortError') return;
    reportWarning('Readings', `Japanese readings are unavailable: ${describeCause(err)}`, { cause: err });
    publish({ phase: 'failed', cause: downloading ? 'download' : 'engine' });
  }
}
