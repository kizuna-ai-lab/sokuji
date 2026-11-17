// src/components/History/RecordNotes.tsx
//
// A record's notes, beside its transcript (stage 3): the title and overview, then each topic with its points, each
// point with what it is (a decision, a to-do, a risk) and a to-do's owner and date. A filter keeps one kind; a
// version selector shows another version when there are several. A topic or a point takes the transcript to the
// sentence that says it. Without notes the page offers to write them; while a version is written it says so and can
// stop it; after a failure it says why and can try again.
import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settingsStore';
import { notesExplanation } from './notesExplain';
import type { HistoryNotes, HistoryRecord } from '../../lib/history/types';
import { englishLanguageName, languageLabel } from '../../lib/language/label';
import type { NotesLanguage } from '../../lib/notes/runner';
import { readNotesBody, type NoteKind } from '../../lib/notes/write';
import { ownerWord } from '../../lib/notes/exportNotes';
import { formatDateTime } from './format';
import { playable } from '../../lib/history/playback';
import FormInput from '../Settings/shared/FormInput';
import { selectChrome, selectMinWidth } from './selectWidth';

export interface RecordNotesProps {
  record: HistoryRecord;
  /** The version shown, or null without notes. */
  notes: HistoryNotes | null;
  /** A version is being written for this record. */
  writing: boolean;
  /** The transcript is too short to write notes from. */
  tooShort: boolean;
  /** The languages offered for a new version, the first chosen. */
  languages: readonly NotesLanguage[];
  onWrite(language: NotesLanguage): void;
  onCancel(): void;
  onShowVersion(id: number): void;
  /** Takes the transcript to sentence `n`. */
  onJump(n: number): void;
  /** Dismisses name `index` of the version's names to check. */
  onDismissName(index: number): void;
  /** Adds name `index` to the word list, spelled `spelling`, and dismisses it (desktop, stage 5). */
  onAddName?(index: number, spelling: string): Promise<'added' | 'known' | null>;
  /** The newest attempt when it is newer than the version shown (it failed or was stopped). */
  latest?: HistoryNotes | null;
  /** The notes service (its line-up id) the once-only explanation is about, while it is still owed (ruling 37); null when not. */
  explainWith: string | null;
  /** The explanation was shown and accepted. */
  onExplained(): void;
}

/** The program's own reasons, by code (`notes:<code>`); a service's words are shown as they are. */
const FAILURE_WORDS: Record<string, string> = {
  'no-service': 'No notes service is set up. Choose one in Languages and line-up and add its key.',
  'no-topics': 'The notes model wrote no topics.',
  'not-json': 'The notes model did not answer in the expected form.',
  'no-answer': 'The notes model gave no answer.',
  network: 'The notes service could not be reached.',
  // Kizuna AI's notes service (relayChat.ts): every reason it gives a code for has words of its own.
  'sign-in': 'Sign in to Kizuna AI to write notes with it.',
  unavailable: 'Notes by Kizuna AI are not available yet.',
  'no-balance': 'Your Kizuna AI balance has run out.',
  'daily-limit': 'Today\'s limit for notes by Kizuna AI is reached. Try again tomorrow.',
  'wallet-frozen': 'Your Kizuna AI wallet is frozen.',
  'not-member': 'You are no longer a member of the organization that pays for Kizuna AI.',
  'too-large': 'This record is too long for Kizuna AI to write notes from.',
  'update-required': 'Update Sokuji to write notes with Kizuna AI.',
};
/** The reasons the account can change: the failure leads there (the Kizuna AI row of Accounts and keys). */
const ACCOUNT_REASONS = new Set(['notes:sign-in', 'notes:no-balance', 'notes:wallet-frozen', 'notes:not-member']);

type Filter = 'all' | NoteKind;

export function RecordNotes(p: RecordNotesProps) {
  const { t, i18n } = useTranslation();
  // A name without a suggestion asks for its spelling first; what adding one did is said once below the list.
  const [asking, setAsking] = useState<number | null>(null);
  const [spelling, setSpelling] = useState('');
  const [nameNote, setNameNote] = useState<string | null>(null);
  const addName = async (i: number, written: string) => {
    if (!p.onAddName) return;
    const result = await p.onAddName(i, written);
    setAsking(null);
    setNameNote(result === 'known'
      ? t('history.notesNameKnown', '“{{name}}” is already in the word list.', { name: written.trim() })
      : result === 'added' ? t('history.notesNameAdded', '“{{name}}” was added to the word list.', { name: written.trim() }) : null);
  };
  const ui = i18n.language;
  const [filter, setFilter] = useState<Filter>('all');
  const [choice, setChoice] = useState(p.languages[0]?.code ?? '');
  const chosen = p.languages.find((l) => l.code === choice) ?? p.languages[0];
  /** A version asked for while the explanation is still owed: written once it is accepted. */
  const [explaining, setExplaining] = useState<NotesLanguage | null>(null);
  const write = (language: NotesLanguage) => {
    if (p.explainWith) setExplaining(language);
    else p.onWrite(language);
  };
  const failureText = (failure: string | null) => {
    if (!failure?.startsWith('notes:')) return failure ?? '';
    const code = failure.slice('notes:'.length);
    if (code.startsWith('refused:')) return t('history.notesFailure.refused', 'The service refused the request ({{status}}).', { status: code.slice('refused:'.length) });
    // A code this version does not know yet still reads as words, never as the code.
    if (!Object.prototype.hasOwnProperty.call(FAILURE_WORDS, code)) return t('history.notesFailure.other', 'The notes service refused the request.');
    return t(`history.notesFailure.${code}`, FAILURE_WORDS[code]);
  };
  // A reason the account can change leads there, under a version that failed and under a newer attempt that did.
  const accountLink = (failure: string | null) => (failure && ACCOUNT_REASONS.has(failure) ? (
    <button type="button" className="history-link" onClick={() => useSettingsStore.getState().navigateToSettings('user-account')}>
      {t('history.file.openSettings', 'Open {{place}}', { place: t('settingsPage.categories.accounts', 'Accounts and keys') })}
    </button>
  ) : null);
  const sides = { mySide: t('history.sideMine', 'Your side'), otherSide: t('history.sideOther', 'The other side') };
  const again = (language: string) => () => write({ code: language, name: englishLanguageName(language) });

  const kindWord: Record<NoteKind, string> = {
    decision: t('history.notesKind.decision', 'Decision'),
    todo: t('history.notesKind.todo', 'To do'),
    risk: t('history.notesKind.risk', 'Risk'),
  };
  const filters: Array<[Filter, string]> = [
    ['all', t('history.notesFilter.all', 'All')],
    ['decision', t('history.notesFilter.decision', 'Decisions')],
    ['todo', t('history.notesFilter.todo', 'To-dos')],
    ['risk', t('history.notesFilter.risk', 'Risks')],
  ];
  const stateWord = (state: string) => (state === 'failed' ? t('history.notesStateFailed', 'failed') : state === 'cancelled' ? t('history.notesStateCancelled', 'cancelled') : null);

  const versions = [...p.record.notes].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
  const versionPicker = versions.length > 1 && p.notes && (
    <select className="select-dropdown record-notes__version" aria-label={t('history.notesVersion', 'Version')} value={String(p.notes.id)}
      onChange={(e) => p.onShowVersion(Number(e.target.value))}>
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          {[formatDateTime(v.createdAt, ui), languageLabel(v.language, ui), stateWord(v.state)].filter(Boolean).join(' · ')}
        </option>
      ))}
    </select>
  );

  // "Language of the notes [Chinese ▾] [Write notes]" (owner, 2026-11-17; B-33): the label says what the select is for,
  // and the select and the button stay together; in a narrow column the label goes on a line of its own above them.
  const languageId = useId();
  // At least as wide as its longest language name, measured in its own font (selectWidth.ts).
  const languageRef = useRef<HTMLSelectElement>(null);
  const [languageWidth, setLanguageWidth] = useState<number | null>(null);
  const languageNames = p.languages.map((l) => languageLabel(l.code, ui)).join('\n');
  // Measured again once the fonts have come in: before, the names are measured in a fallback font.
  useLayoutEffect(() => {
    const select = languageRef.current;
    const context = select ? document.createElement('canvas').getContext?.('2d') : null;
    if (!select || !context) return undefined;
    let live = true;
    const measure = () => {
      if (!live) return;
      const style = getComputedStyle(select);
      context.font = style.font || `${style.fontSize} ${style.fontFamily}`;
      setLanguageWidth(selectMinWidth(languageNames.split('\n'), (label) => context.measureText(label).width, selectChrome(style)));
    };
    measure();
    void document.fonts?.ready.then(measure);
    return () => { live = false; };
  }, [languageNames, p.notes?.id, p.writing, p.tooShort]);
  const writeControls = (label: string) => (
    <div className="record-notes__write">
      <label htmlFor={languageId}>{t('history.notesLanguage', 'Language of the notes')}</label>
      <div className="record-notes__pick">
        <select id={languageId} ref={languageRef} className="select-dropdown" value={chosen?.code ?? ''} onChange={(e) => setChoice(e.target.value)}
          style={languageWidth ? ({ '--language-min': `${languageWidth}px` } as CSSProperties) : undefined}>
          {p.languages.map((l) => <option key={l.code} value={l.code}>{languageLabel(l.code, ui)}</option>)}
        </select>
        <button type="button" className="history-button" disabled={!chosen} onClick={() => chosen && write(chosen)}>{label}</button>
      </div>
    </div>
  );

  let content: React.ReactNode;
  if (explaining && p.explainWith) {
    const explainTitle = t('history.notesExplainTitle', 'Before notes are written');
    content = (
      <div className="history-category__explain" role="group" aria-label={explainTitle}>
        <strong>{explainTitle}</strong>
        <p>{notesExplanation(t, p.explainWith, 'after')}</p>
        <div className="record-notes__write">
          <button type="button" className="history-button" onClick={() => setExplaining(null)}>{t('history.cancel', 'Cancel')}</button>
          <button type="button" className="history-button" onClick={() => { p.onExplained(); p.onWrite(explaining); setExplaining(null); }}>
            {t('history.notesWrite', 'Write notes')}
          </button>
        </div>
      </div>
    );
  } else if (p.writing) {
    content = (
      <div className="record-notes__state">
        <p role="status">{t('history.notesWriting', 'Writing notes…')}</p>
        <button type="button" className="history-button" onClick={p.onCancel}>{t('history.cancel', 'Cancel')}</button>
      </div>
    );
  } else if (!p.notes) {
    content = p.tooShort
      ? <p className="record-notes__state">{t('history.notesTooShort', 'There is too little in this record to write notes from.')}</p>
      : writeControls(t('history.notesWrite', 'Write notes'));
  } else if (p.notes.state === 'failed') {
    content = (
      <div className="record-notes__state">
        <p>{t('history.notesFailed', 'The notes could not be written: {{reason}}', { reason: failureText(p.notes.failure) })}</p>
        {accountLink(p.notes.failure)}
        <button type="button" className="history-button" onClick={again(p.notes.language)}>
          {t('history.notesTryAgain', 'Try again')}
        </button>
      </div>
    );
  } else if (p.notes.state === 'cancelled' || !p.notes.body) {
    content = (
      <div className="record-notes__state">
        <p>{t('history.notesCancelled', 'Writing these notes was stopped.')}</p>
        {!p.tooShort && writeControls(t('history.notesWrite', 'Write notes'))}
      </div>
    );
  } else {
    const body = readNotesBody(p.notes.body);
    const shown = (kinds: readonly NoteKind[]) => filter === 'all' || kinds.includes(filter);
    const latest = p.latest && p.latest.state !== 'complete' ? p.latest : null;
    content = (
      <>
        {latest && (
          <div className="record-notes__state record-notes__latest">
            <p>{latest.state === 'failed'
              ? t('history.notesLatestFailed', 'The latest attempt could not be written: {{reason}}', { reason: failureText(latest.failure) })
              : t('history.notesLatestStopped', 'The latest attempt was stopped.')}</p>
            {latest.state === 'failed' && accountLink(latest.failure)}
            <button type="button" className="history-button" onClick={again(latest.language)}>{t('history.notesTryAgain', 'Try again')}</button>
          </div>
        )}
        <h3 className="record-notes__title">{body.title}</h3>
        {body.overview.text && <p className="record-notes__overview">{body.overview.text}</p>}
        <div className="record-notes__filter" role="group" aria-label={t('history.notesFilterLabel', 'Show')}>
          {filters.map(([f, label]) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>
          ))}
        </div>
        {/* A click on a topic or point goes to its sentence, and with a recording plays from there: said once, here. */}
        <p className="record-notes__hint">{playable(p.record.tracks).length > 0
          ? t('history.notesJumpPlay', 'Click a topic or point to go to its sentence and play from there.')
          : t('history.notesJump', 'Click a topic or point to go to its sentence.')}</p>
        {body.topics.map((topic, index) => {
          const points = body.points.filter((pt) => pt.topic === index && shown(pt.kinds));
          if (filter !== 'all' && points.length === 0) return null;
          return (
            <section className="record-notes__topic" key={index}>
              <h4><button type="button" className="record-notes__jump" onClick={() => p.onJump(topic.first)}>{topic.title}</button></h4>
              {topic.summary && <p className="record-notes__summary">{topic.summary}</p>}
              {points.length > 0 && (
                <ul className="record-notes__points">
                  {points.map((pt, i) => {
                    // Who and when belong to a to-do; a point that is no longer one shows neither.
                    const todo = pt.kinds.includes('todo');
                    const who = todo ? [ownerWord(pt.owner, sides), pt.due].filter(Boolean).join(' · ') : '';
                    return (
                      <li key={i} className="record-notes__point">
                        {/* Inline text, not a <button>: a button is laid out as a box of its own, which put the bullet at
                            its last line and the kinds on a line of their own (owner, 2026-11-17). */}
                        <span
                          role="button"
                          tabIndex={0}
                          className="record-notes__jump"
                          onClick={() => p.onJump(pt.sentences[0])}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            p.onJump(pt.sentences[0]);
                          }}
                        >
                          {pt.text}
                        </span>
                        {(pt.kinds.length > 0 || who) && (
                          <span className="record-notes__marks">
                            {pt.kinds.map((k) => <span key={k} className={`record-notes__kind record-notes__kind--${k}`}>{kindWord[k]}</span>)}
                            {who && <span className="record-notes__who">{who}</span>}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
        {body.names.some((n) => !n.dismissed) && (
          <section className="record-notes__names" aria-label={t('history.notesNames', 'Names to check')}>
            <h4>{t('history.notesNames', 'Names to check')}</h4>
            <p className="record-notes__summary">{t('history.notesNamesHint', 'The recognizer may have written these wrong.')}</p>
            <ul className="record-notes__points">
              {body.names.map((n, i) => (n.dismissed ? null : (
                <li key={i} className="record-notes__point">
                  <button type="button" className="record-notes__jump" onClick={() => p.onJump(n.sentences[0])}>{`${n.written} → ${n.likely ?? '?'}`}</button>
                  {p.onAddName && (asking === i ? (
                    <span className="record-notes__spell">
                      <FormInput aria-label={t('history.notesNameSpelling', 'How it is spelled')} value={spelling} spellCheck={false}
                        onChange={(e) => setSpelling(e.target.value)} />
                      <button type="button" className="record-notes__dismiss" disabled={!spelling.trim()} onClick={() => void addName(i, spelling)}>
                        {t('history.notesNameAdd', 'Add')}
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="record-notes__dismiss"
                      onClick={() => { if (n.likely) void addName(i, n.likely); else { setAsking(i); setSpelling(''); } }}>
                      {t('history.notesAddToWords', 'Add to word list')}
                    </button>
                  ))}
                  <button type="button" className="record-notes__dismiss" onClick={() => p.onDismissName(i)}>{t('history.notesDismiss', 'Dismiss')}</button>
                </li>
              )))}
            </ul>
          </section>
        )}
        {/* Outside the list: adding its last name dismisses it, and the list goes. */}
        {nameNote && <p className="record-notes__summary" role="status">{nameNote}</p>}
        {writeControls(t('history.notesWriteAgain', 'Write a new version'))}
      </>
    );
  }

  return (
    <section className="record-notes" aria-label={t('history.notes', 'Notes')}>
      {versionPicker}
      {content}
    </section>
  );
}

export default RecordNotes;
