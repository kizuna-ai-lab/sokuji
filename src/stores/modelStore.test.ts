import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelManager } from '../lib/local-inference/ModelManager';
import { ModelImportError } from '../lib/local-inference/modelImport';
import { directionKey } from '../lib/local-inference/selection/types';

// Mock modelManifest functions
const mockGetManifestEntry = vi.fn();
const mockGetAsrModelsForLanguage = vi.fn();
const mockGetTranslationModel = vi.fn();
const mockGetManifestByType = vi.fn();

vi.mock('../lib/local-inference/modelManifest', async () => {
  // Pull the pure readiness/compat predicates from the real module so the store
  // exercises real logic; keep the data-lookup functions mocked.
  const actual = await vi.importActual<any>('../lib/local-inference/modelManifest');
  return {
    MODEL_MANIFEST: [],
    getManifestEntry: (...args: any[]) => mockGetManifestEntry(...args),
    getManifestByType: (...args: any[]) => mockGetManifestByType(...args),
    getAsrModelsForLanguage: (...args: any[]) => mockGetAsrModelsForLanguage(...args),
    getTranslationModel: (...args: any[]) => mockGetTranslationModel(...args),
    getTtsModelsForLanguage: vi.fn(() => []),
    isTranslationModelCompatible: vi.fn(() => true),
    modelUsable: actual.modelUsable,
    isAstCompatible: actual.isAstCompatible,
    // resolve()'s candidates.wasm.ts pulls these two directly (not through
    // modelUsable) so a note can say WHICH half failed. Real implementations —
    // they're pure and only need the (mocked) manifest entry + device inputs.
    deviceReady: actual.deviceReady,
    getModelSizeMb: actual.getModelSizeMb,
  };
});

const mockEstimateStorageUsedBytes = vi.fn();
const mockGetMetadata = vi.fn();

vi.mock('../lib/local-inference/modelStorage', () => ({
  init: vi.fn(),
  getModelStatus: vi.fn(),
  clearAll: vi.fn(),
  estimateStorageUsedBytes: (...args: any[]) => mockEstimateStorageUsedBytes(...args),
  getMetadata: (...args: any[]) => mockGetMetadata(...args),
}));

vi.mock('../lib/local-inference/ModelManager', () => ({
  ModelManager: { getInstance: vi.fn() },
}));

vi.mock('../utils/webgpu', () => ({
  checkWebGPU: vi.fn().mockResolvedValue(false),
}));

const { useModelStore } = await import('./modelStore');

describe('importModel', () => {
  const mockImportModelFiles = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useModelStore.setState({ modelStatuses: {}, downloads: {}, downloadErrors: {}, modelVariants: {} });
    vi.mocked(ModelManager.getInstance).mockReturnValue({
      importModelFiles: mockImportModelFiles,
    } as any);
    mockEstimateStorageUsedBytes.mockResolvedValue(0);
  });

  const oneFile = () => [new File([new Uint8Array([1, 2, 3])], 'config.json')];

  it('marks the model downloaded and records its variant on a successful import', async () => {
    mockImportModelFiles.mockResolvedValue('q4f16');

    await useModelStore.getState().importModel('voxtral-mini-4b-webgpu', oneFile());

    const s = useModelStore.getState();
    expect(s.modelStatuses['voxtral-mini-4b-webgpu']).toBe('downloaded');
    expect(s.modelVariants['voxtral-mini-4b-webgpu']).toBe('q4f16');
    expect(s.downloads['voxtral-mini-4b-webgpu']).toBeUndefined();
    expect(s.downloadErrors['voxtral-mini-4b-webgpu']).toBeUndefined();
  });

  it('records an error with the missing-file list when the import is incomplete', async () => {
    mockImportModelFiles.mockRejectedValue(new ModelImportError(['onnx/decoder.onnx_data']));

    await expect(
      useModelStore.getState().importModel('voxtral-mini-4b-webgpu', oneFile()),
    ).rejects.toBeInstanceOf(ModelImportError);

    const s = useModelStore.getState();
    expect(s.modelStatuses['voxtral-mini-4b-webgpu']).toBe('error');
    expect(s.downloadErrors['voxtral-mini-4b-webgpu']).toMatch(/onnx\/decoder\.onnx_data/);
    expect(s.downloads['voxtral-mini-4b-webgpu']).toBeUndefined();
  });

  it('keeps the model downloaded even if the storage estimate fails afterward', async () => {
    // The import itself succeeded and the files are persisted; a cosmetic
    // storage-estimate failure must NOT flip the model into an error state.
    mockImportModelFiles.mockResolvedValue('q4');
    mockEstimateStorageUsedBytes.mockRejectedValue(new Error('estimate boom'));

    await useModelStore.getState().importModel('voxtral-mini-4b-webgpu', oneFile());

    const s = useModelStore.getState();
    expect(s.modelStatuses['voxtral-mini-4b-webgpu']).toBe('downloaded');
    expect(s.modelVariants['voxtral-mini-4b-webgpu']).toBe('q4');
    expect(s.downloadErrors['voxtral-mini-4b-webgpu']).toBeUndefined();
    expect(s.downloads['voxtral-mini-4b-webgpu']).toBeUndefined();
  });
});

describe('initialize resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelStore.setState({ initialized: false, initError: null });
  });

  it('records initError and stays uninitialized when storage open fails', async () => {
    mockEstimateStorageUsedBytes.mockRejectedValue(
      new DOMException('The requested version (2) is less than the existing version (3).', 'VersionError'),
    );
    await useModelStore.getState().initialize();
    expect(useModelStore.getState().initialized).toBe(false);
    expect(useModelStore.getState().initError).toMatch(/version/i);
  });

  it('retry succeeds once the failure cause is gone', async () => {
    mockEstimateStorageUsedBytes.mockRejectedValueOnce(new Error('boom'));
    await useModelStore.getState().initialize();
    expect(useModelStore.getState().initError).toBe('boom');
    expect(useModelStore.getState().initialized).toBe(false);

    mockEstimateStorageUsedBytes.mockResolvedValue(0);
    await useModelStore.getState().initialize();
    expect(useModelStore.getState().initialized).toBe(true);
    expect(useModelStore.getState().initError).toBeNull();
  });
});

// Review Minor 1 (Task 5 Minor 1): SettingsInitializer and check.ts's
// raceInitialize both call initialize() at startup, ~150ms apart. Without an
// in-flight guard, a second call while the first is still scanning launches
// its OWN independent scan — which can finish later, read a metadata
// snapshot a live download has since changed, and flip it back to
// 'not_downloaded' in the UI on its own schedule. One scan shared by every
// caller while it is pending closes that window.
describe('initialize concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useModelStore.setState({ initialized: false, initError: null, modelStatuses: {} });
    mockGetMetadata.mockResolvedValue(undefined);
  });

  it('runs one scan for two calls made while the first is still pending, and both resolve', async () => {
    let resolveEstimate!: (bytes: number) => void;
    mockEstimateStorageUsedBytes.mockImplementation(
      () => new Promise<number>((resolve) => { resolveEstimate = resolve; }),
    );

    const first = useModelStore.getState().initialize();
    const second = useModelStore.getState().initialize();
    // Both calls share the one scan already in flight: the scanning
    // dependency has not run a second time just because a second caller asked.
    expect(mockEstimateStorageUsedBytes).toHaveBeenCalledTimes(1);

    resolveEstimate(0);
    await Promise.all([first, second]);

    expect(useModelStore.getState().initialized).toBe(true);
    expect(mockEstimateStorageUsedBytes).toHaveBeenCalledTimes(1);
  });

  it('a second call arriving while the scan is pending never starts its own scan (there is none to race a live download)', async () => {
    let resolveEstimate!: (bytes: number) => void;
    mockEstimateStorageUsedBytes.mockImplementation(
      () => new Promise<number>((resolve) => { resolveEstimate = resolve; }),
    );

    const first = useModelStore.getState().initialize();
    // A download starting in the window between the two calls — exactly the
    // race SettingsInitializer and check.ts's raceInitialize hit at startup.
    useModelStore.setState((s) => ({ modelStatuses: { ...s.modelStatuses, 'voxtral-mini-4b-webgpu': 'downloading' } }));
    const second = useModelStore.getState().initialize();

    resolveEstimate(0);
    await Promise.all([first, second]);

    // Only the one scan ever ran, from start to finish: the second call never
    // launched an independent scan that could read a later metadata snapshot
    // and write modelStatuses out from under the live download.
    expect(mockEstimateStorageUsedBytes).toHaveBeenCalledTimes(1);
  });

  it('a scan already finished (initialized) still returns at once, as today', async () => {
    mockEstimateStorageUsedBytes.mockResolvedValue(0);
    await useModelStore.getState().initialize();
    expect(mockEstimateStorageUsedBytes).toHaveBeenCalledTimes(1);

    await useModelStore.getState().initialize();
    expect(mockEstimateStorageUsedBytes).toHaveBeenCalledTimes(1);
  });
});

describe('modelStore.resolve', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Empty manifest by default — later describe blocks in this file leave
    // mockGetManifestByType wired to their own fixtures, and clearAllMocks
    // doesn't reset implementations.
    mockGetManifestByType.mockReturnValue([]);
  });

  it('resolves a direction from the manifest and current download statuses', () => {
    useModelStore.setState({ modelStatuses: {}, webgpuAvailable: false });
    const r = useModelStore.getState().resolve('ja', 'en', {});
    // Nothing downloaded: every local stage is unresolvable.
    expect(r.asr).toBeNull();
    expect(r.notes.some((n) => n.stage === 'asr' && n.reason === 'no-candidate')).toBe(true);
  });

  it('does not mutate the selections object it is given', () => {
    useModelStore.setState({ modelStatuses: {}, webgpuAvailable: false });
    const dir = directionKey('ja', 'en');
    const selections = {
      [dir]: { asr: { modelId: 'x' }, translation: { modelId: 'y' }, tts: { modelId: '' } },
    };
    const before = JSON.stringify(selections);
    useModelStore.getState().resolve('ja', 'en', selections);
    expect(JSON.stringify(selections)).toBe(before);
  });
});
