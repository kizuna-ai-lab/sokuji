import { describeCause, reportWarning } from '../../diagnostics/report';
import { startJaClient, type JaClient } from './client';
import { DICTIONARY_BYTES, downloadDictionary, storedDictionary } from './dictionary';
import type { JaToken } from './furigana';

/** Where Japanese readings are: off, loading the stored file or the worker, downloading, ready, or failed. */
export type JapaneseState =
  | { phase: 'off' }
  | { phase: 'loading' }
  | { phase: 'downloading'; done: number; total: number }
  | { phase: 'ready' }
  | { phase: 'failed' };

let state: JapaneseState = { phase: 'off' };
let wanted = false;
/** Bumped by every start and stop, so an overtaken start drops what it finishes. */
let generation = 0;
let controller: AbortController | null = null;
let client: JaClient | null = null;
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

/** Starts Japanese readings (the dictionary, then the worker) or stops them, giving the worker's memory back. */
export function setJapaneseWanted(next: boolean): void {
  if (next === wanted) return;
  wanted = next;
  if (next) void start();
  else stop();
}

export function retryJapanese(): void {
  if (wanted && state.phase === 'failed') void start();
}

/** The tokens of `text`, or null when the worker is not ready. */
export function tokenizeJapanese(text: string): Promise<JaToken[] | null> | null {
  return client ? client.tokenize(text) : null;
}

function stop(): void {
  generation++;
  controller?.abort();
  controller = null;
  client?.terminate();
  client = null;
  publish({ phase: 'off' });
}

async function start(): Promise<void> {
  const gen = ++generation;
  controller?.abort();
  const own = new AbortController();
  controller = own;
  publish({ phase: 'loading' });
  try {
    // Read storage on every start: clearing local models deletes the file.
    let bytes = await storedDictionary();
    if (gen !== generation) return;
    if (!bytes) {
      publish({ phase: 'downloading', done: 0, total: DICTIONARY_BYTES });
      bytes = await downloadDictionary({
        signal: own.signal,
        onProgress: (done, total) => {
          if (gen === generation) publish({ phase: 'downloading', done, total });
        },
      });
      if (gen !== generation) return;
    }
    const started = await startJaClient(bytes);
    if (gen !== generation) {
      started.terminate();
      return;
    }
    client = started;
    publish({ phase: 'ready' });
  } catch (err) {
    if (gen !== generation || (err as Error)?.name === 'AbortError') return;
    reportWarning('Readings', `Japanese readings are unavailable: ${describeCause(err)}`, { cause: err });
    publish({ phase: 'failed' });
  }
}
