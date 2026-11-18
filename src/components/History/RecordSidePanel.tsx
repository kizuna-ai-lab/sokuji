// src/components/History/RecordSidePanel.tsx
//
// A record's edit panel (named "Edit", owner, 2026-11-18): the speakers now (who spoke, how many sentences each, their
// names), tools that fix the transcript later, each in a part of its own. Never over the transcript: on a wide page a
// column at its right, shown and hidden from a switch in the page's toolbar (the page's, with `id` naming it); on a narrow
// one the third tab. Escape leaves it too. The page lays it out.
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

  if (!open) return null;
  return (
    <aside className="record-side" id={id} aria-label={t('history.sidePanel', 'Edit')}>
      {children}
    </aside>
  );
}
