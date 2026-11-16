// src/components/History/RecordSpeakersDrawer.tsx
//
// A record's speakers, in a drawer at the side of its transcript (owner, 2026-11-17): who spoke, how many sentences
// each, and their names. One button opens and closes it, its chevrons saying which way it goes; it rides on the
// drawer's edge, at the transcript's top right while the drawer is closed. The drawer covers the transcript, in wide
// and narrow windows alike, so the transcript keeps its width.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { isComposing } from './format';

export interface RecordSpeakersDrawerProps {
  open: boolean;
  onToggle(): void;
  /** A name is being typed in the drawer: Escape is the field's (it cancels the name), not the drawer's. */
  editing: boolean;
  /** The drawer's content: the speakers by side. */
  children: ReactNode;
}

export function RecordSpeakersDrawer({ open, onToggle, editing, children }: RecordSpeakersDrawerProps) {
  const { t } = useTranslation();
  const id = useId();
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;

  // Escape closes an open drawer before the page hears it (the page would go back to the list). Heard first, so a name
  // being typed keeps its Escape: that one cancels the name.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isComposing(e) || editingRef.current) return;
      e.preventDefault();
      toggleRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  const label = t('history.speakers', 'Speakers');
  return (
    <div className={`record-speakers-drawer${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="history-button record-speakers-drawer__toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        {open ? <ChevronsRight size={14} aria-hidden="true" /> : <ChevronsLeft size={14} aria-hidden="true" />}
        {t('history.editSpeakers', 'Edit speakers')}
      </button>
      {open && (
        <aside className="record-speakers-drawer__panel" id={id} aria-label={label}>
          <h3>{label}</h3>
          <p className="record-speakers-drawer__hint">
            {t('history.speakersHint', 'Click a name to rename the speaker. To give one sentence to someone else, use the “Change speaker” button beside it in the transcript.')}
          </p>
          {children}
        </aside>
      )}
    </div>
  );
}
