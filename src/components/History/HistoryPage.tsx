// src/components/History/HistoryPage.tsx
//
// The History page (desktop): it takes the place of the conversation, which stays mounted underneath so a running
// session goes on. It shows the list of records, or one record when it is opened. Escape closes the record, or on
// the list leaves History; an Escape a text field inside the page handled (it stops it) does nothing more.
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { X } from 'lucide-react';
import { realClock } from '../../lib/contract/clock';
import { historyPort } from '../../lib/history/port';
import { createHistoryPageStore } from '../../lib/history/historyPageStore';

export interface HistoryPageProps {
  onClose(): void;
}

export const HistoryPage: React.FC<HistoryPageProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const [store] = useState(() => createHistoryPageStore(historyPort(), realClock, () => t('history.failed', 'That did not work. Try again.')));
  const open = useStore(store, (s) => s.open);
  const status = useStore(store, (s) => s.status);
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

  return (
    <section className="history-page" data-testid="history-page" aria-label={t('history.title', 'History')}>
      <header className="history-page__head">
        <h2>{t('history.title', 'History')}</h2>
        <button type="button" className="history-page__close" onClick={onClose} aria-label={t('history.close', 'Close History')}>
          <X size={14} />
        </button>
      </header>
      {status && !status.available && (
        <p className="history-page__unavailable" role="status">
          {status.reason === 'newer'
            ? t('history.unavailableNewer', 'History was saved by a newer version of Sokuji. Update Sokuji to see it.')
            : t('history.unavailable', 'History cannot be opened right now.')}
        </p>
      )}
      {error && <p className="history-page__error" role="alert">{error}</p>}
      {open ? <div className="history-page__record" /> : <div className="history-page__list" />}
    </section>
  );
};

export default HistoryPage;
