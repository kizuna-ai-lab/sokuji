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
}

type Filter = 'all' | NoteKind;

export function RecordNotes(p: RecordNotesProps) {
  const { t, i18n } = useTranslation();
  const ui = i18n.language;
  const [filter, setFilter] = useState<Filter>('all');
  const [choice, setChoice] = useState(p.languages[0]?.code ?? '');
  const chosen = p.languages.find((l) => l.code === choice) ?? p.languages[0];

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
      <button type="button" className="history-button" disabled={!chosen} onClick={() => chosen && p.onWrite(chosen)}>{label}</button>
    </div>
  );

  let content: React.ReactNode;
  if (p.writing) {
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
    const again = p.notes.language;
    content = (
      <div className="record-notes__state">
        <p>{t('history.notesFailed', 'The notes could not be written: {{reason}}', { reason: p.notes.failure ?? '' })}</p>
        <button type="button" className="history-button" onClick={() => p.onWrite({ code: again, name: englishLanguageName(again) })}>
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
    content = (
      <>
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
                    const who = [pt.owner, pt.due].filter(Boolean).join(' · ');
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
