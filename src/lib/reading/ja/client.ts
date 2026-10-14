import { createLinderaWorker } from './createLinderaWorker';
import type { JaToken } from './furigana';
import type { FromLinderaWorker, ToLinderaWorker } from './protocol';

export interface JaClient {
  /** The tokens, or null once the worker is gone. */
  tokenize(text: string): Promise<JaToken[] | null>;
  terminate(): void;
}

/** Starts the worker on the dictionary's bytes (transferred) and resolves once it can tokenize. */
export function startJaClient(wasm: ArrayBuffer): Promise<JaClient> {
  const worker = createLinderaWorker();
  const pending = new Map<number, (tokens: JaToken[] | null) => void>();
  let nextId = 1;
  const settleAll = () => {
    for (const done of pending.values()) done(null);
    pending.clear();
  };
  const client: JaClient = {
    tokenize: (text) => new Promise((done) => {
      const id = nextId++;
      pending.set(id, done);
      worker.postMessage({ type: 'tokenize', id, text } satisfies ToLinderaWorker);
    }),
    terminate: () => {
      worker.terminate();
      settleAll();
    },
  };
  return new Promise((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<FromLinderaWorker>) => {
      const msg = e.data;
      if (msg.type === 'ready') resolve(client);
      else if (msg.type === 'failed') {
        worker.terminate();
        reject(new Error(msg.message));
      } else {
        pending.get(msg.id)?.(msg.tokens);
        pending.delete(msg.id);
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      worker.terminate();
      settleAll();
      reject(new Error(e.message || 'The Lindera worker stopped'));
    };
    worker.postMessage({ type: 'init', wasm } satisfies ToLinderaWorker, [wasm]);
  });
}
