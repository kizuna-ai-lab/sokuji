// src/components/History/FixWordsPart.tsx
//
// The edit panel's "Fix words" (owner, 2026-11-19; design draft P0 §3.1, option C): the one place a misheard word is
// fixed in a finished record's transcript. "Heard as" counts as it is typed; "Change all" writes every place (or only
// the one selected), the shown notes too and the word list when ticked. A word handed over from the notes' names or a
// selection in the transcript fills the fields; nothing is fixed until "Change all". Below, the fixes made, each with
// Revert. Not shown on a record still running or being transcribed again.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { findWord, replaceInNotes } from '../../lib/history/wordFix';
import { useHistoryPageContext } from './historyContext';
import { formatLength } from './format';
import '../Settings/shared/FormInput.scss';

export interface FixWordsPartProps {
  /** Shows a place in the transcript. */
  onJump(n: number): void;
}

export function FixWordsPart({ onJump }: FixWordsPartProps) {
  const { t } = useTranslation();
  const { store } = useHistoryPageContext();
  const open = useStore(store, (s) => s.open);
  const draft = useStore(store, (s) => s.fixDraft);
  const editable = useStore(store, (s) => s.canEdit());
  const [heard, setHeard] = useState('');
  const [to, setTo] = useState('');
  /** The sentence a selection was handed over from, which may be fixed alone. */
  const [only, setOnly] = useState<number | null>(null);
  const [scope, setScope] = useState<'all' | 'one'>('all');
  const [fromNotes, setFromNotes] = useState(false);
  const [inNotes, setInNotes] = useState(true);
  const [words, setWords] = useState(true);
  const [each, setEach] = useState(false);
  const [focusAsked, setFocusAsked] = useState(0);
  const partRef = useRef<HTMLElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  // A word handed over: the fields filled from it, the draft taken.
  useEffect(() => {
    if (!draft) return;
    setHeard(draft.heard);
    setTo(draft.suggestion ?? '');
    setOnly(draft.only);
    setScope('all');
    setFromNotes(draft.source === 'notes');
    setInNotes(true);
    setWords(true);
    setEach(false);
    setFocusAsked((n) => n + 1);
    store.getState().clearFixDraft();
  }, [draft?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (focusAsked === 0) return;
    partRef.current?.scrollIntoView?.({ block: 'nearest' });
    toRef.current?.focus();
  }, [focusAsked]);

  const word = heard.trim();
  const target = to.trim();
  const hits = useMemo(() => (word && open ? open.sentences.filter((s) => findWord(s.text, word).length > 0) : []), [open, word]);
  const notesHits = useMemo(() => (word && open?.notes?.body ? replaceInNotes(open.notes.body, word, word).count : 0), [open, word]);
  if (!editable || !open) return null;

  const one = scope === 'one' && only !== null && hits.some((s) => s.n === only);
  const canFix = hits.length > 0 && target !== '' && target !== word;
  const fixes = open.corrections.filter((c) => c.revertedAt === null);
  const fix = async () => {
    const changed = await store.getState().fixWords(word, target, {
      notes: !one && notesHits > 0 && inNotes, words: !one && words, only: one ? only : null,
    });
    if (changed === 0) return;
    setHeard('');
    setTo('');
    setOnly(null);
    setScope('all');
    setFromNotes(false);
    setEach(false);
  };

  return (
    <section className="record-side__part record-fix" ref={partRef} aria-label={t('history.fix.heading', 'Fix words')}>
      <h3>{t('history.fix.heading', 'Fix words')}</h3>
      <p className="record-side__hint">{t('history.fix.hint', 'Fix a misheard word everywhere in this transcript at once.')}</p>
      {fromNotes && <p className="record-fix__from">{t('history.fix.fromNotes', 'From the notes’ names to check')}</p>}
      <div className="record-fix__fields">
        <label className="record-fix__field">
          {t('history.fix.heardAs', 'Heard as')}
          <input className="settings-input" value={heard} spellCheck={false}
            onChange={(e) => { setHeard(e.target.value); setOnly(null); setScope('all'); setFromNotes(false); }} />
        </label>
        <label className="record-fix__field">
          {t('history.fix.changeTo', 'Change to')}
          <input className="settings-input" ref={toRef} value={to} spellCheck={false}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && canFix) { e.preventDefault(); void fix(); } }} />
        </label>
      </div>
      {word && (
        <p className="record-fix__count">
          {hits.length === 0 ? t('history.fix.notFound', 'Not found') : t('history.fix.places', '{{count}} places', { count: hits.length })}
          {hits.length > 0 && (
            <button type="button" className="record-fix__each-toggle" aria-expanded={each} onClick={() => setEach(!each)}>
              {each ? t('history.fix.hideEach', 'Hide') : t('history.fix.showEach', 'Show each')}
            </button>
          )}
        </p>
      )}
      {each && hits.length > 0 && (
        <ul className="record-fix__places">
          {hits.map((s) => (
            <li key={s.n}>
              <button type="button" onClick={() => onJump(s.n)}>
                <span className="record-fix__time">{formatLength(s.startMs)}</span> {s.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      {only !== null && hits.length > 1 && hits.some((s) => s.n === only) && (
        <div className="record-fix__scope" role="radiogroup" aria-label={t('history.fix.scope', 'Where')}>
          <label><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> {t('history.fix.all', 'All {{count}} places', { count: hits.length })}</label>
          <label><input type="radio" checked={scope === 'one'} onChange={() => setScope('one')} /> {t('history.fix.onlySelected', 'Only the selected one')}</label>
        </div>
      )}
      {!one && notesHits > 0 && (
        <label className="record-fix__check">
          <input type="checkbox" checked={inNotes} onChange={(e) => setInNotes(e.target.checked)} />
          {t('history.fix.inNotes', 'Fix in the notes too ({{count}})', { count: notesHits })}
        </label>
      )}
      <label className="record-fix__check">
        <input type="checkbox" checked={!one && words} disabled={one} onChange={(e) => setWords(e.target.checked)} />
        {t('history.fix.toWords', 'Add to the word list')}
      </label>
      <button type="button" className="history-button" disabled={!canFix} onClick={() => void fix()}>
        {t('history.fix.changeAll', 'Change all')}
      </button>
      <h4>{t('history.fix.done', 'Fixed in this record')}</h4>
      {fixes.length === 0 ? (
        <p className="record-fix__none">{t('history.fix.noneYet', 'None yet')}</p>
      ) : (
        <ul className="record-fix__done">
          {fixes.map((c) => (
            <li key={c.id}>
              <span>{t('history.fix.doneRow', '{{from}} → {{to}} · {{count}} places', { from: c.from, to: c.to, count: c.sentences.length })}</span>
              <button type="button" className="history-button history-button--quiet" onClick={() => void store.getState().revertCorrection(c.id)}>
                {t('history.fix.revert', 'Revert')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default FixWordsPart;
