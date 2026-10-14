import { deleteModelFiles, getFile, storeFile } from '../../local-inference/modelStorage';
import { fetchWithConnectTimeout, readStreamToBlob, retryWithBackoff } from '../../local-inference/downloadRetry';

// Lindera's wasm carries the IPADIC dictionary. sokuji-backend serves it
// (web/scripts/reading-assets.mjs pins the same size and hash); a path it does
// not have answers 200 with the site's index.html, so size and hash are checked.
export const LINDERA_VERSION = '2.3.4';
export const DICTIONARY_FILE = `lindera-ipadic-${LINDERA_VERSION}.wasm`;
export const DICTIONARY_URL = `https://sokuji.kizuna.ai/reading/${DICTIONARY_FILE}`;
export const DICTIONARY_BYTES = 17_750_350;
export const DICTIONARY_SHA256 = 'b37152451a13018def64d50c2f48f5d819a75fefff7bdaef039525b32aa129ac';
/** Its key prefix in `sokuji-models`. No metadata is written, so the Models UI does not list it. */
export const DICTIONARY_STORE_ID = 'reading-ja-lindera';

export class DictionaryIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DictionaryIntegrityError';
  }
}

export interface DictionaryOptions {
  signal: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  fetchImpl?: typeof fetch;
  expected?: { bytes: number; sha256: string };
  sleep?: (ms: number) => Promise<void>;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The stored dictionary's bytes, or null when it is not stored at the size this version pins. */
export async function storedDictionary(expectedBytes = DICTIONARY_BYTES): Promise<ArrayBuffer | null> {
  const blob = await getFile(DICTIONARY_STORE_ID, DICTIONARY_FILE);
  if (!blob || blob.size !== expectedBytes) return null;
  return blob.arrayBuffer();
}

/** Downloads, checks and stores the dictionary, replacing any other version; resolves with its bytes. */
export async function downloadDictionary(opts: DictionaryOptions): Promise<ArrayBuffer> {
  const { signal, onProgress, fetchImpl, sleep } = opts;
  const expected = opts.expected ?? { bytes: DICTIONARY_BYTES, sha256: DICTIONARY_SHA256 };
  const bytes = await retryWithBackoff(async () => {
    const res = await fetchWithConnectTimeout(DICTIONARY_URL, { timeoutMs: 30_000, signal, fetchImpl });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${DICTIONARY_URL}`);
    const blob = await readStreamToBlob(res.body.getReader(), {
      stallTimeoutMs: 30_000,
      signal,
      onProgress: (done) => onProgress?.(done, expected.bytes),
    });
    const buf = await blob.arrayBuffer();
    if (buf.byteLength !== expected.bytes) {
      throw new DictionaryIntegrityError(`Expected ${expected.bytes} bytes from ${DICTIONARY_URL}, got ${buf.byteLength}`);
    }
    if ((await sha256Hex(buf)) !== expected.sha256) {
      throw new DictionaryIntegrityError(`SHA-256 of ${DICTIONARY_URL} does not match the pinned one`);
    }
    return buf;
  }, {
    attempts: 3,
    backoffsMs: [1_000, 3_000],
    sleep,
    shouldRetry: (err) => (err as Error)?.name !== 'AbortError' && !(err instanceof DictionaryIntegrityError),
  });
  await deleteModelFiles(DICTIONARY_STORE_ID);
  await storeFile(DICTIONARY_STORE_ID, DICTIONARY_FILE, new Blob([bytes], { type: 'application/wasm' }));
  return bytes;
}
