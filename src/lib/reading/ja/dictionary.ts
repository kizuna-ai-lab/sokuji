import { deleteModelFiles, getFile, storeFile } from '../../local-inference/modelStorage';
import { fetchWithConnectTimeout, readStreamToBlob, retryWithBackoff } from '../../local-inference/downloadRetry';

// Lindera's wasm ships in the build (lindera.worker.ts; scripts/check-lindera-assets.mjs
// checks every build has it). Its IPADIC dictionary is data, downloaded here: the
// zip Lindera releases, served by sokuji-backend (web/scripts/reading-assets.mjs
// pins the same size and hash); a path it does not have answers 200 with the
// site's index.html, so size and hash are checked. The wasm and the dictionary
// must be the same Lindera version: one built for another is refused when loaded.
export const LINDERA_VERSION = '6.2.0';
export const DICTIONARY_FILE = `lindera-ipadic-${LINDERA_VERSION}.zip`;
export const DICTIONARY_URL = `https://sokuji.kizuna.ai/reading/${DICTIONARY_FILE}`;
/** Where the backend takes the file from; the Lindera integration test fetches it from here too. */
export const DICTIONARY_SOURCE_URL = `https://github.com/lindera/lindera/releases/download/v${LINDERA_VERSION}/${DICTIONARY_FILE}`;
export const DICTIONARY_BYTES = 10_519_550;
export const DICTIONARY_SHA256 = '5ed4bba6b429030b0387df67d40d5751d35dedef0306f4bac6d957cad5f04b72';
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

async function storedBlob(expectedBytes: number): Promise<Blob | null> {
  const blob = await getFile(DICTIONARY_STORE_ID, DICTIONARY_FILE);
  return blob && blob.size === expectedBytes ? blob : null;
}

/** Whether the dictionary is stored at the size this version pins; reads none of its bytes. */
export async function isDictionaryStored(expectedBytes = DICTIONARY_BYTES): Promise<boolean> {
  return (await storedBlob(expectedBytes)) !== null;
}

/** The stored dictionary's bytes, or null when it is not stored at the size this version pins. */
export async function storedDictionary(expectedBytes = DICTIONARY_BYTES): Promise<ArrayBuffer | null> {
  const blob = await storedBlob(expectedBytes);
  return blob ? blob.arrayBuffer() : null;
}

/**
 * Downloads, checks and stores the dictionary, replacing any other version (the
 * wasm that releases up to 0.46.x stored included); resolves with its bytes.
 */
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
  await storeFile(DICTIONARY_STORE_ID, DICTIONARY_FILE, new Blob([bytes], { type: 'application/zip' }));
  return bytes;
}
