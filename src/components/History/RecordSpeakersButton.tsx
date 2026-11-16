// src/components/History/RecordSpeakersButton.tsx
//
// A record's speakers, behind a button over its transcript (owner, 2026-11-17): who spoke, how many sentences each,
// and their names open in a small panel, so the transcript keeps the width a column of their own took. One panel for
// wide and narrow windows alike.
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import {
  autoUpdate, flip, FloatingFocusManager, FloatingPortal, offset, shift, size, useClick, useDismiss, useFloating,
  useInteractions, useRole,
} from '@floating-ui/react';

export interface RecordSpeakersButtonProps {
  /** How many speakers the panel lists. */
  count: number;
  /** A name is being typed in the panel: Escape is the field's (it cancels the name), not the panel's. */
  editing: boolean;
  /** The panel's content: the speakers by side. */
  children: ReactNode;
}

export function RecordSpeakersButton({ count, editing, children }: RecordSpeakersButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    middleware: [
      offset(4), flip(), shift({ padding: 8 }),
      size({ padding: 8, apply({ availableHeight, elements }) { Object.assign(elements.floating.style, { maxHeight: `${Math.max(0, availableHeight)}px` }); } }),
    ],
    whileElementsMounted: autoUpdate,
    strategy: 'fixed',
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context, { escapeKey: !editing }),
    useRole(context, { role: 'dialog' }),
  ]);
  const label = t('history.speakers', 'Speakers');
  return (
    <>
      <button ref={refs.setReference} type="button" className="history-button record-speakers-button" {...getReferenceProps()}>
        <Users size={14} aria-hidden="true" />
        <span>{label}</span>
        <span className="record-speakers-button__count">{count}</span>
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              className="record-speakers-popover"
              style={{ ...floatingStyles, zIndex: 9999 }}
              {...getFloatingProps({ 'aria-label': label })}
              aria-labelledby={undefined}
            >
              {children}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}
