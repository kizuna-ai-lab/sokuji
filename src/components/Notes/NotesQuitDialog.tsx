// src/components/Notes/NotesQuitDialog.tsx
//
// The question asked when the app is closed while notes are being written (ruling 7): Quit stores them as cancelled,
// Stay keeps the app. The session asks through `askQuitWhileNotes`; this shows it over the page.
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuitQuestion } from '../../lib/notes/quitQuestion';
import { formatDateTime } from '../History/format';
import './NotesQuitDialog.scss';

export function NotesQuitDialog() {
  const { t, i18n } = useTranslation();
  const asking = useQuitQuestion((s) => s.asking);
  const quitRef = useRef<HTMLButtonElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  // Focus goes to Stay while the question is open and back to where it was once it is answered.
  useEffect(() => {
    if (!asking) return undefined;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stayRef.current?.focus();
    return () => { if (before?.isConnected) before.focus(); };
  }, [asking]);
  if (!asking) return null;
  // Each record as History names it: its title, or, when nobody gave it one, when it started.
  const names = asking.records.map((r) => r.title ?? formatDateTime(r.startedAt, i18n.language));
  const text = names.length > 0
    ? t('notesQuit.named', 'Notes are being written for “{{title}}”. Quit anyway? They will be marked cancelled.', { title: names.join('”, “') })
    : t('notesQuit.unnamed', 'Notes are being written. Quit anyway? They will be marked cancelled.');
  return (
    <div className="notes-quit" role="alertdialog" aria-modal="true" aria-labelledby="notes-quit-text"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); asking.answer('stay'); return; }
        // Tab goes round the two answers and never behind the question.
        if (e.key !== 'Tab') return;
        const [first, last] = [quitRef.current, stayRef.current];
        const at = document.activeElement;
        if (e.shiftKey ? at === first || !e.currentTarget.contains(at) : at === last || !e.currentTarget.contains(at)) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        }
      }}>
      <div className="notes-quit__box">
        <p id="notes-quit-text">{text}</p>
        <div className="notes-quit__actions">
          <button type="button" ref={quitRef} className="notes-quit__button" onClick={() => asking.answer('quit')}>{t('notesQuit.quit', 'Quit')}</button>
          <button type="button" ref={stayRef} className="notes-quit__button notes-quit__button--primary" onClick={() => asking.answer('stay')}>{t('notesQuit.stay', 'Stay')}</button>
        </div>
      </div>
    </div>
  );
}

export default NotesQuitDialog;
