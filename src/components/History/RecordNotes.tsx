// src/components/History/RecordNotes.tsx
//
// A record's notes, beside its transcript (stage 3): the title and overview, then each topic with its points, each
// point with what it is (a decision, a to-do, a risk) and a to-do's owner and date. A filter keeps one kind; a
// version selector shows another version when there are several. A topic or a point takes the transcript to the
// sentence that says it. Without notes the page offers to write them; while a version is written it says so and can
// stop it; after a failure it says why and can try again.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HistoryNotes, HistoryRecord } from '../../lib/history/types';
import { englishLanguageName, languageLabel } from '../../lib/language/label';
import type { NotesLanguage } from '../../lib/notes/runner';
import type { NoteKind, NotesBody } from '../../lib/notes/write';
import { ownerWord } from '../../lib/notes/exportNotes';
import { formatDateTime } from './format';

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
  /** The newest attempt when it is newer than the version shown (it failed or was stopped). */
  latest?: HistoryNotes | null;
  /** The notes service to name in the once-only explanation, while it is still owed (ruling 37); null when not. */
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
};

type Filter = 'all' | NoteKind;

export function RecordNotes(p: RecordNotesProps) {
  const { t, i18n } = useTranslation();
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
    return t(`history.notesFailure.${code}`, FAILURE_WORDS[code] ?? failure);
  };
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

  const writeControls = (label: string) => (
    <div className="record-notes__write">
      <select className="select-dropdown" aria-label={t('history.notesLanguage', 'Language of the notes')} value={chosen?.code ?? ''}
        onChange={(e) => setChoice(e.target.value)}>
        {p.languages.map((l) => <option key={l.code} value={l.code}>{languageLabel(l.code, ui)}</option>)}
      </select>
      <button type="button" className="history-button" disabled={!chosen} onClick={() => chosen && write(chosen)}>{label}</button>
    </div>
  );

  let content: React.ReactNode;
  if (explaining && p.explainWith) {
    const explainTitle = t('history.notesExplainTitle', 'Before notes are written');
    content = (
      <div className="history-category__explain" role="group" aria-label={explainTitle}>
        <strong>{explainTitle}</strong>
        <p>{t('history.notesExplain', 'For each session, the text of its sentences, their numbers, and which side and speaker said them are sent to {{service}} with your own key. Never the audio, the translation or your account.', { service: p.explainWith })}</p>
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
    const body = p.notes.body as unknown as NotesBody;
    const shown = (kinds: readonly NoteKind[]) => filter === 'all' || kinds.includes(filter);
    const latest = p.latest && p.latest.state !== 'complete' ? p.latest : null;
    content = (
      <>
        {latest && (
          <div className="record-notes__state record-notes__latest">
            <p>{latest.state === 'failed'
              ? t('history.notesLatestFailed', 'The latest attempt could not be written: {{reason}}', { reason: failureText(latest.failure) })
              : t('history.notesLatestStopped', 'The latest attempt was stopped.')}</p>
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
                        <button type="button" className="record-notes__jump" onClick={() => p.onJump(pt.sentences[0])}>{pt.text}</button>
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
                  <button type="button" className="record-notes__dismiss" onClick={() => p.onDismissName(i)}>{t('history.notesDismiss', 'Dismiss')}</button>
                </li>
              )))}
            </ul>
          </section>
        )}
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
