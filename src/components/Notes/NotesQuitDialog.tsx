// src/components/Notes/NotesQuitDialog.tsx
//
// The question asked when the app is closed while notes are being written (ruling 7): Quit stores them as cancelled,
// Stay keeps the app. The session asks through `askQuitWhileNotes`; this shows it over the page.
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuitQuestion } from '../../lib/notes/quitQuestion';
import './NotesQuitDialog.scss';

export function NotesQuitDialog() {
  const { t } = useTranslation();
  const asking = useQuitQuestion((s) => s.asking);
  const stayRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (asking) stayRef.current?.focus(); }, [asking]);
  if (!asking) return null;
  const text = asking.titles.length > 0
    ? t('notesQuit.named', 'Notes are being written for “{{title}}”. Quit anyway? They will be marked cancelled.', { title: asking.titles.join('”, “') })
    : t('notesQuit.unnamed', 'Notes are being written. Quit anyway? They will be marked cancelled.');
  return (
    <div className="notes-quit" role="alertdialog" aria-modal="true" aria-describedby="notes-quit-text"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); asking.answer('stay'); } }}>
      <div className="notes-quit__box">
        <p id="notes-quit-text">{text}</p>
        <div className="notes-quit__actions">
          <button type="button" className="notes-quit__button" onClick={() => asking.answer('quit')}>{t('notesQuit.quit', 'Quit')}</button>
          <button type="button" ref={stayRef} className="notes-quit__button notes-quit__button--primary" onClick={() => asking.answer('stay')}>{t('notesQuit.stay', 'Stay')}</button>
        </div>
      </div>
    </div>
  );
}

export default NotesQuitDialog;
