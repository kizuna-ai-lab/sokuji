import { createLinderaWorker } from './createLinderaWorker';
import type { JaToken } from './furigana';
import type { FromLinderaWorker, ToLinderaWorker } from './protocol';

export interface JaClient {
  /** The tokens, or null once the worker is gone. */
  tokenize(text: string): Promise<JaToken[] | null>;
  terminate(): void;
}

/**
 * Starts the worker on the dictionary archive's bytes (transferred) and resolves
 * once it can tokenize. `onGone` hears of a worker that stops after that (the
 * system can end its ~200 MB under memory pressure); its own terminate() is not
 * reported.
 */
export function startJaClient(dictionary: ArrayBuffer, onGone?: (err: Error) => void): Promise<JaClient> {
  const worker = createLinderaWorker();
  const pending = new Map<number, (tokens: JaToken[] | null) => void>();
  let nextId = 1;
  let gone = false;
  let ready = false;
  const settleAll = () => {
    for (const done of pending.values()) done(null);
    pending.clear();
  };
  const client: JaClient = {
    tokenize: (text) => gone ? Promise.resolve(null) : new Promise((done) => {
      const id = nextId++;
      pending.set(id, done);
      worker.postMessage({ type: 'tokenize', id, text } satisfies ToLinderaWorker);
    }),
    terminate: () => {
      gone = true;
      worker.terminate();
      settleAll();
    },
  };
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<FromLinderaWorker>) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        ready = true;
        resolve(client);
      }
      else if (msg.type === 'failed') {
        worker.terminate();
        reject(new Error(msg.message));
      } else {
        pending.get(msg.id)?.(msg.tokens);
        pending.delete(msg.id);
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      gone = true;
      worker.terminate();
      settleAll();
      const err = new Error(e.message || 'The Lindera worker stopped');
      if (ready) onGone?.(err);
      else reject(err);
    };
    worker.postMessage({ type: 'init', dictionary } satisfies ToLinderaWorker, [dictionary]);
  });
}
