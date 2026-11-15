// src/components/History/HistoryList.tsx
//
// The list of records: search, the bin and the space History takes. A record still being written is listed as
// "In progress" and cannot be selected; nothing is deleted for good before the user answers a confirmation on the page.
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { ArrowLeft, FileText, FolderOpen, Mic, NotebookPen } from 'lucide-react';
import { languageLabel } from '../../lib/language/label';
import type { HitTarget } from '../../lib/history/historyPageStore';
import type { HistoryRecordRow, HistorySearchHit, HistorySearchResult } from '../../lib/history/types';
import { isElectron } from '../../utils/environment';
import { useHistoryPageContext } from './historyContext';
import { formatBytes, formatDate, formatDateTime, formatLength, isComposing } from './format';
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

/** What waits for an answer before records are deleted for good: these records, or the whole bin. */
type Confirm = { ids: string[] } | { all: true; count: number };

export const HistoryList: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { store, onClose } = useHistoryPageContext();
  const status = useStore(store, (s) => s.status);
  const tab = useStore(store, (s) => s.tab);
  const rows = useStore(store, (s) => s.rows);
  const query = useStore(store, (s) => s.query);
  const results = useStore(store, (s) => s.results);
  const selected = useStore(store, (s) => s.selected);
  const usage = useStore(store, (s) => s.usage);
  const busy = useStore(store, (s) => s.busy);
  const more = useStore(store, (s) => s.more);
  const actions = store.getState();
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const language = i18n.language;

  useEffect(() => { if (confirm) cancelRef.current?.focus(); }, [confirm]);
  useEffect(() => { setConfirm(null); }, [tab]);

  const titleOf = (r: { title: string | null; startedAt: number }) => r.title ?? formatDateTime(r.startedAt, language);
  const languagesOf = (r: HistoryRecordRow) => `${languageLabel(r.myLanguage, language)} → ${languageLabel(r.targetLanguage, language)}`;

  const back = (
    <button type="button" className="history-list__back" onClick={onClose}>
      <ArrowLeft size={14} />
      {t('history.back', 'Back')}
    </button>
  );

  if (status && !status.available) {
    return (
      <div className="history-list">
        <header className="history-list__head">
          {back}
          <h2 className="history-list__title">{t('history.title', 'History')}</h2>
        </header>
        <p className="history-list__empty" role="status">
          {status.reason === 'newer'
            ? t('history.unavailableNewer', 'This History was written by a newer version of Sokuji. Update Sokuji to open it.')
            : t('history.unavailable', 'History could not be opened.')}
        </p>
      </div>
    );
  }

  const searching = query.trim() !== '';
  const openFolder = () => { if (status?.dir && isElectron()) void window.electron.invoke('open-directory', status.dir); };
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape' || query === '' || isComposing(e.nativeEvent)) return;
    // The search is cleared; the page does not take this Escape as a way out.
    e.preventDefault();
    actions.setQuery('');
  };
  const confirmCount = confirm ? ('all' in confirm ? confirm.count : confirm.ids.length) : 0;
  const purgeConfirmed = () => {
    if (!confirm) return;
    setConfirm(null);
    void ('all' in confirm ? actions.emptyBin() : actions.purge(confirm.ids));
  };

  const marks = (r: HistoryRecordRow) => (
    <span className="history-row__marks">
      {r.sentences > 0 && <span role="img" aria-label={t('history.hasTranscript', 'Has a transcript')}><FileText size={14} /></span>}
      {r.hasRecording && <span role="img" aria-label={t('history.hasRecording', 'Has a recording')}><Mic size={14} /></span>}
      {r.notesVersions > 0 && <span role="img" aria-label={t('history.hasNotes', 'Has notes')}><NotebookPen size={14} /></span>}
    </span>
  );

  const meta = (r: HistoryRecordRow) => (
    <span className="history-row__meta">
      {/* A record without a title already shows its start time as one. */}
      {r.title !== null && <span>{formatDate(r.startedAt, language)}</span>}
      {r.state === 'open' || r.endedAt === null
        ? <span className="history-row__live">{t('history.inProgress', 'In progress')}</span>
        : <span>{formatLength(r.endedAt - r.startedAt)}</span>}
      <span>{languagesOf(r)}</span>
      {marks(r)}
    </span>
  );

  const recordRow = (r: HistoryRecordRow) => {
    const title = titleOf(r);
    return (
      <li key={r.id} className="history-row" data-record={r.id}>
        {r.state === 'open'
          ? <span className="history-row__check" />
          : (
            <input
              type="checkbox"
              className="history-row__check"
              aria-label={t('history.select', 'Select “{{title}}”', { title })}
              checked={selected.has(r.id)}
              onChange={() => actions.toggle(r.id)}
            />
          )}
        <button type="button" className="history-row__open" onClick={() => void actions.openRecord(r.id)}>
          <span className="history-row__title">{title}</span>
          {meta(r)}
        </button>
      </li>
    );
  };

  const binRow = (r: HistoryRecordRow) => (
    <li key={r.id} className="history-row" data-record={r.id}>
      <div className="history-row__body">
        <span className="history-row__title">{titleOf(r)}</span>
        {meta(r)}
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
        <ul className="history-list__rows">{rows.map(tab === 'records' ? recordRow : binRow)}</ul>
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

  return (
    <div className="history-list">
      <header className="history-list__head">
        {back}
        <h2 className="history-list__title">{t('history.title', 'History')}</h2>
        {status && (
          <input
            type="search"
            className="history-list__search"
            aria-label={t('history.search', 'Search History')}
            placeholder={t('history.searchPlaceholder', 'Search titles, transcripts and notes')}
            value={query}
            onChange={(e) => actions.setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
        )}
      </header>

      {status && (
        <div className="history-list__space">
          {usage && (
            <span>{t('history.space', '{{size}} in {{count}} records', { size: formatBytes(usage.dbBytes + usage.audioBytes), count: usage.records })}</span>
          )}
          <span className="history-list__dir" title={status.dir}>{status.dir}</span>
          <button type="button" className="history-button history-button--quiet" onClick={openFolder}>
            <FolderOpen size={14} />
            {t('history.openFolder', 'Open folder')}
          </button>
        </div>
      )}

      {status && !searching && (
        <div className="history-list__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'records'} className="history-list__tab" onClick={() => void actions.setTab('records')}>
            {t('history.records', 'Records')}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'bin'} className="history-list__tab" onClick={() => void actions.setTab('bin')}>
            {t('history.bin', 'Bin ({{count}})', { count: usage?.binned ?? 0 })}
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

      {status && !searching && tab === 'records' && selected.size > 0 && (
        <div className="history-list__bar" role="toolbar">
          <button type="button" className="history-button" disabled={busy} onClick={() => void actions.binSelected()}>
            {t('history.moveToBin', 'Move to bin ({{count}})', { count: selected.size })}
          </button>
          <button type="button" className="history-button history-button--quiet" onClick={() => actions.clearSelection()}>
            {t('history.clearSelection', 'Clear selection')}
          </button>
        </div>
      )}

      {status && !searching && tab === 'bin' && rows.length > 0 && (
        <div className="history-list__bar" role="toolbar">
          <span className="history-list__note">{t('history.binNote', 'Records in the bin are deleted for good after 30 days.')}</span>
          <button type="button" className="history-button history-button--danger" disabled={busy} onClick={() => setConfirm({ all: true, count: usage?.binned ?? rows.length })}>
            {t('history.emptyBin', 'Empty bin')}
          </button>
        </div>
      )}

      <div className="history-list__body">{body}</div>
    </div>
  );
};

export default HistoryList;
