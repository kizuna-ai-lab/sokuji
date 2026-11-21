// src/lib/textModel/address.ts
//
// The address of a compatible service, as the user enters it: the base its `/models` and `/chat/completions` hang
// from (`https://openrouter.ai/api/v1`, `http://localhost:11434/v1`). The desktop app's main process sends these
// requests and holds the same rules (`electron/text-model-request.js`; `address.consistency.test.ts` keeps the two
// the same): https anywhere, plain http to this computer only, and nothing in the address that is not an address.

/** The hosts a compatible service may be reached at over plain http: this computer. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Why an address cannot be used: not an address, not https off this computer, a name and password in it, a query or fragment. */
export type AddressProblem = 'not_a_url' | 'not_https' | 'has_credentials' | 'has_query';

/** The endpoints the client sends to, under the base. */
export const TEXT_MODEL_PATHS = ['/models', '/chat/completions'] as const;
export type TextModelPath = (typeof TEXT_MODEL_PATHS)[number];

/**
 * The address as the client uses it: trimmed, without trailing slashes, and without an endpoint the user pasted with
 * it (`…/v1/chat/completions` is read as `…/v1`). An address that already ends with `/v1` is kept as it is: nothing is
 * added to an address.
 */
export function normaliseBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  for (const path of TEXT_MODEL_PATHS) {
    if (url.endsWith(path)) url = url.slice(0, -path.length).replace(/\/+$/, '');
  }
  return url;
}

/** What is wrong with the address, as `normaliseBaseUrl` reads it, or null when it can be used. */
export function compatibleAddressProblem(raw: string): AddressProblem | null {
  // Before the endpoint is stripped: `…/v1#/models` would read as `…/v1#`, whose fragment is empty.
  if (/[?#]/.test(raw)) return 'has_query';
  let url: URL;
  try {
    url = new URL(normaliseBaseUrl(raw));
  } catch {
    return 'not_a_url';
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) return 'not_https';
  if (url.username !== '' || url.password !== '') return 'has_credentials';
  if (url.search !== '' || url.hash !== '') return 'has_query';
  return null;
}
