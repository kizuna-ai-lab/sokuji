// electron/text-model-request.js
//
// A compatible text-model service (OpenRouter, DeepSeek, a local Ollama or LM Studio…), asked from the main process.
// The packaged page's origin is file://, and a third-party server need not answer its CORS preflight, so the page
// hands the request here (src/lib/textModel/desktopTransport.ts) and gets the status and the body back.
//
// Only what the client sends is sent: the base's /models (GET) and /chat/completions (POST), under an https base, or
// an http one on this computer (localhost, 127.0.0.1, [::1]); no name or password, query or fragment in the address
// (src/lib/textModel/address.ts holds the same rules, and address.consistency.test.ts keeps the two the same); the
// headers Authorization, Content-Type and Accept, and nothing else. A request gets 60 seconds and an answer 2 MB; a
// redirect is not followed. The key is used for the request only: no answer, message or log line here repeats it.
'use strict';

/** The endpoints, and the method each is asked with. */
const TEXT_MODEL_PATHS = Object.freeze({ '/models': 'GET', '/chat/completions': 'POST' });
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_ANSWER_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
/** The hosts a compatible service may be reached at over plain http: this computer. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** The headers the client sends, by their lower-case names. */
const HEADERS = new Set(['authorization', 'content-type', 'accept']);
const MAX_HEADER_LENGTH = 8192;
const ID = /^[\w.-]{1,64}$/;

const ADDRESS_WORDS = {
  not_a_url: 'The address is not a web address.',
  not_https: 'The address must start with https:// (http:// only for this computer).',
  has_credentials: 'The address must not hold a name or a password: the key has a field of its own.',
  has_query: 'The address must not hold a query or a fragment (? or #).',
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const refused = (message) => ({ ok: false, message });

/** What is wrong with a base address, or null when it can be used. */
function textModelAddressProblem(baseUrl) {
  let url;
  try {
    url = new URL(String(baseUrl).trim().replace(/\/+$/, ''));
  } catch {
    return 'not_a_url';
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) return 'not_https';
  if (url.username !== '' || url.password !== '') return 'has_credentials';
  if (url.search !== '' || url.hash !== '' || /[?#]/.test(String(baseUrl))) return 'has_query';
  return null;
}

/**
 * The request as it will be sent ({ ok: true, id, url, method, headers, body }), or why it is refused
 * ({ ok: false, message }). The message never repeats what was handed in.
 */
function checkTextModelRequest(payload) {
  if (!isPlainObject(payload)) return refused('The request is not one the desktop app sends.');
  const { id, baseUrl, path, method, headers = {}, body } = payload;
  if (id !== undefined && !(typeof id === 'string' && ID.test(id))) return refused('The request is not one the desktop app sends.');
  if (typeof baseUrl !== 'string' || baseUrl.length > 2048) return refused(ADDRESS_WORDS.not_a_url);
  const problem = textModelAddressProblem(baseUrl);
  if (problem) return refused(ADDRESS_WORDS[problem]);
  if (typeof path !== 'string' || !Object.prototype.hasOwnProperty.call(TEXT_MODEL_PATHS, path)) {
    return refused('Only the model list and chat completions are sent to a compatible service.');
  }
  if (method !== TEXT_MODEL_PATHS[path]) return refused('The request is not one the desktop app sends.');
  if (method === 'GET' ? body !== undefined : typeof body !== 'string') return refused('The request is not one the desktop app sends.');
  if (typeof body === 'string' && Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return refused('The request is too large to send.');
  if (!isPlainObject(headers)) return refused('The request is not one the desktop app sends.');
  const sent = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!HEADERS.has(lower)) return refused('The request carries a header the desktop app does not send.');
    if (typeof value !== 'string' || value.length > MAX_HEADER_LENGTH || /[\r\n\0]/.test(value)) {
      return refused('The request carries a header the desktop app does not send.');
    }
    sent[lower] = value;
  }
  const url = new URL(`${baseUrl.trim().replace(/\/+$/, '')}${path}`);
  if (!url.pathname.endsWith(path)) return refused('Only the model list and chat completions are sent to a compatible service.');
  return { ok: true, id, url: url.href, method, headers: sent, ...(body === undefined ? {} : { body }) };
}

/** The body as text, read up to `maxBytes`: { body }, or { tooLarge: true } once it passes them. */
async function readCapped(response, maxBytes) {
  const reader = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
  if (!reader) {
    const text = await response.text();
    return Buffer.byteLength(text, 'utf8') > maxBytes ? { tooLarge: true } : { body: text };
  }
  const decoder = new TextDecoder('utf-8');
  let size = 0;
  let body = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await Promise.resolve(reader.cancel()).catch(() => {});
      return { tooLarge: true };
    }
    body += decoder.decode(value, { stream: true });
  }
  return { body: body + decoder.decode() };
}

/** Lets an answer that will not be read go. */
function discard(response) {
  try {
    const reader = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
    if (reader) void Promise.resolve(reader.cancel()).catch(() => {});
  } catch {
    // Nothing to let go.
  }
}

/** The system's code for a service that could not be reached (ECONNREFUSED, ENOTFOUND…), never the words around it. */
function systemCodeOf(error) {
  const code = error && error.cause && error.cause.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(code) ? code : null;
}

/**
 * Sends a checked request: { status, body }, or { error, message } with `error` one of network, timeout, too_large,
 * refused (a redirect) and cancelled (`signal` aborted).
 */
async function performTextModelRequest(request, { fetch = globalThis.fetch, signal, timeoutMs = REQUEST_TIMEOUT_MS, maxBytes = MAX_ANSWER_BYTES } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onCancel = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onCancel, { once: true });
  }
  const failure = (error) => {
    if (timedOut) return { error: 'timeout', message: `The service did not answer within ${timeoutMs / 1000} seconds.` };
    if (signal && signal.aborted) return { error: 'cancelled', message: 'The request was cancelled.' };
    const code = systemCodeOf(error);
    return { error: 'network', message: code ? `The service could not be reached (${code}).` : 'The service could not be reached.' };
  };
  try {
    let response;
    try {
      response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      return failure(error);
    }
    if (response.status >= 300 && response.status < 400) {
      discard(response);
      return { error: 'refused', message: 'The service answered with a redirect to another address. Enter the address it names instead.' };
    }
    const declared = Number(response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-length') : NaN);
    const tooLarge = { error: 'too_large', message: `The answer was larger than ${maxBytes === MAX_ANSWER_BYTES ? '2 MB' : `${maxBytes} bytes`}.` };
    if (Number.isFinite(declared) && declared > maxBytes) {
      discard(response);
      return tooLarge;
    }
    try {
      const read = await readCapped(response, maxBytes);
      return read.tooLarge ? tooLarge : { status: response.status, body: read.body };
    } catch (error) {
      return failure(error);
    }
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onCancel);
  }
}

/**
 * Registers `text-model:request` and `text-model:cancel`. Only the main page may ask (`isTrustedSender`); a request
 * that names an id can be cancelled by the same page with that id.
 */
function setupTextModelHandlers({ ipcMain, isTrustedSender, fetch = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS, maxBytes = MAX_ANSWER_BYTES }) {
  /** `<sender id>:<request id>` → the request's cancel. */
  const inFlight = new Map();

  ipcMain.handle('text-model:request', async (event, payload) => {
    if (!isTrustedSender(event.sender)) return { error: 'refused', message: 'This window may not ask a text model.' };
    const request = checkTextModelRequest(payload);
    if (!request.ok) return { error: 'refused', message: request.message };
    const key = request.id === undefined ? null : `${event.sender.id}:${request.id}`;
    const cancel = new AbortController();
    if (key) {
      const earlier = inFlight.get(key);
      if (earlier) earlier.abort();
      inFlight.set(key, cancel);
    }
    try {
      return await performTextModelRequest(request, { fetch, signal: cancel.signal, timeoutMs, maxBytes });
    } finally {
      if (key && inFlight.get(key) === cancel) inFlight.delete(key);
    }
  });

  ipcMain.handle('text-model:cancel', async (event, payload) => {
    if (!isTrustedSender(event.sender)) return false;
    const id = isPlainObject(payload) ? payload.id : undefined;
    if (typeof id !== 'string' || !ID.test(id)) return false;
    const cancel = inFlight.get(`${event.sender.id}:${id}`);
    if (!cancel) return false;
    cancel.abort();
    return true;
  });
}

module.exports = {
  setupTextModelHandlers,
  checkTextModelRequest,
  performTextModelRequest,
  textModelAddressProblem,
  TEXT_MODEL_PATHS,
  REQUEST_TIMEOUT_MS,
  MAX_ANSWER_BYTES,
};
