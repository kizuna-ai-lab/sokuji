// src/components/History/HistoryPage.tsx
//
// The History page (desktop): it takes the place of the conversation, which stays mounted underneath so a running
// session goes on. It shows the list of records, or one record when it is opened. Escape closes the record, or on
// the list leaves History; an Escape a text field inside the page handled (it stops it) does nothing more.
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { realClock } from '../../lib/contract/clock';
import { historyPort } from '../../lib/history/port';
import { createHistoryPageStore } from '../../lib/history/historyPageStore';
import { appNotesRunner } from '../../lib/notes/appNotes';
import { appFileJobs } from '../../lib/history/file/appFiles';
import { isElectron } from '../../utils/environment';
import { HistoryPageContext } from './historyContext';
import HistoryList from './HistoryList';
import { FileJobLine } from './FileJobs';
import RecordPage from './RecordPage';
import { isComposing } from './format';
import './History.scss';

export interface HistoryPageProps {
  onClose(): void;
  /** A record to open at once (the live notes' way to History). */
  recordId?: string | null;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ onClose, recordId = null }) => {
  const { t } = useTranslation();
  const [store] = useState(() => createHistoryPageStore(
    historyPort(), realClock, () => t('history.failed', 'That did not work. Try again.'), isElectron() ? appNotesRunner() : null,
    isElectron() ? appFileJobs() : null,
  ));
  const open = useStore(store, (s) => s.open);
  const error = useStore(store, (s) => s.error);

  useEffect(() => { void store.getState().load(); }, [store]);
  useEffect(() => { if (recordId) void store.getState().openRecord(recordId); }, [store, recordId]);
  // The page's store follows the app's notes runner while the page is open, and no longer (StrictMode's second run
  // of the effect follows again).
  useEffect(() => {
    store.getState().follow();
    return () => store.getState().dispose();
  }, [store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isComposing(e)) return;
      if (store.getState().open) store.getState().closeRecord();
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [store, onClose]);

  const context = useMemo(() => ({ store, onClose }), [store, onClose]);

  return (
    <HistoryPageContext.Provider value={context}>
      <section className="history-page" data-testid="history-page" aria-label={t('history.title', 'History')}>
        {error && <p className="history-page__error" role="alert">{error}</p>}
        <FileJobLine />
        {/* The list stays mounted under an open record: going back finds its search, selection and scroll. */}
        <div className="history-page__list" hidden={!!open}><HistoryList hidden={!!open} /></div>
        {open && <RecordPage />}
      </section>
    </HistoryPageContext.Provider>
  );
};

export default HistoryPage;
