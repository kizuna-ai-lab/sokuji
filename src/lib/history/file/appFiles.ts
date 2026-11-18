// src/lib/history/file/appFiles.ts
//
// The desktop app's import and transcription: the page store's file jobs over the app's History port, the browser's
// decoder and Opus encoder, the line-up's recognition service, and the notes after an import (as after a session).
import { currentRunPhase } from '../../../app/runPhase';
import useSettingsStore from '../../../stores/settingsStore';
import { getAppVersion } from '../../../utils/conversationExport';
import { realClock } from '../../contract/clock';
import { appNotesRunner } from '../../notes/appNotes';
import { createFileJobState, type FileJobs } from '../historyPageStore';
import { historyPort } from '../port';
import { webCodecsOpusEncoder } from '../recording/opusEncoder';
import { decodeFile, readDuration } from './decode';
import { importFile } from './importFile';
import { fileRecognitionFromStores } from './service';
import { transcribeRecord } from './transcribe';

const newJobId = () => `job-${crypto.randomUUID()}`;

let jobs: FileJobs | null = null;

/** The app's one set of file jobs: a job and its state outlive the History page that began it. */
export function appFileJobs(): FileJobs {
  if (jobs) return jobs;
  const port = historyPort();
  jobs = {
    state: createFileJobState(),
    service: fileRecognitionFromStores,
    sessionRunning: () => currentRunPhase() !== 'idle',
    importFile: (o) => importFile({
      port, file: o.file, myLanguage: o.myLanguage, options: o.options, service: o.service, appVersion: getAppVersion() ?? '',
      readDuration, decode: decodeFile, encoder: webCodecsOpusEncoder, clock: realClock,
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
