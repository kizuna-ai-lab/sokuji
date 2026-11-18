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
import { createFileJobState, type FileJobs } from '../historyPageStore';
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
 * Without them the import does not start: its length could not be checked against the service's limit. A cancel while
 * they are asked for ends the import as cancelled.
 */
async function importTerms(service: FileRecognitionService, signal: AbortSignal): Promise<HostedFileTerms | undefined> {
  if (!('hosted' in service)) return undefined;
  let terms: HostedFileTerms | null;
  try {
    terms = await fetchHostedFileTerms(undefined, signal);
  } catch {
    if (signal.aborted) throw new ImportError('CANCELLED', 'The import was cancelled');
    terms = null;
  }
  if (!terms) throw new ImportError('HOSTED_UNAVAILABLE', 'The terms for transcribing a file through Kizuna AI could not be read');
  return terms;
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
