// src/components/History/SentenceEditor.tsx
//
// One sentence of a finished record rewritten in place (owner, 2026-11-19; design draft P0 §3.4). Enter saves, Shift+Enter
// starts a line, Escape cancels, a click elsewhere saves, as a speaker's name does. When the change swaps one word for
// another and the misheard word shows in other sentences too, it offers to change it everywhere (and to add it to the
// word list); anything else changes this sentence only.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { findWord, swapIn } from '../../lib/history/wordFix';
import { useHistoryPageContext } from './historyContext';

export interface SentenceEditorProps {
  n: number;
  text: string;
  onDone(): void;
}

export function SentenceEditor({ n, text, onDone }: SentenceEditorProps) {
  const { t } = useTranslation();
  const { store } = useHistoryPageContext();
  const open = useStore(store, (s) => s.open);
  const [value, setValue] = useState(text);
  const [everywhere, setEverywhere] = useState(true);
  const [words, setWords] = useState(true);
  const ended = useRef(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { fieldRef.current?.focus(); }, []);

  const swap = swapIn(text, value);
  const more = swap && open ? open.sentences.filter((s) => s.n !== n && findWord(s.text, swap.from).length > 0).length : 0;
  const offered = swap !== null && more > 0;

  // One ending: the blur after Enter or Escape is not a second one. An emptied sentence is left as it was.
  const save = async () => {
    if (ended.current) return;
    ended.current = true;
    if (value.trim() && value !== text) {
      await store.getState().editSentence(n, value, { everywhere: offered && everywhere, words: offered && everywhere && words });
    }
    onDone();
  };
  const cancel = () => {
    ended.current = true;
    onDone();
  };

  return (
    // Escape is the editor's: the edit panel leaves it alone (data-escape-own), and the page does not go back.
    <span className="record-sentence-edit" ref={boxRef} data-escape-own="">
      <textarea
        ref={fieldRef}
        className="record-sentence-edit__field"
        aria-label={t('history.sentenceField', 'Sentence')}
        value={value}
        rows={Math.max(2, Math.ceil(value.length / 60))}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        onBlur={(e) => { if (!boxRef.current?.contains(e.relatedTarget as Node | null)) void save(); }}
      />
      {offered && (
        <span className="record-sentence-edit__swap">
          <span>{t('history.editSwap', 'Heard as {{from}} · {{count}} more places', { from: swap.from, count: more })}</span>
          <label><input type="radio" checked={everywhere} onChange={() => setEverywhere(true)} /> {t('history.editEverywhere', 'Change everywhere')}</label>
          <label><input type="radio" checked={!everywhere} onChange={() => setEverywhere(false)} /> {t('history.editOnlyThis', 'Only this sentence')}</label>
          <label>
            <input type="checkbox" checked={everywhere && words} disabled={!everywhere} onChange={(e) => setWords(e.target.checked)} />
            {' '}{t('history.fix.toWords', 'Add to the word list')}
          </label>
        </span>
      )}
      <span className="record-sentence-edit__keys">{t('history.editKeys', 'Enter saves · Shift+Enter starts a line · Esc cancels')}</span>
    </span>
  );
}

export default SentenceEditor;
