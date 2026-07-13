import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (real: modelImport, so matching logic is exercised) ────────────────

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
  variants: {
    v: {
      dtype: 'q4',
      files: [
        { filename: 'config.json', sizeBytes: 10 },
        { filename: 'onnx/a.onnx', sizeBytes: 100 },
      ],
    },
  },
};

vi.mock('./modelManifest', () => ({
  getManifestEntry: vi.fn(() => entry),
  selectVariant: vi.fn(() => 'v'),
  getBaselineVariant: vi.fn(() => 'v'),
  getModelDownloadUrl: vi.fn((e: any, f: string) =>
    e.hfModelId ? `https://huggingface.co/${e.hfModelId}/resolve/main/${f}` : `https://cdn/${f}`,
  ),
}));

const mockValidate = vi.fn();
class FakeValidationError extends Error {
  constructor(m: string) { super(m); this.name = 'ModelFileValidationError'; }
}
vi.mock('./modelFileValidation', () => ({
  validateModelFile: (...a: any[]) => mockValidate(...a),
  ModelFileValidationError: FakeValidationError,
}));

vi.mock('../../utils/webgpu', () => ({
  getDeviceFeatures: vi.fn(() => []),
}));

const { ModelManager } = await import('./ModelManager');

const blob = (b: number[]) => new Blob([new Uint8Array(b)]);

describe('ModelManager.importModelFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFile.mockResolvedValue(false);
    mockSetMetadata.mockResolvedValue(undefined);
    mockStoreFile.mockResolvedValue(undefined);
    mockValidate.mockResolvedValue(undefined);
  });

  it('stores all provided files and marks the model downloaded', async () => {
    const mgr = ModelManager.getInstance();
    const provided = new Map<string, Blob>([
      ['config.json', blob([0x7b])],
      ['onnx/a.onnx', blob([0x08])],
    ]);

    await mgr.importModelFiles('m', provided);

    expect(mockStoreFile).toHaveBeenCalledWith('m', 'config.json', provided.get('config.json'));
    expect(mockStoreFile).toHaveBeenCalledWith('m', 'onnx/a.onnx', provided.get('onnx/a.onnx'));
    expect(mockValidate).toHaveBeenCalledTimes(2);
    const meta = mockSetMetadata.mock.calls.at(-1)![1];
    expect(meta.status).toBe('downloaded');
    expect(meta.totalSizeBytes).toBe(110);
    expect(meta.variant).toBe('v');
  });

  it('maps directory-pick paths to the expected filenames when storing', async () => {
    const mgr = ModelManager.getInstance();
    const cfg = blob([0x7b]);
    const onnx = blob([0x08]);
    const provided = new Map<string, Blob>([
      ['Voxtral-Repo/config.json', cfg],
      ['Voxtral-Repo/onnx/a.onnx', onnx],
    ]);

    await mgr.importModelFiles('m', provided);

    expect(mockStoreFile).toHaveBeenCalledWith('m', 'config.json', cfg);
    expect(mockStoreFile).toHaveBeenCalledWith('m', 'onnx/a.onnx', onnx);
    expect(mockSetMetadata.mock.calls.at(-1)![1].status).toBe('downloaded');
  });

  it('throws ModelImportError listing missing files on a partial import', async () => {
    const mgr = ModelManager.getInstance();
    const provided = new Map<string, Blob>([['config.json', blob([0x7b])]]);

    await expect(mgr.importModelFiles('m', provided)).rejects.toMatchObject({
      name: 'ModelImportError',
      missing: ['onnx/a.onnx'],
    });
    // The one provided file is still written (enables completing the import later).
    expect(mockStoreFile).toHaveBeenCalledWith('m', 'config.json', provided.get('config.json'));
    // Not marked downloaded...
    const statuses = mockSetMetadata.mock.calls.map((c) => c[1].status);
    expect(statuses).not.toContain('downloaded');
    // ...but persisted as errored so the incomplete state (and its files) survive
    // a restart and stay reclaimable via the card's delete button.
    expect(statuses).toContain('error');
  });

  it('persists error metadata when a storeFile fails mid-import (written files stay reclaimable)', async () => {
    const mgr = ModelManager.getInstance();
    // config.json stores fine; the onnx file rejects (e.g. IndexedDB quota).
    mockStoreFile.mockImplementation(async (_id: string, name: string) => {
      if (name === 'onnx/a.onnx') throw new Error('QuotaExceededError');
    });
    const provided = new Map<string, Blob>([
      ['config.json', blob([0x7b])],
      ['onnx/a.onnx', blob([0x08])],
    ]);

    await expect(mgr.importModelFiles('m', provided)).rejects.toThrow('QuotaExceededError');

    // config.json was written before the failure, so the incomplete model must
    // be persisted as `error` (reclaimable via the card's delete button), not
    // stranded with no metadata.
    const statuses = mockSetMetadata.mock.calls.map((c) => c[1].status);
    expect(statuses).toContain('error');
    expect(statuses).not.toContain('downloaded');
  });

  it('completes an import when the remaining files were stored by a prior import', async () => {
    const mgr = ModelManager.getInstance();
    // config.json is already in storage; user now supplies only the onnx file.
    mockHasFile.mockImplementation(async (_id: string, name: string) => name === 'config.json');
    const provided = new Map<string, Blob>([['onnx/a.onnx', blob([0x08])]]);

    await mgr.importModelFiles('m', provided);

    expect(mockStoreFile).toHaveBeenCalledWith('m', 'onnx/a.onnx', provided.get('onnx/a.onnx'));
    expect(mockStoreFile).toHaveBeenCalledTimes(1);
    expect(mockSetMetadata.mock.calls.at(-1)![1].status).toBe('downloaded');
  });

  it('propagates a validation failure and does not mark the model downloaded', async () => {
    const mgr = ModelManager.getInstance();
    mockValidate.mockImplementation(async (name: string) => {
      if (name === 'onnx/a.onnx') throw new FakeValidationError('size 40% off');
    });
    const provided = new Map<string, Blob>([
      ['config.json', blob([0x7b])],
      ['onnx/a.onnx', blob([0x00])],
    ]);

    await expect(mgr.importModelFiles('m', provided)).rejects.toHaveProperty(
      'name',
      'ModelFileValidationError',
    );
    const statuses = mockSetMetadata.mock.calls.map((c) => c[1].status);
    expect(statuses).not.toContain('downloaded');
  });
});

describe('ModelManager.getModelFileTargets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists each expected file with its download URL and the source repo', () => {
    const mgr = ModelManager.getInstance();
    const targets = mgr.getModelFileTargets('m');

    expect(targets.repo).toBe('org/repo');
    expect(targets.variant).toBe('v');
    expect(targets.files).toEqual([
      { filename: 'config.json', url: 'https://huggingface.co/org/repo/resolve/main/config.json', sizeBytes: 10 },
      { filename: 'onnx/a.onnx', url: 'https://huggingface.co/org/repo/resolve/main/onnx/a.onnx', sizeBytes: 100 },
    ]);
  });
});
