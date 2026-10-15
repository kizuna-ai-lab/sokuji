import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const isDictionaryStored = vi.fn<() => Promise<boolean>>();
const storedDictionary = vi.fn<() => Promise<ArrayBuffer | null>>();
const downloadDictionary = vi.fn();
const startJaClient = vi.fn();
const reportWarning = vi.fn();
const deleteModelFiles = vi.fn(async (_id: string) => {});

vi.mock('./dictionary', () => ({ DICTIONARY_BYTES: 100, DICTIONARY_STORE_ID: 'reading-ja-lindera', isDictionaryStored, storedDictionary, downloadDictionary }));
vi.mock('../../local-inference/modelStorage', () => ({ deleteModelFiles }));
vi.mock('./client', () => ({ startJaClient }));
vi.mock('../../diagnostics/report', () => ({ reportWarning, describeCause: (e: unknown) => String(e) }));

const runtime = await import('./runtime');
const flush = () => new Promise((r) => setTimeout(r, 0));
const fakeClient = () => ({ tokenize: vi.fn(async () => [{ surface: '雨', reading: 'アメ', unknown: false }]), terminate: vi.fn() });

describe('the Japanese runtime', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => runtime.setJapaneseWanted(false));

  it('starts from the stored dictionary without downloading or reading it, and the worker only when a row first needs it', async () => {
    isDictionaryStored.mockResolvedValue(true);
    storedDictionary.mockImplementation(async () => new ArrayBuffer(100));
    const client = fakeClient();
    startJaClient.mockResolvedValue(client);
    runtime.setJapaneseWanted(true);
    expect(runtime.getJapaneseState()).toEqual({ phase: 'loading' });
    await flush();
    expect(downloadDictionary).not.toHaveBeenCalled();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'ready' });
    // Ready means only that the file is there: its 17 MB is read once, for the worker.
    expect(storedDictionary).not.toHaveBeenCalled();
    expect(startJaClient).not.toHaveBeenCalled();
    const [a, b] = [runtime.tokenizeJapanese('雨'), runtime.tokenizeJapanese('雨')];
    expect(await a).toEqual([{ surface: '雨', reading: 'アメ', unknown: false }]);
    expect(await b).toEqual([{ surface: '雨', reading: 'アメ', unknown: false }]);
    expect(startJaClient).toHaveBeenCalledTimes(1);
    expect(storedDictionary).toHaveBeenCalledTimes(1);
    expect(await runtime.tokenizeJapanese('雨')).toEqual([{ surface: '雨', reading: 'アメ', unknown: false }]);
    expect(startJaClient).toHaveBeenCalledTimes(1);
    expect(client.tokenize).toHaveBeenCalledTimes(3);
  });

  it('downloads when nothing is stored, publishing progress', async () => {
    isDictionaryStored.mockResolvedValue(false);
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
    isDictionaryStored.mockResolvedValue(false);
    let signal: AbortSignal | undefined;
    downloadDictionary.mockImplementation((opts) => { signal = opts.signal; return new Promise(() => {}); });
    runtime.setJapaneseWanted(true);
    await flush();
    runtime.setJapaneseWanted(false);
    expect(signal?.aborted).toBe(true);
    expect(runtime.getJapaneseState()).toEqual({ phase: 'off' });
  });

  it('drops a start that a stop overtook', async () => {
    let found!: (stored: boolean) => void;
    isDictionaryStored.mockReturnValue(new Promise((r) => { found = r; }));
    runtime.setJapaneseWanted(true);
    await flush();
    runtime.setJapaneseWanted(false);
    found(true);
    await flush();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'off' });
    expect(startJaClient).not.toHaveBeenCalled();
    expect(runtime.tokenizeJapanese('雨')).toBeNull();
  });

  it('terminates a worker that finishes starting after a stop', async () => {
    isDictionaryStored.mockResolvedValue(true);
    storedDictionary.mockImplementation(async () => new ArrayBuffer(100));
    const client = fakeClient();
    let finish!: (c: unknown) => void;
    startJaClient.mockReturnValue(new Promise((r) => { finish = r; }));
    runtime.setJapaneseWanted(true);
    await flush();
    const pending = runtime.tokenizeJapanese('雨');
    await flush();
    expect(startJaClient).toHaveBeenCalledTimes(1);
    runtime.setJapaneseWanted(false);
    finish(client);
    expect(await pending).toBeNull();
    expect(client.terminate).toHaveBeenCalled();
    expect(client.tokenize).not.toHaveBeenCalled();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'off' });
    expect(runtime.tokenizeJapanese('雨')).toBeNull();
  });

  it('terminates a running worker when no longer wanted', async () => {
    isDictionaryStored.mockResolvedValue(true);
    storedDictionary.mockImplementation(async () => new ArrayBuffer(100));
    const client = fakeClient();
    startJaClient.mockResolvedValue(client);
    runtime.setJapaneseWanted(true);
    await flush();
    await runtime.tokenizeJapanese('雨');
    runtime.setJapaneseWanted(false);
    expect(client.terminate).toHaveBeenCalled();
    expect(runtime.tokenizeJapanese('雨')).toBeNull();
  });

  it('a worker that cannot start deletes the stored dictionary and fails; a retry downloads it again', async () => {
    isDictionaryStored.mockResolvedValueOnce(true);
    storedDictionary.mockResolvedValueOnce(new ArrayBuffer(100));
    startJaClient.mockRejectedValueOnce(new Error('CompileError: bad wasm'));
    runtime.setJapaneseWanted(true);
    await flush();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'ready' });
    const [a, b] = [runtime.tokenizeJapanese('雨'), runtime.tokenizeJapanese('風')];
    expect(await a).toBeNull();
    expect(await b).toBeNull();
    expect(startJaClient).toHaveBeenCalledTimes(1);
    expect(deleteModelFiles).toHaveBeenCalledWith('reading-ja-lindera');
    expect(reportWarning).toHaveBeenCalledTimes(1);
    expect(runtime.getJapaneseState()).toEqual({ phase: 'failed' });
    isDictionaryStored.mockResolvedValue(false);
    downloadDictionary.mockResolvedValueOnce(new ArrayBuffer(100));
    runtime.retryJapanese();
    await flush();
    expect(downloadDictionary).toHaveBeenCalledTimes(1);
    expect(runtime.getJapaneseState()).toEqual({ phase: 'ready' });
  });

  it('fails visibly when the worker stops after starting, keeps the dictionary, and a retry starts a new worker', async () => {
    isDictionaryStored.mockResolvedValue(true);
    storedDictionary.mockImplementation(async () => new ArrayBuffer(100));
    const [first, second] = [fakeClient(), fakeClient()];
    let gone!: (err: Error) => void;
    startJaClient
      .mockImplementationOnce(async (_bytes: ArrayBuffer, onGone: (err: Error) => void) => { gone = onGone; return first; })
      .mockResolvedValueOnce(second);
    runtime.setJapaneseWanted(true);
    await flush();
    await runtime.tokenizeJapanese('雨');
    gone(new Error('worker killed'));
    expect(runtime.getJapaneseState()).toEqual({ phase: 'failed' });
    expect(reportWarning).toHaveBeenCalledTimes(1);
    expect(deleteModelFiles).not.toHaveBeenCalled();
    expect(runtime.tokenizeJapanese('雨')).toBeNull();
    runtime.retryJapanese();
    await flush();
    expect(runtime.getJapaneseState()).toEqual({ phase: 'ready' });
    expect(downloadDictionary).not.toHaveBeenCalled();
    expect(await runtime.tokenizeJapanese('雨')).toEqual([{ surface: '雨', reading: 'アメ', unknown: false }]);
    expect(startJaClient).toHaveBeenCalledTimes(2);
    expect(second.tokenize).toHaveBeenCalledTimes(1);
  });

  it('ignores a worker from an earlier start that stops later', async () => {
    isDictionaryStored.mockResolvedValue(true);
    storedDictionary.mockImplementation(async () => new ArrayBuffer(100));
    let gone!: (err: Error) => void;
    startJaClient
      .mockImplementationOnce(async (_bytes: ArrayBuffer, onGone: (err: Error) => void) => { gone = onGone; return fakeClient(); })
      .mockResolvedValueOnce(fakeClient());
    runtime.setJapaneseWanted(true);
    await flush();
    await runtime.tokenizeJapanese('雨');
    runtime.setJapaneseWanted(false);
    runtime.setJapaneseWanted(true);
    await flush();
    await runtime.tokenizeJapanese('雨');
    gone(new Error('worker killed'));
    expect(runtime.getJapaneseState()).toEqual({ phase: 'ready' });
    expect(reportWarning).not.toHaveBeenCalled();
  });

  it('fails when the stored dictionary is gone by the time the worker starts', async () => {
    isDictionaryStored.mockResolvedValueOnce(true);
    storedDictionary.mockResolvedValueOnce(null);
    runtime.setJapaneseWanted(true);
    await flush();
    expect(await runtime.tokenizeJapanese('雨')).toBeNull();
    expect(startJaClient).not.toHaveBeenCalled();
    expect(reportWarning).toHaveBeenCalledTimes(1);
    expect(runtime.getJapaneseState()).toEqual({ phase: 'failed' });
  });

  it('fails visibly once, and a retry starts again', async () => {
    isDictionaryStored.mockResolvedValue(false);
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
    isDictionaryStored.mockResolvedValueOnce(true);
    startJaClient.mockResolvedValue(fakeClient());
    runtime.setJapaneseWanted(true);
    await flush();
    runtime.setJapaneseWanted(false);
    isDictionaryStored.mockResolvedValueOnce(false);
    downloadDictionary.mockResolvedValueOnce(new ArrayBuffer(100));
    runtime.setJapaneseWanted(true);
    await flush();
    expect(downloadDictionary).toHaveBeenCalledTimes(1);
    expect(runtime.getJapaneseState()).toEqual({ phase: 'ready' });
  });

  it('says nothing when an abort ends the download', async () => {
    isDictionaryStored.mockResolvedValue(false);
    downloadDictionary.mockRejectedValue(new DOMException('Download cancelled', 'AbortError'));
    runtime.setJapaneseWanted(true);
    await flush();
    expect(reportWarning).not.toHaveBeenCalled();
  });
});
