// src/lib/history/file/appFiles.ts
//
// The desktop app's import and transcription: the page store's file jobs over the app's History port, the browser's
// decoder and Opus encoder, the line-up's recognition service, and the notes after an import (as after a session).
import { currentRunPhase } from '../../../app/runPhase';
import { useLineUpStore } from '../../../stores/lineUpStore';
import useSettingsStore from '../../../stores/settingsStore';
import { getAppVersion } from '../../../utils/conversationExport';
import { realClock } from '../../contract/clock';
import { appNotesRunner } from '../../notes/appNotes';
import type { FileJobs } from '../historyPageStore';
import { historyPort } from '../port';
import { webCodecsOpusEncoder } from '../recording/opusEncoder';
import { decodeFile, readMediaDuration } from './decode';
import { importFile } from './importFile';
import { fileRecognitionFromStores } from './service';
import { transcribeRecord } from './transcribe';

const newJobId = () => `job-${crypto.randomUUID()}`;

export function appFileJobs(): FileJobs {
  const port = historyPort();
  return {
    service: fileRecognitionFromStores,
    sessionRunning: () => currentRunPhase() !== 'idle',
    importFile: (o) => importFile({
      port, file: o.file, myLanguage: o.myLanguage, language: o.language, service: o.service, appVersion: getAppVersion() ?? '',
      readDuration: readMediaDuration, decode: decodeFile, encoder: webCodecsOpusEncoder, clock: realClock,
      newId: () => crypto.randomUUID(), newJobId, onProgress: o.onProgress, signal: o.signal,
    }),
    transcribe: (o) => transcribeRecord({ port, recordId: o.recordId, service: o.service, clock: realClock, newJobId, onProgress: o.onProgress, signal: o.signal }),
    notesAfterImport(recordId) {
      if (useSettingsStore.getState().notesAfterSession && useLineUpStore.getState().lineUp?.summarisation) appNotesRunner().start(recordId);
    },
  };
}
