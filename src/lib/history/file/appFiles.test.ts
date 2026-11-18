// The desktop app's file jobs: an import through Kizuna AI is checked against the service's terms, asked for as it starts.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { ImportOptions } from './importFile';

const { importFile, fetchHostedFileTerms } = vi.hoisted(() => ({
  importFile: vi.fn(async (_o: ImportOptions) => ({ recordId: 'import-0001', transcribed: true as const })),
  fetchHostedFileTerms: vi.fn(),
}));
vi.mock('./importFile', async (original) => ({ ...(await original<typeof import('./importFile')>()), importFile }));
vi.mock('./hostedFile', () => ({ fetchHostedFileTerms }));
vi.mock('./service', () => ({ fileRecognitionFromStores: vi.fn() }));
vi.mock('../../notes/appNotes', () => ({ appNotesRunner: vi.fn() }));

import { appFileJobs } from './appFiles';
import { useAccountStore } from '../../../stores/accountStore';

const TERMS = { usdPerHour: 0.2, translatedUsdPerHour: 0.32, maxAudioMs: 14_400_000, maxBytes: 100_663_296, maxBytesPerMs: 8, bytesSlack: 65_536 };
const OWN_KEY = { service: 'soniox', apiKey: 'k', region: 'us', languages: ['en'] };
const HOSTED = { service: 'kizunaai_soniox' as const, hosted: true as const, region: 'jp', languages: ['en'], access: { apiUrl: 'https://service.example/api', token: async () => 'tok' } };
const start = (service: typeof OWN_KEY | typeof HOSTED, signal = new AbortController().signal) => appFileJobs().importFile({
  file: { name: 'Team sync.mp4', size: 10 } as unknown as File, options: { languages: ['en'], translateTo: 'zh' }, myLanguage: 'en',
  service, onProgress: () => {}, signal,
});

beforeEach(() => {
  importFile.mockClear();
  fetchHostedFileTerms.mockReset();
});

describe('the app’s file jobs', () => {
  it('imports through Kizuna AI with its terms, asked for under the job’s cancel', async () => {
    fetchHostedFileTerms.mockResolvedValue(TERMS);
    const job = new AbortController();
    await start(HOSTED, job.signal);
    expect(fetchHostedFileTerms).toHaveBeenCalledTimes(1);
    expect(fetchHostedFileTerms).toHaveBeenCalledWith(undefined, job.signal);
    expect(importFile).toHaveBeenCalledWith(expect.objectContaining({ service: HOSTED, hostedTerms: TERMS }));
  });

  it('a cancel while the terms are asked for ends the import as cancelled, not as unavailable', async () => {
    fetchHostedFileTerms.mockImplementationOnce((_send: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    }));
    const job = new AbortController();
    const started = start(HOSTED, job.signal);
    await vi.waitFor(() => expect(fetchHostedFileTerms).toHaveBeenCalled());
    job.abort();
    await expect(started).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(importFile).not.toHaveBeenCalled();
  });

  // Terms that could not be had say the service could not be checked; a service that answers without them has no
  // file jobs yet.
  it('does not start an import through Kizuna AI without its terms, saying why', async () => {
    for (const [answer, code] of [
      [() => Promise.reject(new TypeError('offline')), 'unchecked'],
      [() => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')), 'unchecked'],
      [() => Promise.resolve(null), 'HOSTED_UNAVAILABLE'],
    ] as const) {
      fetchHostedFileTerms.mockImplementationOnce(answer);
      await expect(start(HOSTED), code).rejects.toMatchObject({ code });
    }
    expect(importFile).not.toHaveBeenCalled();
  });

  it('never asks for the terms with the user’s own key', async () => {
    await start(OWN_KEY);
    expect(fetchHostedFileTerms).not.toHaveBeenCalled();
    expect(importFile.mock.calls[0][0].hostedTerms).toBeUndefined();
  });

  // The profile writes the wallet it fetched into the account store a render after its fetch resolves: the page decides
  // on the account only once the store holds what was read.
  describe('reads the account again', () => {
    const before = { status: 'known' as const, balanceMicroUsd: 0, frozen: false };
    const fresh = { status: 'known' as const, balanceMicroUsd: 5, frozen: false };
    afterEach(() => {
      vi.useRealTimers();
      useAccountStore.setState({ account: null, refreshAccount: null });
    });

    it('and answers once the app holds what was read', async () => {
      const refreshAccount = vi.fn(async () => { setTimeout(() => useAccountStore.setState({ account: fresh }), 0); });
      useAccountStore.setState({ account: before, refreshAccount });
      await appFileJobs().refreshAccount();
      expect(refreshAccount).toHaveBeenCalledTimes(1);
      expect(appFileJobs().account()).toBe(fresh);
    });

    it('passes on a reading that fails, and answers at once when nothing can read it', async () => {
      useAccountStore.setState({ account: before, refreshAccount: vi.fn(async () => { throw new Error('offline'); }) });
      await expect(appFileJobs().refreshAccount()).rejects.toThrow('offline');
      useAccountStore.setState({ refreshAccount: null });
      await expect(appFileJobs().refreshAccount()).resolves.toBeUndefined();
    });

    it('does not wait past three seconds for a reading that writes nothing', async () => {
      vi.useFakeTimers();
      useAccountStore.setState({ account: before, refreshAccount: vi.fn(async () => {}) });
      let answered = false;
      void appFileJobs().refreshAccount().then(() => { answered = true; });
      await vi.advanceTimersByTimeAsync(2999);
      expect(answered).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(answered).toBe(true);
      expect(appFileJobs().account()).toBe(before);
    });
  });

  it('gives the page the terms and the account as the app holds it', async () => {
    fetchHostedFileTerms.mockResolvedValue(TERMS);
    expect(await appFileJobs().hostedTerms()).toEqual(TERMS);
    const account = { status: 'known' as const, balanceMicroUsd: 1, frozen: false };
    useAccountStore.setState({ account });
    try {
      expect(appFileJobs().account()).toBe(account);
    } finally {
      useAccountStore.setState({ account: null });
    }
  });
});
