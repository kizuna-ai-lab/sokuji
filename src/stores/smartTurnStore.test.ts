import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/local-inference/ModelManager', () => ({
  ModelManager: { getInstance: vi.fn() },
}));

vi.mock('../lib/diagnostics/report', async () => {
  const actual = await vi.importActual<typeof import('../lib/diagnostics/report')>('../lib/diagnostics/report');
  return { ...actual, reportWarning: (...args: unknown[]) => mockReportWarning(...args) };
});

const mockReportWarning = vi.fn();

const { ModelManager } = await import('../lib/local-inference/ModelManager');
const { useSmartTurnStore, SMART_TURN_TOTAL_BYTES } = await import('./smartTurnStore');

let isModelReady: ReturnType<typeof vi.fn>;
let downloadModel: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  isModelReady = vi.fn().mockResolvedValue(false);
  downloadModel = vi.fn().mockResolvedValue('default');
  (ModelManager.getInstance as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ isModelReady, downloadModel });
  useSmartTurnStore.setState({ phase: 'unknown', downloadedBytes: 0, error: null });
});

describe('smartTurnStore', () => {
  it('sizes the model from the manifest', () => {
    expect(SMART_TURN_TOTAL_BYTES).toBe(32_411_198);
  });

  it('refresh: ready when the model is on disk', async () => {
    isModelReady.mockResolvedValue(true);
    await useSmartTurnStore.getState().refresh();
    expect(useSmartTurnStore.getState()).toMatchObject({ phase: 'ready', downloadedBytes: SMART_TURN_TOTAL_BYTES });
  });

  it('refresh: missing when it is not, or when the disk cannot be read', async () => {
    await useSmartTurnStore.getState().refresh();
    expect(useSmartTurnStore.getState().phase).toBe('missing');
    isModelReady.mockRejectedValue(new Error('no IndexedDB'));
    await useSmartTurnStore.getState().refresh();
    expect(useSmartTurnStore.getState().phase).toBe('missing');
  });

  it('refresh leaves a running download alone', async () => {
    useSmartTurnStore.setState({ phase: 'downloading' });
    await useSmartTurnStore.getState().refresh();
    expect(isModelReady).not.toHaveBeenCalled();
    expect(useSmartTurnStore.getState().phase).toBe('downloading');
  });

  it('download: a model already on disk is ready without a fetch', async () => {
    isModelReady.mockResolvedValue(true);
    await useSmartTurnStore.getState().download();
    expect(downloadModel).not.toHaveBeenCalled();
    expect(useSmartTurnStore.getState().phase).toBe('ready');
  });

  it('download: fetches with progress and ends ready', async () => {
    const seen: number[] = [];
    downloadModel.mockImplementation(async (_id: string, onProgress?: (p: { downloadedBytes: number }) => void) => {
      onProgress?.({ downloadedBytes: 1000 });
      seen.push(useSmartTurnStore.getState().downloadedBytes);
      return 'default';
    });
    await useSmartTurnStore.getState().download();
    expect(downloadModel).toHaveBeenCalledWith('smart-turn-v3.2', expect.any(Function));
    expect(seen).toEqual([1000]);
    expect(useSmartTurnStore.getState()).toMatchObject({ phase: 'ready', downloadedBytes: SMART_TURN_TOTAL_BYTES, error: null });
  });

  it('download: a failure ends in error with its message, reported once', async () => {
    downloadModel.mockRejectedValue(new Error('offline'));
    await useSmartTurnStore.getState().download();
    expect(useSmartTurnStore.getState()).toMatchObject({ phase: 'error', error: 'offline' });
    expect(mockReportWarning).toHaveBeenCalledTimes(1);
    expect(mockReportWarning).toHaveBeenCalledWith(
      'SmartTurn',
      'Smart Turn model download failed: offline',
      expect.objectContaining({ dedupeKey: 'smart-turn:download' }),
    );
  });

  it('download: a second call while one runs does nothing', async () => {
    let finish!: () => void;
    downloadModel.mockImplementation(() => new Promise<string>((resolve) => { finish = () => resolve('default'); }));
    const first = useSmartTurnStore.getState().download();
    await vi.waitFor(() => expect(downloadModel).toHaveBeenCalledTimes(1));
    await useSmartTurnStore.getState().download();
    expect(downloadModel).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(useSmartTurnStore.getState().phase).toBe('ready');
  });

  it('a refresh that read the disk before a download started does not overwrite it', async () => {
    let answerRefresh!: (ready: boolean) => void;
    isModelReady
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { answerRefresh = resolve; }))
      .mockResolvedValue(false);
    downloadModel.mockImplementation(() => new Promise(() => {}));
    const refreshing = useSmartTurnStore.getState().refresh();
    void useSmartTurnStore.getState().download();
    await vi.waitFor(() => expect(downloadModel).toHaveBeenCalled());
    answerRefresh(false);
    await refreshing;
    expect(useSmartTurnStore.getState().phase).toBe('downloading');
  });

  it('dismiss: clears a failed download back to missing, and does nothing in any other phase', () => {
    useSmartTurnStore.setState({ phase: 'error', error: 'offline' });
    useSmartTurnStore.getState().dismiss();
    expect(useSmartTurnStore.getState()).toMatchObject({ phase: 'missing', error: null });
    for (const phase of ['unknown', 'ready', 'downloading'] as const) {
      useSmartTurnStore.setState({ phase, error: null, downloadedBytes: 5 });
      useSmartTurnStore.getState().dismiss();
      expect(useSmartTurnStore.getState()).toMatchObject({ phase, downloadedBytes: 5 });
    }
  });
});
