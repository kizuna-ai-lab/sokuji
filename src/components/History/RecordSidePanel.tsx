// src/components/History/RecordSidePanel.tsx
//
// A record's side panel, at the right of its transcript (owner, 2026-11-17): the speakers now (who spoke, how many
// sentences each, their names), more tools later, each in a part of its own. One small handle opens and closes it, its
// chevrons saying which way it goes, its name in its tooltip; it rides on the panel's edge, at the transcript's top
// right while the panel is closed. The panel covers the transcript, in wide and narrow windows alike, so the transcript
// keeps its width.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { isComposing } from './format';

export interface RecordSidePanelProps {
  open: boolean;
  onToggle(): void | Promise<void>;
  /** Something is being typed in the panel: Escape is the field's (it cancels the typing), not the panel's. */
  editing: boolean;
  /** The panel's parts. */
  children: ReactNode;
}

export function RecordSidePanel({ open, onToggle, editing, children }: RecordSidePanelProps) {
  const { t } = useTranslation();
  const id = useId();
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;

  // Escape closes an open panel before the page hears it (the page would go back to the list). Heard first, so a name
  // being typed keeps its Escape: that one cancels the name.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isComposing(e) || editingRef.current) return;
      e.preventDefault();
      void toggleRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  const handle = open ? t('history.closeSidePanel', 'Close the side panel') : t('history.openSidePanel', 'Open the side panel');
  return (
    <div className={`record-side${open ? ' is-open' : ''}`}>
      <button type="button" className="record-side__handle" aria-label={handle} title={handle} aria-expanded={open} aria-controls={id} onClick={() => void onToggle()}>
        {open ? <ChevronsRight size={14} aria-hidden="true" /> : <ChevronsLeft size={14} aria-hidden="true" />}
      </button>
      {open && (
        <aside className="record-side__panel" id={id} aria-label={t('history.sidePanel', 'Side panel')}>
          {children}
        </aside>
      )}
    </div>
  );
}
