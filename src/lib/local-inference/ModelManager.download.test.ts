import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Module mocks (real: downloadRetry, so the timeout/retry wiring is exercised) ──

const mockSetMetadata = vi.fn();
const mockHasFile = vi.fn();
const mockStoreFile = vi.fn();
const mockGetMetadata = vi.fn();

vi.mock('./modelStorage', () => ({
  setMetadata: (...a: any[]) => mockSetMetadata(...a),
  hasFile: (...a: any[]) => mockHasFile(...a),
  storeFile: (...a: any[]) => mockStoreFile(...a),
  getMetadata: (...a: any[]) => mockGetMetadata(...a),
  hasAllFiles: vi.fn(),
  deleteModel: vi.fn(),
  getFile: vi.fn(),
}));

const entry = {
  id: 'm',
  type: 'asr-stream',
  hfModelId: 'org/repo',
  variants: { v: { dtype: 'q4', files: [{ filename: 'f.onnx', sizeBytes: 100 }] } },
};

vi.mock('./modelManifest', () => ({
  getManifestEntry: vi.fn(() => entry),
  selectVariant: vi.fn(() => 'v'),
  getBaselineVariant: vi.fn(() => 'v'),
  getModelDownloadUrl: vi.fn((_e: any, f: string) => `https://cdn.test/${f}`),
}));

const mockValidate = vi.fn();
vi.mock('./modelFileValidation', () => ({
  validateModelFile: (...a: any[]) => mockValidate(...a),
  ModelFileValidationError: class ModelFileValidationError extends Error {},
}));

vi.mock('../../utils/webgpu', () => ({
  getDeviceFeatures: vi.fn(() => []),
}));

const { ModelManager } = await import('./ModelManager');

// ─── Fake fetch responses ─────────────────────────────────────────────────────

/** A Response whose body streams the given chunks then completes. */
function okResponse(chunks: Uint8Array[]) {
  let i = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () =>
          i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined },
        cancel: async () => {},
      }),
    },
  } as any;
}

/** A Response that streams one chunk then hangs forever (stalled stream). */
function stallingResponse(firstChunk: Uint8Array) {
  let served = false;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (!served) {
            served = true;
            return { done: false, value: firstChunk };
          }
          return new Promise<{ done: boolean; value?: Uint8Array }>(() => {});
        },
        cancel: async () => {},
      }),
    },
  } as any;
}

/** A fetch that only settles when its signal aborts — models a black-holed connect. */
const hangingFetch = vi.fn((_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  }),
);

const fastTuning = { connectTimeoutMs: 15, stallTimeoutMs: 15, attempts: 2, backoffsMs: [1] };

describe('ModelManager.downloadModel resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFile.mockResolvedValue(false);
    mockSetMetadata.mockResolvedValue(undefined);
    mockStoreFile.mockResolvedValue(undefined);
    mockGetMetadata.mockResolvedValue(undefined);
    mockValidate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('converts a black-holed connect into a friendly error and marks the model errored', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const mgr = ModelManager.getInstance();

    await expect(mgr.downloadModel('m', undefined, fastTuning as any))
      .rejects.toThrow(/blocked on your network/i);

    const statuses = mockSetMetadata.mock.calls.map((c) => c[1].status);
    expect(statuses).toContain('error');
  }, 4000);

  it('converts a mid-stream stall into a friendly error and marks the model errored', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => stallingResponse(new Uint8Array([1, 2, 3]))));
    const mgr = ModelManager.getInstance();

    await expect(mgr.downloadModel('m', undefined, fastTuning as any))
      .rejects.toThrow(/blocked on your network/i);

    const statuses = mockSetMetadata.mock.calls.map((c) => c[1].status);
    expect(statuses).toContain('error');
  }, 4000);

  it('retries a transient network failure and completes the download', async () => {
    let calls = 0;
    const flaky = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new TypeError('Failed to fetch');
      return okResponse([new Uint8Array([0x08, 0, 0, 0])]);
    });
    vi.stubGlobal('fetch', flaky);
    const mgr = ModelManager.getInstance();

    const variant = await mgr.downloadModel('m', undefined, {
      connectTimeoutMs: 1000,
      stallTimeoutMs: 1000,
      attempts: 3,
      backoffsMs: [1, 1],
    } as any);

    expect(variant).toBe('v');
    expect(calls).toBe(3);
    expect(mockStoreFile).toHaveBeenCalledWith('m', 'f.onnx', expect.anything());
    expect(mockValidate).toHaveBeenCalled();
    const statuses = mockSetMetadata.mock.calls.map((c) => c[1].status);
    expect(statuses).toContain('downloaded');
  }, 4000);

  it('does not retry or mark errored when the user cancels', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const mgr = ModelManager.getInstance();

    const promise = mgr.downloadModel('m', undefined, {
      connectTimeoutMs: 5000,
      stallTimeoutMs: 5000,
      attempts: 3,
      backoffsMs: [1],
    } as any);
    setTimeout(() => mgr.cancelDownload('m'), 20);

    await expect(promise).rejects.toHaveProperty('name', 'AbortError');
    const statuses = mockSetMetadata.mock.calls.map((c) => c[1].status);
    expect(statuses).not.toContain('error');
  }, 4000);
});
