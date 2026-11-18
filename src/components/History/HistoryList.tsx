// src/components/History/HistoryList.tsx
//
// The list of records in the settings page's frame (the owner chose it, 2026-11-16): on the left the way back to the
// session, the search, "All records" and "Bin", and the space History takes; on the right the records by day, the
// search's results or the bin. Checkboxes appear only after "Select records", and the heading row then holds the count and
// the actions, kept at the top while the list scrolls (owner, 2026-11-17). A record still being written is listed as
// "In progress" and cannot be selected; nothing is deleted for good before the user answers a confirmation on the page.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { ChevronLeft, FileUp, FolderOpen, ListChecks, Search } from 'lucide-react';
import { languageDirection } from './languageDirection';
import type { HitTarget } from '../../lib/history/historyPageStore';
import type { HistoryRecordRow, HistorySearchHit, HistorySearchResult } from '../../lib/history/types';
import { isElectron } from '../../utils/environment';
import { useHistoryPageContext } from './historyContext';
import { ImportPanel, myLanguageNow } from './FileJobs';
import { dayLabel, formatBytes, formatDateTime, formatLength, formatTime, isComposing } from './format';
import { useWideForm } from '../SettingsPage/useWideForm';
import { LanguagePairText } from '../LanguagePairText/LanguagePairText';
import '../SettingsPage/SettingsPage.scss';
import './History.scss';

/** The matched text shown for a search result: at most this many characters around the match. */
const SNIPPET_CHARS = 80;

/** The hit's text cut to SNIPPET_CHARS around the first match of `query`. */
export function snippet(text: string, query: string, max = SNIPPET_CHARS): string {
  if (text.length <= max) return text;
  const at = Math.max(0, text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()));
  let start = Math.max(0, at - Math.floor((max - query.length) / 2));
  const end = Math.min(text.length, start + max);
  start = Math.max(0, end - max);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

const targetOf = (hit: HistorySearchHit): HitTarget => {
  switch (hit.kind) {
    case 'sentence': return { kind: 'sentence', transcriptId: hit.transcriptId, n: hit.n };
    case 'translation': return { kind: 'translation', segmentId: hit.segmentId };
    case 'notes': return { kind: 'notes', notesId: hit.notesId };
    default: return { kind: 'title' };
  }
};

/** History tells once, when it passes this size, how to make room (plan ruling 6). */
const SPACE_NOTICE_BYTES = 1024 * 1024 * 1024;
const SPACE_NOTICE_KEY = 'history.spaceNoticeDismissed';
const readSpaceDismissed = (): boolean => { try { return localStorage.getItem(SPACE_NOTICE_KEY) === '1'; } catch { return false; } };
const writeSpaceDismissed = (): void => { try { localStorage.setItem(SPACE_NOTICE_KEY, '1'); } catch { /* shown again next time */ } };

/** What waits for an answer before records are deleted for good: these records, or the whole bin. */
type Confirm = { ids: string[] } | { all: true; count: number };

export interface HistoryListProps {
  /** The list is kept, hidden, while a record is open: going back finds it as it was left. */
  hidden?: boolean;
}

export const HistoryList: React.FC<HistoryListProps> = ({ hidden = false }) => {
  const { t, i18n } = useTranslation();
  const { store, onClose } = useHistoryPageContext();
  const status = useStore(store, (s) => s.status);
  const tab = useStore(store, (s) => s.tab);
  const rows = useStore(store, (s) => s.rows);
  const notesRunning = useStore(store, (s) => s.notesRunning);
  const query = useStore(store, (s) => s.query);
  const results = useStore(store, (s) => s.results);
  const selected = useStore(store, (s) => s.selected);
  const usage = useStore(store, (s) => s.usage);
  const busy = useStore(store, (s) => s.busy);
  const more = useStore(store, (s) => s.more);
  const actions = store.getState();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [selecting, setSelecting] = useState(false);
  const filesOffered = useStore(store, (s) => s.filesOffered);
  /** A file chosen to import, asked about before anything starts. */
  const [importing, setImporting] = useState<File | null>(null);
  const chooserRef = useRef<HTMLInputElement>(null);
  const [spaceDismissed, setSpaceDismissed] = useState(readSpaceDismissed);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLElement>(null);
  const scrolledTo = useRef(0);
  const wide = useWideForm(root);
  const language = i18n.language;

  useEffect(() => { if (confirm) cancelRef.current?.focus(); }, [confirm]);
  useEffect(() => { setConfirm(null); setSelecting(false); }, [tab]);
  // A hidden element may lose its scroll position: the last one is put back when the list shows again.
  useLayoutEffect(() => {
    if (!hidden && scroller.current) scroller.current.scrollTop = scrolledTo.current;
  }, [hidden]);

  const titleOf = (r: { title: string | null; startedAt: number }) => r.title ?? formatDateTime(r.startedAt, language);
  const searching = query.trim() !== '';

  const back = (
    <button type="button" className="settings-page__back" onClick={onClose}>
      <ChevronLeft size={14} aria-hidden="true" /> {t('history.backToSession', 'Back to the session')}
    </button>
  );
  const frame = (nav: React.ReactNode, content: React.ReactNode) => (
    <div ref={root} className={`settings-page settings-page--${wide ? 'wide' : 'narrow'} history-list`} data-testid="history-list">
      <div className="settings-page__columns">{nav}{content}</div>
    </div>
  );

  if (status && !status.available) {
    return frame(
      <nav className="settings-page__nav history-nav" aria-label={t('history.title', 'History')}>{back}</nav>,
      <section className="settings-page__content">
        <header><h2>{t('history.title', 'History')}</h2></header>
        <div className="settings-page__body">
          <p className="history-list__empty" role="status">
            {status.reason === 'newer'
              ? t('history.unavailableNewer', 'This History was written by a newer version of Sokuji. Update Sokuji to open it.')
              : t('history.unavailable', 'History could not be opened.')}
          </p>
        </div>
      </section>,
    );
  }

  const openFolder = () => { if (status?.dir && isElectron()) void window.electron.invoke('open-directory', status.dir); };
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape' || query === '' || isComposing(e.nativeEvent)) return;
    // The search is cleared; the page does not take this Escape as a way out.
    e.preventDefault();
    actions.setQuery('');
  };
  /** The records or the bin; a search shown ends. */
  const showTab = (next: 'records' | 'bin') => {
    if (query) actions.setQuery('');
    if (next !== tab) void actions.setTab(next);
  };
  const leaveSelect = () => { actions.clearSelection(); setSelecting(false); };
  const confirmCount = confirm ? ('all' in confirm ? confirm.count : confirm.ids.length) : 0;
  const purgeConfirmed = () => {
    if (!confirm) return;
    setConfirm(null);
    void ('all' in confirm ? actions.emptyBin() : actions.purge(confirm.ids));
  };

  const tags = (r: HistoryRecordRow) => (
    <span className="history-row__tags">
      {r.sentences > 0 && <span className="history-tag">{t('history.tagTranscript', 'Transcript')}</span>}
      {notesRunning.includes(r.id) ? <span className="history-tag">{t('history.tagWritingNotes', 'Writing notes')}</span>
        : r.notesComplete ? <span className="history-tag">{t('history.tagNotes', 'Notes')}</span>
          : r.notesState === 'failed' && <span className="history-tag history-tag--failed">{t('history.tagNotesFailed', 'Notes failed')}</span>}
      {r.hasRecording && <span className="history-tag">{`${t('history.tagRecording', 'Recording')} · ${formatBytes(r.audioBytes)}`}</span>}
      {r.state === 'closed' && r.sentences === 0 && r.hasRecording && <span className="history-tag">{t('history.file.notTranscribed', 'Not transcribed')}</span>}
    </span>
  );

  /** Under a day heading the time is enough; a list without headings (the bin) gives the date too. */
  const meta = (r: HistoryRecordRow, withDate = false) => (
    <span className="history-row__meta">
      {withDate
        ? <span>{formatDateTime(r.startedAt, language)}</span>
        : r.title !== null && <span>{formatTime(r.startedAt, language)}</span>}
      {r.state === 'open' || r.endedAt === null
        ? <span className="history-row__live">{t('history.inProgress', 'In progress')}</span>
        : <span>{t('history.length', 'Length {{length}}', { length: formatLength(r.endedAt - r.startedAt) })}</span>}
      {r.mode !== 'import' && <span><LanguagePairText {...languageDirection(r, language, t)} /></span>}
    </span>
  );

  const recordRow = (r: HistoryRecordRow) => {
    // Under its day heading an untitled record is named by its start time; the date would only repeat the heading.
    const title = r.title ?? t('history.sessionAt', 'Session at {{time}}', { time: formatTime(r.startedAt, language) });
    const live = r.state === 'open';
    const onRow = () => {
      if (!selecting) void actions.openRecord(r.id);
      else if (!live) actions.toggle(r.id);
    };
    return (
      <li key={r.id} className={`history-row${selecting && selected.has(r.id) ? ' is-selected' : ''}`} data-record={r.id}>
        {selecting && (live
          ? <span className="history-row__check" />
          : (
            <input
              type="checkbox"
              className="history-row__check"
              aria-label={t('history.select', 'Select “{{title}}”', { title })}
              checked={selected.has(r.id)}
              onChange={() => actions.toggle(r.id)}
            />
          ))}
        <button type="button" className="history-row__open" onClick={onRow}>
          <span className="history-row__title">{title}</span>
          {meta(r)}
        </button>
        {tags(r)}
      </li>
    );
  };

  const binRow = (r: HistoryRecordRow) => (
    <li key={r.id} className="history-row" data-record={r.id}>
      <div className="history-row__body">
        <span className="history-row__title">{titleOf(r)}</span>
        {meta(r, r.title !== null)}
      </div>
      <div className="history-row__actions">
        <button type="button" className="history-button" disabled={busy} onClick={() => void actions.restore([r.id])}>
          {t('history.restore', 'Restore')}
        </button>
        <button type="button" className="history-button history-button--danger" disabled={busy} onClick={() => setConfirm({ ids: [r.id] })}>
          {t('history.deleteForGood', 'Delete for good')}
        </button>
      </div>
    </li>
  );

  const resultRow = (r: HistorySearchResult) => (
    <li key={r.recordId} className="history-row" data-record={r.recordId}>
      <button type="button" className="history-row__open" onClick={() => void actions.openRecord(r.recordId, targetOf(r.first))}>
        <span className="history-row__title">{titleOf(r)}</span>
        {'text' in r.first
          ? <span className="history-row__snippet">{snippet(r.first.text, query)}</span>
          : <span className="history-row__snippet">
            {r.first.kind === 'notes' ? t('history.foundInNotes', 'Found in the notes') : t('history.foundInTitle', 'Found in the title')}
          </span>}
        <span className="history-row__meta">{t('history.hits', '{{count}} matches', { count: r.hits })}</span>
      </button>
    </li>
  );

  /** Records grouped by the day they started, newest first as listed. */
  const byDay = () => {
    const now = Date.now();
    const groups: Array<{ label: string; rows: HistoryRecordRow[] }> = [];
    for (const r of rows) {
      const label = dayLabel(r.startedAt, now, language);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.rows.push(r);
      else groups.push({ label, rows: [r] });
    }
    return groups.map((g) => (
      <section key={g.label} className="history-day">
        <h3 className="history-day__label">{g.label}</h3>
        <ul className="history-list__rows">{g.rows.map(recordRow)}</ul>
      </section>
    ));
  };

  let body: React.ReactNode;
  if (!status) body = null;
  else if (searching) {
    if (results === null) body = null;
    else if (results.length === 0) body = <p className="history-list__empty">{t('history.nothingFound', 'Nothing found for “{{query}}”.', { query: query.trim() })}</p>;
    else body = <ul className="history-list__rows">{results.map(resultRow)}</ul>;
  } else if (rows.length === 0) {
    body = <p className="history-list__empty">{tab === 'records' ? t('history.noRecords', 'Your sessions are kept here.') : t('history.binEmpty', 'The bin is empty.')}</p>;
  } else {
    body = (
      <>
        {tab === 'records' ? byDay() : <ul className="history-list__rows">{rows.map(binRow)}</ul>}
        {more && (
          <div className="history-list__more">
            <button type="button" className="history-button history-button--quiet" disabled={busy} onClick={() => void actions.showOlder()}>
              {t('history.showOlder', 'Show older records')}
            </button>
          </div>
        )}
      </>
    );
  }

  const heading = searching ? t('history.results', 'Search results') : tab === 'records' ? t('history.allRecords', 'All records') : t('history.binTitle', 'Bin');
  let headAction: React.ReactNode = null;
  const selectingNow = selecting && !searching && tab === 'records';
  if (selectingNow) {
    // Where "Select records" was clicked: the count beside the heading, the actions at the end of the row.
    headAction = (
      <>
        <span className="history-content__count">{t('history.selectedCount', '{{count}} selected', { count: selected.size })}</span>
        <span className="history-content__actions">
          <button
            type="button"
            className="history-button"
            disabled={busy || selected.size === 0}
            onClick={async () => { await actions.binSelected(); setSelecting(false); }}
          >
            {t('history.moveOneToBin', 'Move to bin')}
          </button>
          <button type="button" className="history-button history-button--quiet" onClick={leaveSelect}>
            {t('history.cancel', 'Cancel')}
          </button>
        </span>
      </>
    );
  } else if (status && !searching && tab === 'records' && rows.length > 0) {
    headAction = (
      <button type="button" className="history-button history-button--quiet history-content__select" onClick={() => setSelecting(true)}>
        <ListChecks size={14} aria-hidden="true" />
        {t('history.selectRecords', 'Select records')}
      </button>
    );
  } else if (status && !searching && tab === 'bin' && rows.length > 0) {
    headAction = (
      <button type="button" className="history-button history-button--danger" disabled={busy} onClick={() => setConfirm({ all: true, count: usage?.binned ?? rows.length })}>
        {t('history.emptyBin', 'Empty bin')}
      </button>
    );
  }

  const navItem = (id: 'records' | 'bin', label: string, count: number | undefined) => {
    const current = tab === id && !searching;
    return (
      <button type="button" className={`settings-page__item history-nav__item${current ? ' is-current' : ''}`} aria-current={current ? 'page' : undefined} onClick={() => showTab(id)}>
        <span>{label}</span>
        {count !== undefined && <small>{count}</small>}
      </button>
    );
  };

  return frame(
    <nav className="settings-page__nav history-nav" aria-label={t('history.title', 'History')}>
      {back}
      {status && (
        <label className="settings-page__search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            aria-label={t('history.search', 'Search History')}
            placeholder={t('history.searchPlaceholder', 'Search titles, transcripts and notes')}
            value={query}
            onChange={(e) => actions.setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
        </label>
      )}
      {status && (
        <div className="settings-page__group history-nav__items">
          {/* The store counts every stored record, the binned ones too; "All records" lists those not in the bin. */}
          {navItem('records', t('history.allRecords', 'All records'), usage ? Math.max(0, usage.records - usage.binned) : undefined)}
          {navItem('bin', t('history.binTitle', 'Bin'), usage?.binned)}
        </div>
      )}
      {status && filesOffered && (
        <>
          <button type="button" className="history-button history-nav__import" onClick={() => chooserRef.current?.click()}>
            <FileUp size={14} aria-hidden="true" />
            {t('history.file.import', 'Import a file')}
          </button>
          <input
            ref={chooserRef}
            type="file"
            accept="audio/*,video/*"
            tabIndex={-1}
            hidden
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              e.target.value = '';
              if (chosen) setImporting(chosen);
            }}
          />
        </>
      )}
      {status && (
        <div className="history-nav__space">
          {usage && <span>{t('history.space', '{{size}} in {{count}} records', { size: formatBytes(usage.dbBytes + usage.audioBytes), count: usage.records })}</span>}
          <button type="button" className="history-nav__folder" title={status.dir} onClick={openFolder}>
            <FolderOpen size={13} aria-hidden="true" />
            {t('history.openFolder', 'Open folder')}
          </button>
        </div>
      )}
    </nav>,
    <section className="settings-page__content history-content" ref={scroller} onScroll={(e) => { if (!hidden) scrolledTo.current = e.currentTarget.scrollTop; }}>
      <header className={selectingNow ? 'is-selecting' : undefined}>
        <div className="history-content__head">
          <h2>{heading}</h2>
          {headAction}
        </div>
        {!searching && tab === 'bin' && <p className="settings-page__intro">{t('history.binNote', 'Records in the bin are deleted for good after 30 days.')}</p>}
      </header>
      <div className="settings-page__body">
        {importing && <ImportPanel file={importing} myLanguage={myLanguageNow(language)} onClose={() => setImporting(null)} />}
        {usage && !spaceDismissed && usage.dbBytes + usage.audioBytes >= SPACE_NOTICE_BYTES && (
          <div className="history-notice" role="status">
            <p>{t('history.spaceNotice', 'History now takes {{size}}. Records can be deleted for good in the bin, or a record’s recording alone under “More”.', { size: formatBytes(usage.dbBytes + usage.audioBytes) })}</p>
            <button type="button" className="history-button" onClick={() => { writeSpaceDismissed(); setSpaceDismissed(true); }}>
              {t('history.gotIt', 'Got it')}
            </button>
          </div>
        )}
        {confirm && (
          <div
            className="history-confirm"
            role="alertdialog"
            aria-label={t('history.deleteForGood', 'Delete for good')}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setConfirm(null); } }}
          >
            <p>{t('history.confirmPurge', 'Delete {{count}} records for good? Their transcripts and recordings cannot be brought back.', { count: confirmCount })}</p>
            <div className="history-confirm__actions">
              <button type="button" className="history-button history-button--danger" disabled={busy} onClick={purgeConfirmed}>
                {t('history.delete', 'Delete')}
              </button>
              <button type="button" ref={cancelRef} className="history-button" onClick={() => setConfirm(null)}>
                {t('history.cancel', 'Cancel')}
              </button>
            </div>
          </div>
        )}
        {body}
      </div>
    </section>,
  );
};

export default HistoryList;
