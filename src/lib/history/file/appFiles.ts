// src/lib/history/file/appFiles.ts
//
// The desktop app's import and transcription: the page store's file jobs over the app's History port, the browser's
// decoder and Opus encoder, the line-up's recognition service (for Kizuna AI's, its published terms and the account
// that pays), and the notes after an import (as after a session).
import { currentRunPhase } from '../../../app/runPhase';
import { useAccountStore } from '../../../stores/accountStore';
import useSettingsStore from '../../../stores/settingsStore';
import { getAppVersion } from '../../../utils/conversationExport';
import { realClock } from '../../contract/clock';
import { appNotesRunner } from '../../notes/appNotes';
import { ACCOUNT_REFRESH_MS, createFileJobState, type FileJobs } from '../historyPageStore';
import { historyPort } from '../port';
import { webCodecsOpusEncoder } from '../recording/opusEncoder';
import { decodeFile, readDuration } from './decode';
import { fetchHostedFileTerms, type HostedFileTerms } from './hostedFile';
import { importFile, ImportError } from './importFile';
import { fileRecognitionFromStores, type FileRecognitionService } from './service';
import { transcribeRecord } from './transcribe';

const newJobId = () => `job-${crypto.randomUUID()}`;

/**
 * The terms an import through Kizuna AI is checked against, asked for once as it starts; none for the user's own key.
 * Without them the import does not start: its length could not be checked against the service's limit. Terms that
 * could not be had (no answer, a refusal) end it as `unchecked`; a service that answers without them has no file jobs
 * yet; a cancel while they are asked for ends it as cancelled.
 */
async function importTerms(service: FileRecognitionService, signal: AbortSignal): Promise<HostedFileTerms | undefined> {
  if (!('hosted' in service)) return undefined;
  let terms: HostedFileTerms | null;
  try {
    terms = await fetchHostedFileTerms(undefined, signal);
  } catch {
    if (signal.aborted) throw new ImportError('CANCELLED', 'The import was cancelled');
    throw new ImportError('unchecked', 'The terms for transcribing a file through Kizuna AI could not be read');
  }
  if (!terms) throw new ImportError('HOSTED_UNAVAILABLE', 'Kizuna AI publishes no terms for transcribing a file');
  return terms;
}

/**
 * The Kizuna AI account read again. The profile writes the wallet it fetched into the account store a render after its
 * fetch resolves, so this answers once the store's account has been written since (`account()` then answers what was
 * read), and rejects when the fetch does; at once when nothing is there to read it. A fetch that writes nothing (it
 * failed as the last one did) is not waited for beyond ACCOUNT_REFRESH_MS.
 */
function refreshAccount(): Promise<void> {
  const refresh = useAccountStore.getState().refreshAccount;
  if (!refresh) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const off = useAccountStore.subscribe((now, before) => { if (now.account !== before.account) settle(); });
    const cancel = realClock.setTimeout(() => settle(), ACCOUNT_REFRESH_MS);
    function settle(error?: unknown) {
      off();
      cancel();
      if (error === undefined) resolve();
      else reject(error);
    }
    refresh().catch((error: unknown) => settle(error ?? new Error('The account could not be read')));
  });
}

let jobs: FileJobs | null = null;

/** The app's one set of file jobs: a job and its state outlive the History page that began it. */
export function appFileJobs(): FileJobs {
  if (jobs) return jobs;
  const port = historyPort();
  jobs = {
    state: createFileJobState(),
    service: fileRecognitionFromStores,
    hostedTerms: () => fetchHostedFileTerms(),
    account: () => useAccountStore.getState().account,
    refreshAccount,
    sessionRunning: () => currentRunPhase() !== 'idle',
    importFile: async (o) => importFile({
      port, file: o.file, myLanguage: o.myLanguage, options: o.options, service: o.service, hostedTerms: await importTerms(o.service, o.signal),
      appVersion: getAppVersion() ?? '', readDuration, decode: decodeFile, encoder: webCodecsOpusEncoder, clock: realClock,
      newId: () => crypto.randomUUID(), newJobId, onProgress: o.onProgress, signal: o.signal,
    }),
    transcribe: (o) => transcribeRecord({
      port, recordId: o.recordId, service: o.service, options: o.options, clock: realClock, newJobId, onProgress: o.onProgress, signal: o.signal,
    }),
    notesAfterImport(recordId) {
      if (useSettingsStore.getState().notesAfterSession) appNotesRunner().start(recordId);
    },
  };
  return jobs;
}
