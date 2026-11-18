// src/components/History/FileJobs.tsx
//
// Importing a file and transcribing a record again, on the History screens (desktop): the panel that asks before an
// import, the one that asks before a transcription again (both ask the same: the languages spoken and the language to
// translate into, with one set of fields), the line that follows the running job and says how it ended, and the
// choice between a record's transcripts. Each names the service; the stage of the line-up it belongs to
// is called transcription, as the line-up calls it (B-35). With the user's own key no price is shown (owner, 2026-11-16).
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useStore } from 'zustand';
import type { FileJobBlock } from '../../lib/history/historyPageStore';
import { EACH_SIDE, eachSideOffered, fitOptions, importOptions, optionsFor, withMain, withOther, withoutOther } from '../../lib/history/file/options';
import type { FileTranscriptionOptions } from '../../lib/history/types';
import { orderLanguages, pinnedLanguages, PIN_SEPARATOR, type OrderContext } from '../../lib/language/order';
import { useLanguageLabel } from '../../lib/language/useLanguageLabel';
import { useProviderStore } from '../../stores/providerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useHistoryPageContext } from './historyContext';
import { formatDateTime } from './format';
import { providerTarget } from '../SettingsPage/accountRows';

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
      'no-file-service': t('history.file.blockedNotSoniox', 'Files are transcribed only by Soniox with your own key. Choose it for transcription in the line-up.'),
      'hosted-soniox': t('history.file.blockedHostedSoniox', 'Files are transcribed only with your own Soniox key: Kizuna AI’s Soniox is for live sessions only, for now.'),
      'no-key': t('history.file.blockedNoKey', 'Your Soniox key is not filled in yet.'),
      session: t('history.file.blockedSession', 'Available when no session is running.'),
      busy: t('history.file.blockedBusy', 'Another import or transcription is running.'),
      unchecked: t('history.file.blockedUnchecked', 'The transcription service could not be checked. Close this and try again.'),
      'no-recording': t('history.file.blockedNoRecording', 'This record keeps no recording.'),
    };
    // What to change, as a link to it in Settings (owner, 2026-11-17; B-35): the line-up, or the key.
    const open = (category: 'lineup' | 'accounts', fallback: string) =>
      t('history.file.openSettings', 'Open {{place}}', { place: t(`settingsPage.categories.${category}`, fallback) });
    const fixes: Partial<Record<FileJobBlock, { label: string; target: string }>> = {
      'no-file-service': { label: open('lineup', 'Languages and line-up'), target: 'lineup' },
      'hosted-soniox': { label: open('lineup', 'Languages and line-up'), target: 'lineup' },
      // Soniox's own key: its row, not the row of the provider the session runs on.
      'no-key': { label: open('accounts', 'Accounts and keys'), target: providerTarget('soniox') },
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
      TOO_LONG: t('history.file.failure.TOO_LONG', 'The file is longer than five hours.'),
      RECORD_TOO_LONG: t('history.file.failure.RECORD_TOO_LONG', 'The recording is longer than five hours, more than Soniox transcribes at once.'),
      TOO_BIG: t('history.file.failure.TOO_BIG', 'The file is larger than 16 GB.'),
      UNSUPPORTED: t('history.file.failure.UNSUPPORTED', 'The audio of this file cannot be read. Convert it to AAC or MP3 and import it again.'),
      NO_AUDIO: t('history.file.failure.NO_AUDIO', 'The file holds no sound.'),
      NO_SPEECH: t('history.file.failure.NO_SPEECH', 'Soniox heard no speech in the recording.'),
      NO_KEY: t('history.file.failure.NO_KEY', 'Soniox did not accept the key. Check it in Settings.'),
      NO_CREDIT: t('history.file.failure.NO_CREDIT', 'The Soniox account has no credit left.'),
      BAD_AUDIO: t('history.file.failure.BAD_AUDIO', 'Soniox could not read the recording.'),
      NETWORK: t('history.file.failure.NETWORK', 'Soniox could not be reached. Check the connection and try again.'),
      CANCELLED: t('history.file.failure.CANCELLED', 'Cancelled.'),
      SERVICE: t('history.file.failure.SERVICE', 'Soniox could not transcribe the recording. Try again later.'),
      // Anything else went wrong here (saving, encoding, the store), not at the service.
      LOCAL: t('history.file.failure.LOCAL', 'It could not be saved on this computer. Try again.'),
    };
    return {
      block: (b: FileJobBlock | 'no-recording') => blocks[b],
      fix: (b: FileJobBlock | 'no-recording' | null) => (b && b !== 'no-recording' ? fixes[b] ?? null : null),
      phase: (p: string) => phases[p] ?? p,
      failure: (code: string) => failures[code] ?? blocks[(code === 'NO_TRACK' ? 'no-recording' : code) as FileJobBlock] ?? failures.LOCAL,
      service: t('history.file.service', 'Transcribed by Soniox, with your own key.'),
    };
  }, [t]);
}

/** A panel that asks first: it takes the focus when it shows, and Escape closes it (not the page behind it). */
function usePanel(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return { ref, tabIndex: -1, onKeyDown };
}

/** The service line only when the service can do the job: not beside a reason it cannot (B-35). */
const serviceFine = (known: boolean, blocked: FileJobBlock | null) => known && (blocked === null || blocked === 'session' || blocked === 'busy');

/** Why the job cannot start, and the link to what to change; the link closes the panel and opens Settings there. */
const Blocked: React.FC<{ text: string; fix: { label: string; target: string } | null; onClose(): void }> = ({ text, fix, onClose }) => (
  <p className="history-file__blocked" role="status">
    <span>{text}</span>
    {fix && (
      <>
        {' '}
        <button type="button" className="history-file__link" onClick={() => { onClose(); useSettingsStore.getState().navigateToSettings(fix.target); }}>
          {fix.label}
        </button>
      </>
    )}
  </p>
);

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

/**
 * The languages the file service transcribes in and translates into, once known; `unchecked` when the service could
 * not be asked for them (the panel then says so, as when it could not be checked at all).
 */
function useFileLanguages(): { offered: readonly string[]; unchecked: boolean } {
  const { store } = useHistoryPageContext();
  const [languages, setLanguages] = useState<readonly string[] | null>([]);
  useEffect(() => {
    let live = true;
    void store.getState().fileLanguages().then((l) => { if (live) setLanguages(l); });
    return () => { live = false; };
  }, [store]);
  return { offered: languages ?? [], unchecked: languages === null };
}

const SEPARATOR = '──────────';

export interface FileOptionsFieldsProps {
  value: FileTranscriptionOptions;
  onChange(value: FileTranscriptionOptions): void;
  /** The languages the file service offers (none yet while they are asked for). */
  offered: readonly string[];
  /** A session with both sides kept: "each side into the other's language" is offered first. */
  eachSide?: boolean;
}

/**
 * What a file transcription is asked for, the same for an import and a transcription again: the main language spoken,
 * the others it may contain (each added on its own and taken out again), and the language to translate into. Each
 * list is drawn as the source and target lists are: the likely languages first (the ones chosen, the interface's),
 * a line, then every language in the app's order.
 */
export const FileOptionsFields: React.FC<FileOptionsFieldsProps> = ({ value, onChange, offered, eachSide = false }) => {
  const { t, i18n } = useTranslation();
  const labelOf = useLanguageLabel();
  const othersId = useId();
  const ui = i18n?.language ?? 'en';
  const browser = typeof navigator !== 'undefined' ? navigator.languages ?? [] : [];
  const browserKey = browser.join(',');
  const ctx: OrderContext = useMemo(() => ({ ui, browser }), [ui, browserKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [main = '', ...others] = value.languages;
  // The service's languages, and any chosen that it does not list (so a choice is never hidden).
  const all = useMemo(
    () => [...new Set([...offered, ...value.languages, value.translateTo])].filter((code) => code && code !== EACH_SIDE).map((code) => ({ value: code })),
    [offered, value],
  );
  const likelyPair = { source: main, target: value.translateTo };
  const choices = (options: readonly { value: string }[]) => {
    const pinned = pinnedLanguages(options, likelyPair, ctx);
    return (
      <>
        {pinned.map((o) => <option key={`pin:${o.value}`} value={o.value}>{labelOf(o.value)}</option>)}
        {pinned.length > 0 && <option key="pin-separator" value={PIN_SEPARATOR} disabled>{SEPARATOR}</option>}
        {orderLanguages(options, ctx).map((o) => <option key={o.value} value={o.value}>{labelOf(o.value)}</option>)}
      </>
    );
  };
  const add = t('history.file.addLanguage', 'Add another language');
  return (
    <>
      <label className="history-file__field">
        <span>{t('history.file.mainLanguage', 'Main language')}</span>
        <select className="select-dropdown" value={main} onChange={(e) => onChange(withMain(value, e.target.value))}>{choices(all)}</select>
      </label>
      <div className="history-file__field" role="group" aria-labelledby={othersId}>
        <span id={othersId}>{t('history.file.otherLanguages', 'Other languages it may contain')}</span>
        {others.length > 0 && (
          <ul className="history-file__languages">
            {others.map((code) => (
              <li key={code}>
                <span>{labelOf(code)}</span>
                <button
                  type="button"
                  className="history-file__remove"
                  aria-label={t('history.file.removeLanguage', 'Remove {{language}}', { language: labelOf(code) })}
                  onClick={() => onChange(withoutOther(value, code))}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <select className="select-dropdown" aria-label={add} value="" onChange={(e) => { if (e.target.value) onChange(withOther(value, e.target.value)); }}>
          {/* The closed list's own words, not a choice in the open one. */}
          <option value="" className="history-file__placeholder" disabled hidden>{add}</option>
          {choices(all.filter((o) => !value.languages.includes(o.value)))}
        </select>
      </div>
      <label className="history-file__field">
        <span>{t('history.file.translateInto', 'Translate into')}</span>
        <select className="select-dropdown" value={value.translateTo} onChange={(e) => onChange({ ...value, translateTo: e.target.value })}>
          {eachSide && <option value={EACH_SIDE}>{t('history.file.eachSide', 'Each side into the other’s language')}</option>}
          {choices(all)}
        </select>
      </label>
    </>
  );
};

export interface ImportPanelProps {
  file: File;
  /** The user's language: preselected, and the notes' language. */
  myLanguage: string;
  onClose(): void;
}

export const ImportPanel: React.FC<ImportPanelProps> = ({ file, myLanguage, onClose }) => {
  const { t } = useTranslation();
  const { store } = useHistoryPageContext();
  const texts = useFileTexts();
  const checked = useBlocked('import');
  const panel = usePanel(onClose);
  const { offered, unchecked } = useFileLanguages();
  const { known } = checked;
  const blocked = checked.blocked ?? (unchecked ? 'unchecked' : null);
  const [chosen, setChosen] = useState(() => importOptions(myLanguage));
  // As the service can take them: "automatic" or a language it does not have is never sent.
  const options = fitOptions(chosen, offered, myLanguage, false);
  const title = t('history.file.importTitle', 'Import “{{name}}”', { name: file.name });
  const start = () => {
    void store.getState().importFile(file, { options, myLanguage });
    onClose();
  };
  return (
    <div className="history-confirm history-file" role="dialog" aria-label={title} {...panel}>
      <p className="history-file__title">{title}</p>
      <FileOptionsFields value={options} onChange={setChosen} offered={offered} />
      {serviceFine(known, blocked) && <p>{texts.service}</p>}
      {blocked && <Blocked text={texts.block(blocked)} fix={texts.fix(blocked)} onClose={onClose} />}
      <div className="history-confirm__actions">
        <button type="button" className="history-button" disabled={!known || blocked !== null || offered.length === 0} onClick={start}>{t('history.file.start', 'Start')}</button>
        <button type="button" className="history-button history-button--quiet" onClick={onClose}>{t('history.cancel', 'Cancel')}</button>
      </div>
    </div>
  );
};

export const TranscribePanel: React.FC<{ onClose(): void }> = ({ onClose }) => {
  const { t, i18n } = useTranslation();
  const { store } = useHistoryPageContext();
  const open = useStore(store, (s) => s.open);
  const texts = useFileTexts();
  const checked = useBlocked('transcribe');
  const panel = usePanel(onClose);
  const { offered, unchecked } = useFileLanguages();
  const { known } = checked;
  const blocked = checked.blocked ?? (unchecked ? 'unchecked' : null);
  // Chosen here for the record open, or else what the record was last transcribed with (or its languages).
  const [chosen, setChosen] = useState<{ recordId: string; options: FileTranscriptionOptions } | null>(null);
  if (!open) return null;
  const record = open.record;
  // Only when the service translates into both sides' languages: else a side would go untranslated.
  const eachSide = eachSideOffered(record, offered);
  const asked = chosen?.recordId === record.id ? chosen.options : optionsFor(record);
  // As the service can take them: "automatic" or a language it does not have is never sent.
  const options = fitOptions(asked, offered, myLanguageNow(i18n?.language ?? 'en'), eachSide);
  const kept = record.tracks.filter((tr) => tr.goneAt === null);
  const title = record.transcripts.length > 0 ? t('history.file.transcribeAgain', 'Transcribe again') : t('history.file.transcribe', 'Transcribe');
  const why = kept.length === 0 ? texts.block('no-recording') : blocked ? texts.block(blocked) : null;
  const start = () => {
    void store.getState().transcribeOpen(options);
    onClose();
  };
  return (
    <div className="history-confirm history-file record-page__confirm" role="dialog" aria-label={title} {...panel}>
      <p className="history-file__title">{title}</p>
      <p>{t('history.file.transcribeNote', 'The saved recording is transcribed again. A new version is made; the transcripts already here stay.')}</p>
      <FileOptionsFields value={options} onChange={(o) => setChosen({ recordId: record.id, options: o })} offered={offered} eachSide={eachSide} />
      {serviceFine(known, blocked) && <p>{texts.service}</p>}
      {why && <Blocked text={why} fix={kept.length === 0 ? null : texts.fix(blocked)} onClose={onClose} />}
      <div className="history-confirm__actions">
        <button type="button" className="history-button" disabled={!known || why !== null || offered.length === 0} onClick={start}>{t('history.file.start', 'Start')}</button>
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
        {/* Writing the transcript is the last, short step, and cannot be stopped half way. */}
        {job.phase !== 'writing' && (
          <button type="button" className="history-button" onClick={() => store.getState().cancelJob()}>{t('history.cancel', 'Cancel')}</button>
        )}
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

/**
 * What the transcript shown was asked for, when it is a file transcript that kept its options: the main language and
 * the translation, each version its own (the other languages are in the "transcribe again" panel).
 */
export const TranscriptAsked: React.FC = () => {
  const { t } = useTranslation();
  const labelOf = useLanguageLabel();
  const { store } = useHistoryPageContext();
  const open = useStore(store, (s) => s.open);
  const shown = open?.record.transcripts.find((tr) => tr.id === open.transcriptId);
  const asked = shown?.origin.kind === 'file' ? shown.origin.options : undefined;
  if (!asked || !Array.isArray(asked.languages) || !asked.languages[0] || !asked.translateTo) return null;
  const main = labelOf(asked.languages[0]);
  return (
    <p className="record-page__asked">
      {asked.translateTo === EACH_SIDE
        ? t('history.file.askedEachSide', 'Main language: {{main}} · Each side translated into the other’s language', { main })
        : t('history.file.asked', 'Main language: {{main}} · Translated into: {{target}}', { main, target: labelOf(asked.translateTo) })}
    </p>
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
      <select className="select-dropdown" value={open.transcriptId ?? ''} onChange={(e) => void store.getState().showTranscript(Number(e.target.value))}>
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
