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
import { HistoryPageContext } from './historyContext';
import HistoryList from './HistoryList';
import RecordPage from './RecordPage';
import './History.scss';

export interface HistoryPageProps {
  onClose(): void;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const [store] = useState(() => createHistoryPageStore(historyPort(), realClock, () => t('history.failed', 'That did not work. Try again.')));
  const open = useStore(store, (s) => s.open);
  const error = useStore(store, (s) => s.error);

  useEffect(() => { void store.getState().load(); }, [store]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
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
        {open ? <RecordPage /> : <HistoryList />}
      </section>
    </HistoryPageContext.Provider>
  );
};

export default HistoryPage;
