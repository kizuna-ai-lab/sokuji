/**
 * customCache bridge for Transformers.js: resolves the HuggingFace Hub
 * ".../resolve/main/<path>" URLs it requests to the pre-downloaded IndexedDB
 * blob URLs passed in `fileUrls`, so no network request leaves the worker.
 * `put` is a no-op — the files already live in IndexedDB.
 *
 * This is the single behavioural definition of the bridge; the 10 transformers.js
 * workers each used to carry a byte-identical copy.
 */
export function createBlobUrlCache(fileUrls: Record<string, string>) {
  return {
    async match(request: string | Request | undefined): Promise<Response | undefined> {
      if (!request) return undefined;
      const url = typeof request === 'string' ? request : request.url;
      const marker = '/resolve/main/';
      const idx = url.indexOf(marker);
      if (idx === -1) return undefined;
      const filename = url.slice(idx + marker.length);
      const blobUrl = fileUrls[filename];
      if (!blobUrl) return undefined;
      return fetch(blobUrl);
    },
    async put(_request: string | Request, _response: Response): Promise<void> {},
  };
}
