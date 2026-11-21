// src/components/History/NotesFieldEditor.tsx
//
// One part of a record's notes rewritten in place (design P1 §1): the title, the overview, a topic's title or summary,
// or a point, with a to-do's owner and date beside it. The keys are a sentence's (P0 SentenceEditor): Enter saves,
// Shift+Enter starts a line, Escape cancels, a click elsewhere saves; Enter while composing (an IME) does nothing.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isComposing } from './format';

export interface NotesFieldValue { text: string; owner?: string; due?: string }

export interface NotesFieldEditorProps {
  /** The text field's name, for its label. */
  label: string;
  text: string;
  /** A to-do's owner (as the interface words it) and date, edited beside its text. */
  todo?: { owner: string; due: string } | null;
  /** Saves; `false` when it failed, which keeps the editor open with what was typed. */
  onSave(value: NotesFieldValue): Promise<boolean | void> | boolean | void;
  onDone(): void;
}

export function NotesFieldEditor({ label, text, todo = null, onSave, onDone }: NotesFieldEditorProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(text);
  const [owner, setOwner] = useState(todo?.owner ?? '');
  const [due, setDue] = useState(todo?.due ?? '');
  const ended = useRef(false);
  // While a save runs nothing more can be typed: it would be lost when the save ends (PR review).
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { fieldRef.current?.focus(); }, []);

  // One ending: the blur after Enter or Escape is not a second one. Nothing changed saves nothing.
  const save = async () => {
    if (ended.current) return;
    ended.current = true;
    const changed = value !== text || (todo !== null && (owner !== todo.owner || due !== todo.due));
    if (changed) {
      setSaving(true);
      savingRef.current = true;
      let saved: boolean | void = false;
      try {
        saved = await onSave(todo ? { text: value, owner, due } : { text: value });
      } catch {
        saved = false;
      }
      savingRef.current = false;
      if (saved === false) {
        // Failed: the page says why; what was typed stays, to try again or cancel.
        ended.current = false;
        setSaving(false);
        fieldRef.current?.focus();
        return;
      }
    }
    onDone();
  };
  const cancel = () => {
    // A save under way is waited for: should it fail, what was typed still has its editor.
    if (savingRef.current) return;
    ended.current = true;
    onDone();
  };

  return (
    <div
      className="record-notes-edit"
      ref={boxRef}
      // Escape is the editor's: the edit panel leaves it alone, and the page does not go back.
      data-escape-own=""
      onBlur={(e) => { if (!boxRef.current?.contains(e.relatedTarget as Node | null)) void save(); }}
      onKeyDown={(e) => {
        if (isComposing(e.nativeEvent)) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <textarea
        ref={fieldRef}
        className="record-notes-edit__field"
        aria-label={label}
        value={value}
        readOnly={saving}
        rows={Math.max(2, Math.ceil(value.length / 60))}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
      />
      {todo && (
        <div className="record-notes-edit__todo">
          <label>
            <span>{t('history.notesOwner', 'Owner')}</span>
            <input type="text" aria-label={t('history.notesOwner', 'Owner')} value={owner} readOnly={saving} onChange={(e) => setOwner(e.target.value)} />
          </label>
          <label>
            <span>{t('history.notesDue', 'Due')}</span>
            <input type="text" aria-label={t('history.notesDue', 'Due')} value={due} readOnly={saving} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
      )}
      <span className="record-notes-edit__keys">{t('history.editKeys', 'Enter saves · Shift+Enter starts a line · Esc cancels')}</span>
    </div>
  );
}

export default NotesFieldEditor;
