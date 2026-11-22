// src/lib/textModel/desktopTransport.ts
//
// A compatible service is asked from the desktop app's main process (`electron/text-model-request.js`): the packaged
// page's origin is `file://`, and a third-party server need not answer its CORS preflight. The page hands the main
// process the base, the endpoint, the method, the headers and the body over one channel; the main process checks the
// address again, sends the request with a 60-second and a 2 MB cap, and answers the status and the body, or why
// there is none. A caller's abort tells the main process to let the request go.

import { TEXT_MODEL_PATHS, type TextModelPath } from './address';
import { TextModelTransportError, type TextModelFailureCode, type TextModelTransport } from './client';
import { isElectron } from '../../utils/environment';

export const TEXT_MODEL_REQUEST_CHANNEL = 'text-model:request';
export const TEXT_MODEL_CANCEL_CHANNEL = 'text-model:cancel';

/** What the page hands the main process. `id` names the request for a cancel. */
export interface TextModelIpcRequest {
  id: string;
  baseUrl: string;
  path: TextModelPath;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

/** What the main process answers: the service's status and body, or why there is none. */
export type TextModelIpcAnswer =
  | { status: number; body: string }
  | { error: 'network' | 'timeout' | 'too_large' | 'refused' | 'cancelled'; message: string };

type Invoke = (channel: string, data?: unknown) => Promise<unknown>;

/** The client's code for each of the main process's failures. An answer too large to read is the service's trouble. */
const CODES: Record<string, TextModelFailureCode> = { network: 'network', timeout: 'timeout', too_large: 'server', refused: 'refused', cancelled: 'network' };

/**
 * Request ids are unique across page loads: the main process keys a request by the page and this id, and a new
 * request under a key still in flight cancels the old one (a reload restarting the count would cancel a stranger).
 */
const LOAD = Math.random().toString(36).slice(2, 10);
let nextId = 0;

/** The transport over the desktop bridge's `invoke`. */
export function desktopTextModelTransport(invoke: Invoke): TextModelTransport {
  return (url, init) => new Promise((resolve, reject) => {
    const { signal } = init;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const path = TEXT_MODEL_PATHS.find((p) => url.endsWith(p));
    if (!path) {
      reject(new TextModelTransportError('refused', 'Only the model list and chat completions are sent to a compatible service.'));
      return;
    }
    nextId += 1;
    const id = `text-model-${LOAD}-${nextId}`;
    const request: TextModelIpcRequest = {
      id, baseUrl: url.slice(0, -path.length), path, method: init.method, headers: init.headers, ...(init.body === undefined ? {} : { body: init.body }),
    };
    const onAbort = () => {
      void invoke(TEXT_MODEL_CANCEL_CHANNEL, { id }).catch(() => {});
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    invoke(TEXT_MODEL_REQUEST_CHANNEL, request).then((raw) => {
      signal.removeEventListener('abort', onAbort);
      const answer = raw as Partial<{ status: unknown; body: unknown; error: unknown; message: unknown }> | null | undefined;
      if (answer && typeof answer.status === 'number' && typeof answer.body === 'string') {
        const body = answer.body;
        resolve({ status: answer.status, text: async () => body });
        return;
      }
      const code = typeof answer?.error === 'string' ? CODES[answer.error] : undefined;
      const message = typeof answer?.message === 'string' ? answer.message : 'The desktop app did not answer the request.';
      reject(new TextModelTransportError(code ?? 'server', code ? message : 'The desktop app did not answer the request.'));
    }, (error: unknown) => {
      signal.removeEventListener('abort', onAbort);
      // The bridge itself refused the call: a blocked channel, an argument that cannot be copied.
      reject(new TextModelTransportError('refused', `The desktop app refused the request: ${error instanceof Error ? error.message : String(error)}`));
    });
  });
}

/** The desktop app's transport, or null anywhere else. */
export function platformTextModelTransport(): TextModelTransport | null {
  const bridge = typeof window !== 'undefined' ? window.electron : undefined;
  if (isElectron() && typeof bridge?.invoke === 'function') return desktopTextModelTransport((channel, data) => bridge.invoke(channel, data));
  return null;
}
