import { describe, it, expect } from 'vitest';
import {
  DownloadTimeoutError,
  retryWithBackoff,
  fetchWithConnectTimeout,
  readStreamToBlob,
  type ChunkReader,
} from './downloadRetry';

// A ChunkReader that yields the given chunks, then `done`, then (optionally)
// hangs forever on the next read() to simulate a stalled stream.
function fakeReader(chunks: Uint8Array[], opts: { hangAfter?: boolean } = {}): ChunkReader & { cancelled: boolean } {
  let i = 0;
  const state = {
    cancelled: false,
    async read() {
      if (i < chunks.length) {
        return { done: false, value: chunks[i++] };
      }
      if (opts.hangAfter) {
        return new Promise<{ done: boolean; value?: Uint8Array }>(() => {
          /* never resolves — simulates a black-holed connection */
        });
      }
      return { done: true, value: undefined };
    },
    async cancel() {
      state.cancelled = true;
    },
  };
  return state;
}

describe('retryWithBackoff', () => {
  it('retries a failing operation and succeeds on the third attempt', async () => {
    let attempts = 0;
    const op = async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return 'success';
    };

    const result = await retryWithBackoff(op, { attempts: 3, backoffsMs: [1, 1] });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('rethrows after exhausting all attempts', async () => {
    let attempts = 0;
    const op = async () => {
      attempts++;
      throw new Error('always fails');
    };

    await expect(retryWithBackoff(op, { attempts: 3, backoffsMs: [1, 1] }))
      .rejects.toThrow('always fails');
    expect(attempts).toBe(3);
  });

  it('does not retry when shouldRetry returns false (e.g. user cancel)', async () => {
    let attempts = 0;
    const op = async () => {
      attempts++;
      throw new DOMException('cancelled', 'AbortError');
    };

    await expect(
      retryWithBackoff(op, {
        attempts: 3,
        backoffsMs: [1, 1],
        shouldRetry: (err) => (err as Error).name !== 'AbortError',
      }),
    ).rejects.toHaveProperty('name', 'AbortError');
    expect(attempts).toBe(1);
  });
});

describe('fetchWithConnectTimeout', () => {
  it('rejects with DownloadTimeoutError when the response never arrives', async () => {
    // fetch that only settles when aborted — models a black-holed TLS connect.
    const hangingFetch = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as unknown as typeof fetch;

    await expect(
      fetchWithConnectTimeout('https://example.test/model', {
        timeoutMs: 20,
        fetchImpl: hangingFetch,
      }),
    ).rejects.toBeInstanceOf(DownloadTimeoutError);
  });

  it('returns the response when it arrives before the timeout', async () => {
    const res = new Response('ok', { status: 200 });
    const okFetch = (async () => res) as unknown as typeof fetch;

    const result = await fetchWithConnectTimeout('https://example.test/model', {
      timeoutMs: 1000,
      fetchImpl: okFetch,
    });

    expect(result).toBe(res);
  });

  it('rejects with an AbortError (not a timeout) when the user cancels', async () => {
    const controller = new AbortController();
    const hangingFetch = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      })) as unknown as typeof fetch;

    const promise = fetchWithConnectTimeout('https://example.test/model', {
      timeoutMs: 1000,
      signal: controller.signal,
      fetchImpl: hangingFetch,
    });
    controller.abort();

    await expect(promise).rejects.toHaveProperty('name', 'AbortError');
    await expect(promise).rejects.not.toBeInstanceOf(DownloadTimeoutError);
  });
});

describe('readStreamToBlob', () => {
  it('concatenates chunks into a blob and reports cumulative progress', async () => {
    const reader = fakeReader([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
    const progress: number[] = [];

    const blob = await readStreamToBlob(reader, {
      stallTimeoutMs: 1000,
      onProgress: (n) => progress.push(n),
    });

    // Total size + cumulative progress prove both chunks were read in order and
    // accumulated. (Byte-for-byte concatenation is a `new Blob()` platform
    // guarantee, and jsdom's Blob can't be read back here.)
    expect(blob.size).toBe(5);
    expect(progress).toEqual([3, 5]);
  });

  it('rejects with DownloadTimeoutError and cancels the reader when the stream stalls', async () => {
    const reader = fakeReader([new Uint8Array([1, 2, 3])], { hangAfter: true });

    await expect(
      readStreamToBlob(reader, { stallTimeoutMs: 20 }),
    ).rejects.toBeInstanceOf(DownloadTimeoutError);
    expect(reader.cancelled).toBe(true);
  });

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const reader = fakeReader([new Uint8Array([1, 2, 3])], { hangAfter: true });
    const controller = new AbortController();
    controller.abort();

    await expect(
      readStreamToBlob(reader, { stallTimeoutMs: 1000, signal: controller.signal }),
    ).rejects.toHaveProperty('name', 'AbortError');
  });

  it('registers at most one abort listener regardless of chunk count', async () => {
    // A large download reads thousands of chunks; the abort listener must be
    // registered ONCE for the whole stream and cleaned up on completion — not
    // once per chunk (a {once:true} listener is only auto-removed if it fires,
    // so per-chunk registration leaks a listener per chunk).
    const reader = fakeReader(Array.from({ length: 6 }, (_, k) => new Uint8Array([k])));
    let added = 0;
    let removed = 0;
    const signal = {
      aborted: false,
      addEventListener: (type: string) => { if (type === 'abort') added++; },
      removeEventListener: (type: string) => { if (type === 'abort') removed++; },
    } as unknown as AbortSignal;

    await readStreamToBlob(reader, { stallTimeoutMs: 1000, signal });

    expect(added).toBeLessThanOrEqual(1);
    expect(added - removed).toBe(0);
  });
});
