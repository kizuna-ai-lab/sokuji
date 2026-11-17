// src/components/History/InlineEdit.tsx
//
// A name typed in place: a record's title, a speaker's name. Owner, 2026-11-17: how an edit ends is on screen, not
// only on the keyboard: Save and Cancel sit on the field's row, their keys (Enter, Escape) in their tooltips; a click
// elsewhere saves. A save that fails keeps the field and what was typed; the page says why.
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { isComposing } from './format';

export interface InlineEditProps {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  /** The field's own class (its width and look where it sits). */
  fieldClassName: string;
  onChange(value: string): void;
  /** Saves what was typed; true once saved, false when it failed (the field stays). */
  onSave(): Promise<boolean>;
  onCancel(): void;
}

export function InlineEdit({ value, placeholder, ariaLabel, fieldClassName, onChange, onSave, onCancel }: InlineEditProps) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // One ending at a time: a save under way is not started again by the blur that follows it.
  const ending = useRef(false);
  const save = async () => {
    if (ending.current) return;
    ending.current = true;
    const saved = await onSave();
    ending.current = false;
    if (!saved) inputRef.current?.focus();
  };
  const cancel = () => {
    if (ending.current) return;
    ending.current = true;
    onCancel();
  };
  return (
    <span
      className="inline-edit"
      ref={boxRef}
      // It takes Escape itself (below): a side panel around it leaves Escape to it.
      data-escape-own=""
      // Focus leaving the field and its buttons is a click elsewhere: it saves.
      onBlur={(e) => { if (!boxRef.current?.contains(e.relatedTarget as Node | null)) void save(); }}
      // Escape from the field or from its buttons cancels the edit, and that is all: the page does not take it as a way
      // back, nor a panel the field sits in as a reason to close (one that starts listening as the edit ends would still
      // hear it).
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || isComposing(e.nativeEvent)) return;
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }}
    >
      <input
        ref={inputRef}
        className={fieldClassName}
        aria-label={ariaLabel}
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (isComposing(e.nativeEvent)) return;
          if (e.key === 'Enter') { e.preventDefault(); void save(); }
        }}
      />
      {/* Pressed with the mouse, the buttons keep the focus in the field, so the press is theirs, not a blur's. */}
      <button type="button" className="inline-edit__button" aria-label={t('history.editSave', 'Save')} title={t('history.editSaveHint', 'Save (Enter)')}
        onMouseDown={(e) => e.preventDefault()} onClick={() => void save()}>
        <Check size={14} aria-hidden="true" />
      </button>
      <button type="button" className="inline-edit__button" aria-label={t('history.cancel', 'Cancel')} title={t('history.editCancelHint', 'Cancel (Esc)')}
        onMouseDown={(e) => e.preventDefault()} onClick={cancel}>
        <X size={14} aria-hidden="true" />
      </button>
    </span>
  );
}
