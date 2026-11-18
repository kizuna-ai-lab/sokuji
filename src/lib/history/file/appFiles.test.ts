// The desktop app's file jobs: an import through Kizuna AI is checked against the service's terms, asked for as it starts.
import { beforeEach, describe, it, expect, vi } from 'vitest';
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

  it('does not start an import through Kizuna AI without its terms', async () => {
    for (const answer of [() => Promise.reject(new TypeError('offline')), () => Promise.resolve(null)]) {
      fetchHostedFileTerms.mockImplementationOnce(answer);
      await expect(start(HOSTED)).rejects.toMatchObject({ code: 'HOSTED_UNAVAILABLE' });
    }
    expect(importFile).not.toHaveBeenCalled();
  });

  it('never asks for the terms with the user’s own key', async () => {
    await start(OWN_KEY);
    expect(fetchHostedFileTerms).not.toHaveBeenCalled();
    expect(importFile.mock.calls[0][0].hostedTerms).toBeUndefined();
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
