// src/components/History/FileJobs.tsx
//
// Importing a file and transcribing a record again, on the History screens (desktop): the panel that asks before an
// import, the one that asks before a transcription again, the line that follows the running job and says how it
// ended, and the choice between a record's transcripts. Each names the service and the stage of the line-up it
// belongs to (recognition), and what it costs, paid with the user's own key.
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import type { FileJobBlock } from '../../lib/history/historyPageStore';
import { languageLabel } from '../../lib/language/label';
import { useProviderStore } from '../../stores/providerStore';
import { INTERFACE_LANGUAGES } from '../Settings/sections/interfaceLanguages';
import { useHistoryPageContext } from './historyContext';
import { formatDateTime } from './format';

/** Soniox's file recognition, about (stt-async; the bill is checked against it on the real service). */
export const FILE_USD_PER_HOUR = 0.1;

const baseOf = (code: string) => code.split(/[-_]/)[0].toLowerCase();

/** The user's language now: the selected service's own side, else the interface's. */
export function myLanguageNow(ui: string): string {
  const { selected, entries } = useProviderStore.getState();
  const source = selected ? entries[selected]?.pair.source : undefined;
  return source && source !== 'auto' && !source.includes('+') ? baseOf(source) : baseOf(ui);
}

function useFileTexts() {
  const { t } = useTranslation();
  return useMemo(() => {
    const blocks: Record<FileJobBlock | 'no-recording', string> = {
      'not-soniox': t('history.file.blockedNotSoniox', 'Needs Soniox as the recognition service in the line-up.'),
      'no-key': t('history.file.blockedNoKey', 'Needs a Soniox key in Settings.'),
      session: t('history.file.blockedSession', 'Available when no session is running.'),
      busy: t('history.file.blockedBusy', 'Another import or transcription is running.'),
      'no-recording': t('history.file.blockedNoRecording', 'This record keeps no recording.'),
    };
    const phases: Record<string, string> = {
      reading: t('history.file.phase.reading', 'Reading the file'),
      decoding: t('history.file.phase.decoding', 'Decoding the audio'),
      saving: t('history.file.phase.saving', 'Saving the recording'),
      uploading: t('history.file.phase.uploading', 'Sending the recording to Soniox'),
      queued: t('history.file.phase.queued', 'Waiting at Soniox'),
      processing: t('history.file.phase.processing', 'Soniox is transcribing'),
      fetching: t('history.file.phase.fetching', 'Fetching the transcript'),
      writing: t('history.file.phase.writing', 'Writing the transcript'),
    };
    const failures: Record<string, string> = {
      TOO_LONG: t('history.file.failure.TOO_LONG', 'The file is longer than three hours.'),
      TOO_BIG: t('history.file.failure.TOO_BIG', 'The file is larger than 2 GB.'),
      UNSUPPORTED: t('history.file.failure.UNSUPPORTED', 'The audio of this file cannot be read.'),
      NO_AUDIO: t('history.file.failure.NO_AUDIO', 'The file holds no sound.'),
      NO_SPEECH: t('history.file.failure.NO_SPEECH', 'Soniox heard no speech in the recording.'),
      NO_KEY: t('history.file.failure.NO_KEY', 'Soniox did not accept the key. Check it in Settings.'),
      NO_CREDIT: t('history.file.failure.NO_CREDIT', 'The Soniox account has no credit left.'),
      BAD_AUDIO: t('history.file.failure.BAD_AUDIO', 'Soniox could not read the recording.'),
      NETWORK: t('history.file.failure.NETWORK', 'Soniox could not be reached. Check the connection and try again.'),
      CANCELLED: t('history.file.failure.CANCELLED', 'Cancelled.'),
      SERVICE: t('history.file.failure.SERVICE', 'Soniox could not transcribe the recording. Try again later.'),
    };
    return {
      block: (b: FileJobBlock | 'no-recording') => blocks[b],
      phase: (p: string) => phases[p] ?? p,
      failure: (code: string) => failures[code] ?? blocks[code as FileJobBlock] ?? failures.SERVICE,
      service: t('history.file.service', 'Transcribed by Soniox, the recognition service in your line-up.'),
    };
  }, [t]);
}

/** Why the job cannot start, asked once the panel shows. */
function useBlocked(kind: 'import' | 'transcribe'): { known: boolean; blocked: FileJobBlock | null } {
  const { store } = useHistoryPageContext();
  const [state, setState] = useState<{ known: boolean; blocked: FileJobBlock | null }>({ known: false, blocked: null });
  useEffect(() => {
    let live = true;
    void store.getState().fileJobBlocked(kind).then((blocked) => { if (live) setState({ known: true, blocked }); });
    return () => { live = false; };
  }, [store, kind]);
  return state;
}

export interface ImportPanelProps {
  file: File;
  /** The user's language: preselected, and the notes' language. */
  myLanguage: string;
  onClose(): void;
}

export const ImportPanel: React.FC<ImportPanelProps> = ({ file, myLanguage, onClose }) => {
  const { t, i18n } = useTranslation();
  const { store } = useHistoryPageContext();
  const texts = useFileTexts();
  const { known, blocked } = useBlocked('import');
  const [language, setLanguage] = useState(myLanguage);
  const codes = useMemo(() => [...new Set([myLanguage, ...INTERFACE_LANGUAGES.map((l) => baseOf(l.value))])], [myLanguage]);
  const title = t('history.file.importTitle', 'Import “{{name}}”', { name: file.name });
  const start = () => {
    void store.getState().importFile(file, { language, myLanguage });
    onClose();
  };
  return (
    <div className="history-confirm history-file" role="dialog" aria-label={title}>
      <p className="history-file__title">{title}</p>
      <label className="history-file__field">
        <span>{t('history.file.language', 'Language spoken in it')}</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {codes.map((c) => <option key={c} value={c}>{languageLabel(c, i18n.language)}</option>)}
        </select>
      </label>
      <p>{texts.service}</p>
      <p>{t('history.file.costHour', 'About USD 0.10 an hour of audio, paid with your Soniox key.')}</p>
      {blocked && <p className="history-file__blocked" role="status">{texts.block(blocked)}</p>}
      <div className="history-confirm__actions">
        <button type="button" className="history-button" disabled={!known || blocked !== null} onClick={start}>{t('history.file.start', 'Start')}</button>
        <button type="button" className="history-button history-button--quiet" onClick={onClose}>{t('history.cancel', 'Cancel')}</button>
      </div>
    </div>
  );
};

export const TranscribePanel: React.FC<{ onClose(): void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const { store } = useHistoryPageContext();
  const open = useStore(store, (s) => s.open);
  const texts = useFileTexts();
  const { known, blocked } = useBlocked('transcribe');
  if (!open) return null;
  const kept = open.record.tracks.filter((tr) => tr.goneAt === null);
  const hours = kept.reduce((sum, tr) => sum + tr.durationMs, 0) / 3_600_000;
  const cost = hours * FILE_USD_PER_HOUR;
  const title = open.record.transcripts.length > 0 ? t('history.file.transcribeAgain', 'Transcribe again') : t('history.file.transcribe', 'Transcribe');
  const why = kept.length === 0 ? texts.block('no-recording') : blocked ? texts.block(blocked) : null;
  const start = () => {
    void store.getState().transcribeOpen();
    onClose();
  };
  return (
    <div className="history-confirm history-file record-page__confirm" role="dialog" aria-label={title}>
      <p className="history-file__title">{title}</p>
      <p>{t('history.file.transcribeNote', 'The saved recording is transcribed again. A new version is made; the transcripts already here stay.')}</p>
      <p>{texts.service}</p>
      <p>{cost < 0.01
        ? t('history.file.costTiny', 'Less than USD 0.01, paid with your Soniox key.')
        : t('history.file.costFor', 'About USD {{cost}}, paid with your Soniox key.', { cost: cost.toFixed(2) })}</p>
      {why && <p className="history-file__blocked" role="status">{why}</p>}
      <div className="history-confirm__actions">
        <button type="button" className="history-button" disabled={!known || why !== null} onClick={start}>{t('history.file.start', 'Start')}</button>
        <button type="button" className="history-button history-button--quiet" onClick={onClose}>{t('history.cancel', 'Cancel')}</button>
      </div>
    </div>
  );
};

/** The running import or transcription with a way to stop it; then, when it did not finish, why. */
export const FileJobLine: React.FC = () => {
  const { t } = useTranslation();
  const { store } = useHistoryPageContext();
  const job = useStore(store, (s) => s.job);
  const failure = useStore(store, (s) => s.jobFailure);
  const kept = useStore(store, (s) => s.jobKept);
  const texts = useFileTexts();
  if (job) {
    const phase = texts.phase(job.phase);
    return (
      <div className="history-notice history-file__line" role="status">
        <p>{job.kind === 'import'
          ? t('history.file.importing', 'Importing “{{name}}”: {{phase}}', { name: job.name ?? '', phase })
          : t('history.file.transcribing', 'Transcribing: {{phase}}', { phase })}</p>
        <button type="button" className="history-button" onClick={() => store.getState().cancelJob()}>{t('history.cancel', 'Cancel')}</button>
      </div>
    );
  }
  if (!failure) return null;
  return (
    <div className="history-notice history-file__line" role="alert">
      <p>{texts.failure(failure)}</p>
      {kept && <p>{t('history.file.kept', 'The recording was kept. Open the record to transcribe it.')}</p>}
      <button type="button" className="history-button" onClick={() => store.getState().clearJobFailure()}>{t('history.gotIt', 'Got it')}</button>
    </div>
  );
};

/** A record's transcripts, newest first, when it has more than one. */
export const TranscriptChooser: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { store } = useHistoryPageContext();
  const open = useStore(store, (s) => s.open);
  if (!open || open.record.transcripts.length < 2) return null;
  const byAge = [...open.record.transcripts].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  return (
    <label className="history-file__versions">
      <span>{t('history.file.versions', 'Transcript version')}</span>
      <select value={open.transcriptId ?? ''} onChange={(e) => void store.getState().showTranscript(Number(e.target.value))}>
        {byAge.map((tr) => {
          const time = formatDateTime(tr.createdAt, i18n.language);
          return (
            <option key={tr.id} value={tr.id}>
              {tr.origin.kind === 'live'
                ? t('history.file.versionLive', 'Live · {{time}}', { time })
                : t('history.file.versionFile', 'Soniox file · {{time}}', { time })}
            </option>
          );
        })}
      </select>
    </label>
  );
};
