import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBlobUrlCache } from './blob-url-cache';

describe('createBlobUrlCache', () => {
  const fileUrls = { 'config.json': 'blob:abc', 'onnx/model.onnx': 'blob:def' };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('resolves an HF /resolve/main/ URL to a fetch of the mapped blob URL', async () => {
    const cache = createBlobUrlCache(fileUrls);
    await cache.match('https://huggingface.co/org/model/resolve/main/config.json');
    expect(fetchMock).toHaveBeenCalledWith('blob:abc');
  });

  it('resolves nested paths after /resolve/main/', async () => {
    const cache = createBlobUrlCache(fileUrls);
    await cache.match('https://huggingface.co/org/model/resolve/main/onnx/model.onnx');
    expect(fetchMock).toHaveBeenCalledWith('blob:def');
  });

  it('returns undefined for a file not in the map (no fetch)', async () => {
    const cache = createBlobUrlCache(fileUrls);
    expect(await cache.match('https://huggingface.co/org/model/resolve/main/missing.bin')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns undefined for a non-HF URL (no /resolve/main/)', async () => {
    const cache = createBlobUrlCache(fileUrls);
    expect(await cache.match('https://example.com/config.json')).toBeUndefined();
  });

  it('returns undefined for an empty request', async () => {
    const cache = createBlobUrlCache(fileUrls);
    expect(await cache.match(undefined)).toBeUndefined();
  });

  it('reads .url from a Request-like object', async () => {
    const cache = createBlobUrlCache(fileUrls);
    await cache.match({ url: 'https://huggingface.co/o/m/resolve/main/config.json' } as unknown as Request);
    expect(fetchMock).toHaveBeenCalledWith('blob:abc');
  });

  it('put is a no-op that resolves to undefined', async () => {
    const cache = createBlobUrlCache(fileUrls);
    await expect(cache.put('x', {} as Response)).resolves.toBeUndefined();
  });
});
