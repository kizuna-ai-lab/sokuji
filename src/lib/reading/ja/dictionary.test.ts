// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { getFile, storeFile, clearAll } from '../../local-inference/modelStorage';
import {
  DICTIONARY_BYTES, DICTIONARY_FILE, DICTIONARY_SHA256, DICTIONARY_SOURCE_URL, DICTIONARY_STORE_ID, DICTIONARY_URL, DictionaryIntegrityError,
  LINDERA_VERSION, downloadDictionary, isDictionaryStored, storedDictionary,
} from './dictionary';
import { DICTIONARY_BYTES as CHECKED_DICTIONARY_BYTES, LINDERA_WASM_BYTES } from '../../../../scripts/check-lindera-assets.mjs';

const BYTES = new TextEncoder().encode('fake lindera dictionary zip');
const expected = { bytes: BYTES.length, sha256: createHash('sha256').update(BYTES).digest('hex') };
const respond = (body: Uint8Array | string, status = 200) =>
  vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(body as BodyInit, { status }));
const noSleep = async () => {};

describe('the Japanese dictionary', () => {
  beforeEach(async () => { await clearAll(); });

  it('downloads from the pinned URL, checks it, stores it and reports progress against the pinned size', async () => {
    const fetchImpl = respond(BYTES);
    const progress = vi.fn();
    const buf = await downloadDictionary({ signal: new AbortController().signal, fetchImpl, expected, onProgress: progress, sleep: noSleep });
    expect(new Uint8Array(buf)).toEqual(BYTES);
    expect(fetchImpl.mock.calls[0][0]).toBe(DICTIONARY_URL);
    expect(progress).toHaveBeenLastCalledWith(BYTES.length, BYTES.length);
    expect((await getFile(DICTIONARY_STORE_ID, DICTIONARY_FILE))?.size).toBe(BYTES.length);
    expect(new Uint8Array((await storedDictionary(BYTES.length))!)).toEqual(BYTES);
  });

  it("refuses the site's index.html answered with 200 for a missing path, stores nothing, and does not retry", async () => {
    const fetchImpl = respond('<!doctype html><title>Sokuji</title>');
    await expect(downloadDictionary({ signal: new AbortController().signal, fetchImpl, expected, sleep: noSleep }))
      .rejects.toBeInstanceOf(DictionaryIntegrityError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await getFile(DICTIONARY_STORE_ID, DICTIONARY_FILE)).toBeUndefined();
  });

  it('refuses bytes of the right size but the wrong hash', async () => {
    const wrong = new Uint8Array(BYTES.length).fill(7);
    await expect(downloadDictionary({ signal: new AbortController().signal, fetchImpl: respond(wrong), expected, sleep: noSleep }))
      .rejects.toThrow(/SHA-256/);
  });

  it('retries a failed request', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(BYTES, { status: 200 }));
    await downloadDictionary({ signal: new AbortController().signal, fetchImpl, expected, sleep: noSleep });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects with an AbortError when aborted, and stores nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(downloadDictionary({ signal: controller.signal, fetchImpl: respond(BYTES), expected, sleep: noSleep }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(await getFile(DICTIONARY_STORE_ID, DICTIONARY_FILE)).toBeUndefined();
  });

  it('deletes an older version, such as the wasm releases up to 0.46.x stored, when it stores a new one', async () => {
    await storeFile(DICTIONARY_STORE_ID, 'lindera-ipadic-2.3.4.wasm', new Blob(['old']));
    await downloadDictionary({ signal: new AbortController().signal, fetchImpl: respond(BYTES), expected, sleep: noSleep });
    expect(await getFile(DICTIONARY_STORE_ID, 'lindera-ipadic-2.3.4.wasm')).toBeUndefined();
  });

  it('treats a stored file of another size as not stored', async () => {
    await storeFile(DICTIONARY_STORE_ID, DICTIONARY_FILE, new Blob(['short']));
    expect(await storedDictionary(BYTES.length)).toBeNull();
    expect(await isDictionaryStored(BYTES.length)).toBe(false);
  });

  it('says whether the dictionary is stored at the pinned size without reading its bytes', async () => {
    expect(await isDictionaryStored(BYTES.length)).toBe(false);
    await storeFile(DICTIONARY_STORE_ID, DICTIONARY_FILE, new Blob([BYTES]));
    const read = vi.spyOn(Blob.prototype, 'arrayBuffer');
    try {
      expect(await isDictionaryStored(BYTES.length)).toBe(true);
      expect(read).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });
});

describe('the pinned dictionary', () => {
  it("is Lindera 6.2.0's IPADIC archive, by the size and SHA-256 of its GitHub release, served by sokuji-backend", () => {
    expect(LINDERA_VERSION).toBe('6.2.0');
    expect(DICTIONARY_FILE).toBe('lindera-ipadic-6.2.0.zip');
    expect(DICTIONARY_URL).toBe('https://sokuji.kizuna.ai/reading/lindera-ipadic-6.2.0.zip');
    expect(DICTIONARY_SOURCE_URL).toBe('https://github.com/lindera/lindera/releases/download/v6.2.0/lindera-ipadic-6.2.0.zip');
    expect(DICTIONARY_BYTES).toBe(10_519_550);
    expect(DICTIONARY_SHA256).toBe('5ed4bba6b429030b0387df67d40d5751d35dedef0306f4bac6d957cad5f04b72');
  });

  it('is what the build check keeps out of the app, which keeps in the wasm the installed lindera-wasm ships', () => {
    expect(CHECKED_DICTIONARY_BYTES).toBe(DICTIONARY_BYTES);
    const require = createRequire(import.meta.url);
    const wasm = join(dirname(require.resolve('lindera-wasm')), 'lindera_wasm_bg.wasm');
    expect(LINDERA_WASM_BYTES).toBe(statSync(wasm).size);
  });
});
