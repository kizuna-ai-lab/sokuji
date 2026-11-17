// src/components/History/RecordSidePanel.tsx
//
// A record's side panel, at the right of its transcript (owner, 2026-11-17): the speakers now (who spoke, how many
// sentences each, their names), more tools later, each in a part of its own. A switch in the page's toolbar shows and
// hides it (the page's, with `id` naming it); Escape hides it too. The panel covers the transcript, in wide and narrow
// windows alike, so the transcript keeps its width.
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isComposing } from './format';

export interface RecordSidePanelProps {
  /** The panel's id, for the toolbar switch that controls it. */
  id: string;
  open: boolean;
  onToggle(): void | Promise<void>;
  /** Something is being typed in the panel: Escape is the field's (it cancels the typing), not the panel's. */
  editing: boolean;
  /** The panel's parts. */
  children: ReactNode;
}

export function RecordSidePanel({ id, open, onToggle, editing, children }: RecordSidePanelProps) {
  const { t } = useTranslation();
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
      // An open menu or a field that takes Escape itself has it first: the panel closes only on an Escape nothing else
      // takes (review).
      if ((e.target as Element | null)?.closest?.('[data-escape-own]')) return;
      e.preventDefault();
      void toggleRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <div className={`record-side${open ? ' is-open' : ''}`}>
      {open && (
        <aside className="record-side__panel" id={id} aria-label={t('history.sidePanel', 'Side panel')}>
          {children}
        </aside>
      )}
    </div>
  );
}
