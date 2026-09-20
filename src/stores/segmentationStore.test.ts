import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('../lib/local-inference/ModelManager', () => ({
  ModelManager: { getInstance: vi.fn() },
}));

vi.mock('../lib/local-inference/modelStorage', async () => {
  const actual = await vi.importActual<any>('../lib/local-inference/modelStorage');
  return { ...actual, estimateStorageUsedBytes: () => mockEstimate() };
});

vi.mock('../lib/diagnostics/report', async () => {
  const actual = await vi.importActual<any>('../lib/diagnostics/report');
  return { ...actual, reportWarning: (...args: any[]) => mockReportWarning(...args) };
});

const mockReportWarning = vi.fn();
const mockEstimate = vi.fn(async () => 0);

const { ModelManager } = await import('../lib/local-inference/ModelManager');
const { useModelStore } = await import('./modelStore');
const {
  useSegmentationStore, PACK_MODELS, PACK_TOTAL_BYTES,
  useSegmentationPhase, useSegmentationProgress,
} = await import('./segmentationStore');

const ZH = 'punct-zh-fireredpunc';
const EN = 'punct-en-edge';
const SAT = 'punct-multi-sat';

/** Byte totals of each model's manifest file list, as the pack sees them. */
const BYTES: Record<string, number> = {
  [ZH]: 163_040_199,
  [EN]: 7_639_930,
  [SAT]: 251_042_560,
};

let isModelReady: ReturnType<typeof vi.fn>;
let downloadModel: ReturnType<typeof vi.fn>;
let cancelDownload: ReturnType<typeof vi.fn>;
let deleteModel: ReturnType<typeof vi.fn>;

/** `isModelReady` answering true only for the listed manifest ids. */
const onDisk = (...ids: string[]) =>
  isModelReady.mockImplementation(async (id: string) => ids.includes(id));

/** A `downloadModel` that reports one progress tick at `percent` of the model,
 *  then resolves. The tick is what the store sums into `downloadedBytes`. */
const downloadsInstantly = () =>
  downloadModel.mockImplementation(async (id: string, onProgress?: (p: any) => void) => {
    onProgress?.({
      modelId: id,
      downloadedBytes: BYTES[id],
      totalBytes: BYTES[id],
      currentFile: 'model.onnx',
      percent: 100,
    });
    return 'default';
  });

const abortError = () => {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
};

beforeEach(() => {
  vi.clearAllMocks();
  isModelReady = vi.fn().mockResolvedValue(false);
  downloadModel = vi.fn().mockResolvedValue('default');
  cancelDownload = vi.fn();
  deleteModel = vi.fn().mockResolvedValue(undefined);
  (ModelManager.getInstance as any).mockReturnValue({
    isModelReady, downloadModel, cancelDownload, deleteModel,
  });
  useSegmentationStore.setState({ phase: 'unknown', downloadedBytes: 0, error: null, modeBeforeDownload: null });
  mockEstimate.mockReset().mockResolvedValue(0);
  useModelStore.setState({ storageUsedMb: 0 });
});

describe('the pack roster', () => {
  it('pins the pack against the manifest', () => {
    expect(PACK_MODELS.map((m) => m.manifestId)).toEqual([ZH, EN, SAT]);
    expect(PACK_TOTAL_BYTES).toBe(421_722_689);
  });

  it('carries each display name and size from the manifest', () => {
    expect(PACK_MODELS.map((m) => m.model)).toEqual(['fireredpunc', 'edge-punct-en', 'sat-3l-sm']);
    expect(PACK_MODELS.map((m) => m.sizeBytes)).toEqual([BYTES[ZH], BYTES[EN], BYTES[SAT]]);
    expect(PACK_MODELS.map((m) => m.name)).toEqual([
      'FireRedPunc (Chinese)',
      'Edge-Punct-Casing (English)',
      'SaT 3L-SM (other languages)',
    ]);
  });

  it('starts unknown, with nothing downloaded and no error', () => {
    const initial = useSegmentationStore.getInitialState();
    expect(initial.phase).toBe('unknown');
    expect(initial.downloadedBytes).toBe(0);
    expect(initial.error).toBeNull();
  });
});

describe('refresh', () => {
  it('reports ready only when all three are on disk', async () => {
    onDisk(ZH, EN, SAT);
    await useSegmentationStore.getState().refresh();
    expect(useSegmentationStore.getState().phase).toBe('ready');
    expect(useSegmentationStore.getState().downloadedBytes).toBe(PACK_TOTAL_BYTES);
  });

  it('reports missing, and counts the models that are there', async () => {
    onDisk(ZH, SAT);
    await useSegmentationStore.getState().refresh();
    expect(useSegmentationStore.getState().phase).toBe('missing');
    expect(useSegmentationStore.getState().downloadedBytes).toBe(BYTES[ZH] + BYTES[SAT]);
  });

  it('counts a model whose readiness check throws as missing', async () => {
    isModelReady.mockImplementation(async (id: string) => {
      if (id === EN) throw new Error('IndexedDB unavailable');
      return true;
    });
    await useSegmentationStore.getState().refresh();
    expect(useSegmentationStore.getState().phase).toBe('missing');
    expect(useSegmentationStore.getState().downloadedBytes).toBe(BYTES[ZH] + BYTES[SAT]);
  });

  it('a refresh whose reads land after a later refresh started does not write', async () => {
    // `deleteModels()` wipes the disk and refreshes; `StoragePage`'s Clear all
    // does the same. Either can land while an earlier refresh is still reading,
    // and that earlier read answered "present" — it was issued before the
    // delete. Without a generation bump of its own it writes 'ready' over a
    // disk that no longer holds anything.
    const parked: Array<(ready: boolean) => void> = [];
    let parkReads = true;
    isModelReady.mockImplementation((_id: string) =>
      parkReads
        ? new Promise<boolean>((resolve) => { parked.push(resolve); })
        : Promise.resolve(false));

    const stale = useSegmentationStore.getState().refresh();
    await vi.waitFor(() => expect(parked).toHaveLength(1));

    // Everything is deleted, and the delete's own refresh reads an empty disk.
    parkReads = false;
    await useSegmentationStore.getState().refresh();
    expect(useSegmentationStore.getState().phase).toBe('missing');

    // Only now do the earlier refresh's reads come back, still saying "present".
    parkReads = true;
    for (let i = 0; i < PACK_MODELS.length; i++) {
      await vi.waitFor(() => expect(parked).toHaveLength(i + 1));
      parked[i](true);
    }
    await stale;

    expect(useSegmentationStore.getState().phase).toBe('missing');
    expect(useSegmentationStore.getState().downloadedBytes).toBe(0);
  });

  it('does not touch the phase during a download', async () => {
    let release!: () => void;
    downloadModel.mockImplementation(
      () => new Promise<string>((resolve) => { release = () => resolve('default'); }),
    );
    const inFlight = useSegmentationStore.getState().download();
    await Promise.resolve();
    expect(useSegmentationStore.getState().phase).toBe('downloading');

    onDisk(ZH, EN, SAT);
    await useSegmentationStore.getState().refresh();
    expect(useSegmentationStore.getState().phase).toBe('downloading');
    expect(isModelReady).not.toHaveBeenCalledWith(SAT);

    useSegmentationStore.getState().cancel();
    release!();
    await inFlight;
  });
});

describe('download', () => {
  it('skips a model already on disk and sums progress over the rest', async () => {
    onDisk(ZH);
    const seen: number[] = [];
    downloadModel.mockImplementation(async (id: string, onProgress?: (p: any) => void) => {
      onProgress?.({ modelId: id, downloadedBytes: Math.round(BYTES[id] / 2), totalBytes: BYTES[id], currentFile: 'f', percent: 50 });
      seen.push(useSegmentationStore.getState().downloadedBytes);
      onProgress?.({ modelId: id, downloadedBytes: BYTES[id], totalBytes: BYTES[id], currentFile: 'f', percent: 100 });
      return 'default';
    });

    await useSegmentationStore.getState().download();

    expect(downloadModel.mock.calls.map((c) => c[0])).toEqual([EN, SAT]);
    // Halfway through each downloaded model, the bar already carries the bytes
    // of everything finished before it — including the one that was skipped.
    expect(seen).toEqual([
      BYTES[ZH] + Math.round(BYTES[EN] / 2),
      BYTES[ZH] + BYTES[EN] + Math.round(BYTES[SAT] / 2),
    ]);
  });

  it('ends ready and leaves downloadedBytes at the total', async () => {
    downloadsInstantly();
    await useSegmentationStore.getState().download();
    expect(downloadModel.mock.calls.map((c) => c[0])).toEqual([ZH, EN, SAT]);
    expect(useSegmentationStore.getState().phase).toBe('ready');
    expect(useSegmentationStore.getState().downloadedBytes).toBe(PACK_TOTAL_BYTES);
    expect(useSegmentationStore.getState().error).toBeNull();
  });

  it('a failed model stops the download, records the message and leaves phase error', async () => {
    downloadModel.mockImplementation(async (id: string) => {
      if (id === EN) throw new Error('network unreachable');
      return 'default';
    });

    await useSegmentationStore.getState().download();

    expect(downloadModel.mock.calls.map((c) => c[0])).toEqual([ZH, EN]);
    expect(useSegmentationStore.getState().phase).toBe('error');
    expect(useSegmentationStore.getState().error).toContain('network unreachable');
    expect(mockReportWarning).toHaveBeenCalledWith(
      'Segmentation',
      expect.stringContaining('network unreachable'),
      expect.objectContaining({ dedupeKey: 'segmentation:download' }),
    );
  });

  it('clears a previous error when it starts again', async () => {
    useSegmentationStore.setState({ phase: 'error', error: 'network unreachable' });
    downloadsInstantly();
    const inFlight = useSegmentationStore.getState().download();
    await Promise.resolve();
    expect(useSegmentationStore.getState().error).toBeNull();
    await inFlight;
  });
});

// The mode the user was in when the 402 MB was agreed to belongs to the
// download, not to the settings section: that section unmounts whenever
// Advanced settings changes tab, while the download keeps running here.
describe('the mode a download was started from', () => {
  it('is held for as long as the download runs, and dropped when it succeeds', async () => {
    downloadsInstantly();
    const inFlight = useSegmentationStore.getState().download('pause');
    expect(useSegmentationStore.getState().modeBeforeDownload).toBe('pause');
    await inFlight;
    expect(useSegmentationStore.getState().phase).toBe('ready');
    expect(useSegmentationStore.getState().modeBeforeDownload).toBeNull();
  });

  it('is null when the caller did not say — the status line Retry', async () => {
    downloadsInstantly();
    const inFlight = useSegmentationStore.getState().download();
    expect(useSegmentationStore.getState().modeBeforeDownload).toBeNull();
    await inFlight;
  });

  it('is dropped when the download fails', async () => {
    downloadModel.mockImplementation(async () => { throw new Error('network unreachable'); });
    await useSegmentationStore.getState().download('pause');
    expect(useSegmentationStore.getState().phase).toBe('error');
    expect(useSegmentationStore.getState().modeBeforeDownload).toBeNull();
  });

  it('is dropped when the download is cancelled', async () => {
    let release: (() => void) | undefined;
    downloadModel.mockImplementation(() => new Promise<string>((resolve) => { release = () => resolve('default'); }));
    const inFlight = useSegmentationStore.getState().download('pause');
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(useSegmentationStore.getState().modeBeforeDownload).toBe('pause');

    useSegmentationStore.getState().cancel();
    expect(useSegmentationStore.getState().modeBeforeDownload).toBeNull();
    release!();
    await inFlight;
  });
});

describe('cancel', () => {
  it('aborts the in-flight model, leaves phase missing, and keeps what is downloaded', async () => {
    let rejectSat!: (err: unknown) => void;
    downloadModel.mockImplementation(async (id: string, onProgress?: (p: any) => void) => {
      if (id !== SAT) {
        onProgress?.({ modelId: id, downloadedBytes: BYTES[id], totalBytes: BYTES[id], currentFile: 'f', percent: 100 });
        return 'default';
      }
      onProgress?.({ modelId: id, downloadedBytes: 1_000, totalBytes: BYTES[id], currentFile: 'f', percent: 1 });
      return new Promise<string>((_, reject) => { rejectSat = reject; });
    });

    const inFlight = useSegmentationStore.getState().download();
    await vi.waitFor(() => expect(downloadModel).toHaveBeenCalledWith(SAT, expect.anything()));

    useSegmentationStore.getState().cancel();
    expect(cancelDownload).toHaveBeenCalledWith(SAT);
    rejectSat(abortError());
    await inFlight;

    expect(useSegmentationStore.getState().phase).toBe('missing');
    expect(useSegmentationStore.getState().error).toBeNull();
    expect(useSegmentationStore.getState().downloadedBytes).toBe(BYTES[ZH] + BYTES[EN] + 1_000);
  });

  it('a resolution that lands after a cancel cannot flip the phase to ready', async () => {
    let finish!: () => void;
    downloadModel.mockImplementation((id: string) =>
      id === SAT
        ? new Promise<string>((resolve) => { finish = () => resolve('default'); })
        : Promise.resolve('default'),
    );

    const inFlight = useSegmentationStore.getState().download();
    await vi.waitFor(() => expect(downloadModel).toHaveBeenCalledWith(SAT, expect.anything()));

    useSegmentationStore.getState().cancel();
    useSegmentationStore.setState({ phase: 'missing' });
    finish();
    await inFlight;

    expect(useSegmentationStore.getState().phase).toBe('missing');
  });

  it('does nothing when no download is running', () => {
    useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
    useSegmentationStore.getState().cancel();
    expect(cancelDownload).not.toHaveBeenCalled();
    expect(useSegmentationStore.getState().phase).toBe('ready');
  });

  it('an abandoned run cannot steal the cancel from the download that replaced it', async () => {
    // One reject per call, in call order — both runs fetch ZH, so keying by
    // model id would let the second run's promise shadow the first's.
    const rejects: Array<(err: unknown) => void> = [];
    downloadModel.mockImplementation(
      () => new Promise<string>((_, reject) => { rejects.push(reject); }),
    );

    const abandoned = useSegmentationStore.getState().download();
    await vi.waitFor(() => expect(rejects).toHaveLength(1));
    useSegmentationStore.getState().cancel();

    // The second run picks the same first model back up...
    const live = useSegmentationStore.getState().download();
    await vi.waitFor(() => expect(rejects).toHaveLength(2));
    // ...and only now does the abandoned run's fetch fall over.
    rejects[0](abortError());
    await abandoned;

    cancelDownload.mockClear();
    useSegmentationStore.getState().cancel();
    expect(cancelDownload).toHaveBeenCalledWith(ZH);

    rejects[1](abortError());
    await live;
  });

  it('a progress tick from an abandoned download cannot move the bar', async () => {
    let tick!: (bytes: number) => void;
    let finish!: () => void;
    downloadModel.mockImplementation((id: string, onProgress?: (p: any) => void) =>
      id === ZH
        ? new Promise<string>((resolve) => {
            tick = (bytes) => onProgress?.({ modelId: id, downloadedBytes: bytes, totalBytes: BYTES[id], currentFile: 'f', percent: 1 });
            finish = () => resolve('default');
          })
        : Promise.resolve('default'),
    );

    const inFlight = useSegmentationStore.getState().download();
    await vi.waitFor(() => expect(downloadModel).toHaveBeenCalledWith(ZH, expect.anything()));

    useSegmentationStore.getState().cancel();
    useSegmentationStore.setState({ downloadedBytes: 42 });
    tick(9_999);
    expect(useSegmentationStore.getState().downloadedBytes).toBe(42);

    finish();
    await inFlight;
  });
});

describe('the selectors', () => {
  it('read the phase and the progress against the pack total', () => {
    useSegmentationStore.setState({ phase: 'downloading', downloadedBytes: 1_234 });
    expect(renderHook(() => useSegmentationPhase()).result.current).toBe('downloading');
    expect(renderHook(() => useSegmentationProgress()).result.current)
      .toEqual({ downloadedBytes: 1_234, totalBytes: PACK_TOTAL_BYTES });
  });
});

describe('deleteModels', () => {
  it('deletes all three and reports missing', async () => {
    useSegmentationStore.setState({ phase: 'ready', downloadedBytes: PACK_TOTAL_BYTES });
    await useSegmentationStore.getState().deleteModels();

    expect(deleteModel.mock.calls.map((c) => c[0])).toEqual([ZH, EN, SAT]);
    expect(useSegmentationStore.getState().phase).toBe('missing');
    expect(useSegmentationStore.getState().downloadedBytes).toBe(0);
  });
});

/**
 * The pack goes straight to `ModelManager`, so nothing else moves the Storage
 * page's used-storage figure: without these writes it stays at whatever
 * `modelStore.initialize()` measured at launch, and drifts by 402 MB for the
 * rest of it.
 */
describe('the Storage page figure', () => {
  it('is re-estimated after a download', async () => {
    downloadsInstantly();
    mockEstimate.mockResolvedValue(500 * 1024 * 1024);

    await useSegmentationStore.getState().download();

    expect(useModelStore.getState().storageUsedMb).toBe(500);
  });

  it('is re-estimated after a delete', async () => {
    useModelStore.setState({ storageUsedMb: 500 });
    mockEstimate.mockResolvedValue(98 * 1024 * 1024);

    await useSegmentationStore.getState().deleteModels();

    expect(useModelStore.getState().storageUsedMb).toBe(98);
  });

  it('is not re-estimated after a failed download', async () => {
    useModelStore.setState({ storageUsedMb: 500 });
    downloadModel.mockRejectedValue(new Error('network unreachable'));

    await useSegmentationStore.getState().download();

    expect(mockEstimate).not.toHaveBeenCalled();
    expect(useModelStore.getState().storageUsedMb).toBe(500);
  });

  it('is cosmetic: an estimate that throws fails neither operation', async () => {
    downloadsInstantly();
    mockEstimate.mockRejectedValue(new Error('estimate unavailable'));

    await expect(useSegmentationStore.getState().download()).resolves.toBeUndefined();
    expect(useSegmentationStore.getState().phase).toBe('ready');

    onDisk();
    await expect(useSegmentationStore.getState().deleteModels()).resolves.toBeUndefined();
    expect(useSegmentationStore.getState().phase).toBe('missing');
    expect(useModelStore.getState().storageUsedMb).toBe(0);
  });
});
