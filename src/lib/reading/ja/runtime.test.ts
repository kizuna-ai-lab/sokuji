import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const storedDictionary = vi.fn<() => Promise<ArrayBuffer | null>>();
const downloadDictionary = vi.fn();
const startJaClient = vi.fn();
const reportWarning = vi.fn();

vi.mock('./dictionary', () => ({ DICTIONARY_BYTES: 100, storedDictionary, downloadDictionary }));
vi.mock('./client', () => ({ startJaClient }));
vi.mock('../../diagnostics/report', () => ({ reportWarning, describeCause: (e: unknown) => String(e) }));

const runtime = await import('./runtime');
const flush = () => new Promise((r) => setTimeout(r, 0));
const fakeClient = () => ({ tokenize: vi.fn(async () => [{ surface: '雨', reading: 'アメ', unknown: false }]), terminate: vi.fn() });

describe('the Japanese runtime', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => runtime.setJapaneseWanted(false));

  it('starts from the stored dictionary without downloading', async () => {
    storedDictionary.mockResolvedValue(new ArrayBuffer(100));
    const client = fakeClient();
    startJaClient.mockResolvedValue(client);
    runtime.setJapaneseWanted(true);
    expect(runtime.getJapaneseState()).toEqual({ phase: 'loading' });
    await flush();
    expect(downloadDictionary).not.toHaveBeenCalled();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'ready' });
    expect(await runtime.tokenizeJapanese('雨')).toEqual([{ surface: '雨', reading: 'アメ', unknown: false }]);
  });

  it('downloads when nothing is stored, publishing progress', async () => {
    storedDictionary.mockResolvedValue(null);
    downloadDictionary.mockImplementation(async ({ onProgress }) => {
      onProgress(40, 100);
      expect(runtime.getJapaneseState()).toEqual({ phase: 'downloading', done: 40, total: 100 });
      return new ArrayBuffer(100);
    });
    startJaClient.mockResolvedValue(fakeClient());
    const seen: string[] = [];
    const off = runtime.subscribeJapanese(() => seen.push(runtime.getJapaneseState().phase));
    runtime.setJapaneseWanted(true);
    await flush();
    off();
    expect(seen).toEqual(['loading', 'downloading', 'downloading', 'ready']);
  });

  it('is not ready, and tokenizes nothing, before it starts', () => {
    expect(runtime.getJapaneseState()).toEqual({ phase: 'off' });
    expect(runtime.tokenizeJapanese('雨')).toBeNull();
  });

  it('aborts the download and stops when no longer wanted', async () => {
    storedDictionary.mockResolvedValue(null);
    let signal: AbortSignal | undefined;
    downloadDictionary.mockImplementation((opts) => { signal = opts.signal; return new Promise(() => {}); });
    runtime.setJapaneseWanted(true);
    await flush();
    runtime.setJapaneseWanted(false);
    expect(signal?.aborted).toBe(true);
    expect(runtime.getJapaneseState()).toEqual({ phase: 'off' });
  });

  it('drops a start that a stop overtook, terminating the late worker', async () => {
    storedDictionary.mockResolvedValue(new ArrayBuffer(100));
    const client = fakeClient();
    let finish!: (c: unknown) => void;
    startJaClient.mockReturnValue(new Promise((r) => { finish = r; }));
    runtime.setJapaneseWanted(true);
    await flush();
    runtime.setJapaneseWanted(false);
    finish(client);
    await flush();
    expect(client.terminate).toHaveBeenCalled();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'off' });
    expect(runtime.tokenizeJapanese('雨')).toBeNull();
  });

  it('fails visibly once, and a retry starts again', async () => {
    storedDictionary.mockResolvedValue(null);
    downloadDictionary.mockRejectedValueOnce(new Error('offline'));
    runtime.setJapaneseWanted(true);
    await flush();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'failed' });
    expect(reportWarning).toHaveBeenCalledTimes(1);
    downloadDictionary.mockResolvedValueOnce(new ArrayBuffer(100));
    startJaClient.mockResolvedValue(fakeClient());
    runtime.retryJapanese();
    await flush();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'ready' });
  });

  it('downloads again when the stored file is gone (local models cleared)', async () => {
    storedDictionary.mockResolvedValueOnce(new ArrayBuffer(100));
    startJaClient.mockResolvedValue(fakeClient());
    runtime.setJapaneseWanted(true);
    await flush();
    runtime.setJapaneseWanted(false);
    storedDictionary.mockResolvedValueOnce(null);
    downloadDictionary.mockResolvedValueOnce(new ArrayBuffer(100));
    runtime.setJapaneseWanted(true);
    await flush();
    expect(downloadDictionary).toHaveBeenCalledTimes(1);
    expect(runtime.getJapaneseState()).toEqual({ phase: 'ready' });
  });

  it('says nothing when an abort ends the download', async () => {
    storedDictionary.mockResolvedValue(null);
    downloadDictionary.mockRejectedValue(new DOMException('Download cancelled', 'AbortError'));
    runtime.setJapaneseWanted(true);
    await flush();
    expect(reportWarning).not.toHaveBeenCalled();
  });
});
