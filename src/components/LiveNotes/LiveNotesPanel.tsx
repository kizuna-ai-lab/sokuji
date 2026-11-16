// src/components/LiveNotes/LiveNotesPanel.tsx
//
// The live notes beside the conversation (stage 4, desktop): the title, then the topics in the order they came, each
// with its points and what they are; the newest topic is the one being written. Docked on the right of a window at
// least 768 px wide, above the conversation when narrower (MainLayout's styles); not shown in caption mode, nor when
// live notes are off and nothing was written. After Stop the notes stay until the next start or Clear, with the way
// to History, where the full notes are written. Live notes are never kept (ruling 16).
import { useTranslation } from 'react-i18next';
import { useLiveNotes } from '../../lib/notes/live/liveStore';
import { LIVE_FULL } from '../../lib/notes/live/state';
import type { NoteKind } from '../../lib/notes/write';
import { useLiveNotesSetting } from '../../stores/settingsStore';
import { useLineUpStore } from '../../stores/lineUpStore';
import { KIZUNA_NOTES, notesServiceOf } from '../../lib/notes/notesService';
import { liveCostUsd, LOW_BALANCE_MICRO_USD, usd, useNotesPricing } from '../../lib/notes/notesPricing';
import { isElectron } from '../../utils/environment';
import './LiveNotesPanel.scss';

export interface LiveNotesPanelProps {
  /** Opens History at the record the notes are of. */
  onOpenHistory(recordId: string): void;
}

export function LiveNotesPanel({ onOpenHistory }: LiveNotesPanelProps) {
  const { t } = useTranslation();
  const { recordId, state, hint, running, off, ended, history, fullNotes, stopped, used, balanceMicroUsd } = useLiveNotes();
  const liveOn = useLiveNotesSetting();
  // With Kizuna AI the panel's foot says what this session's live notes have used, at the published rates.
  const hosted = useLineUpStore((s) => notesServiceOf(s.lineUp) === KIZUNA_NOTES);
  const pricing = useNotesPricing(hosted && isElectron());
  if (!isElectron() || (!liveOn && !state && !running && !off)) return null;
  if (!recordId && !state) return null;

  const kindWord: Record<NoteKind, string> = {
    decision: t('history.notesKind.decision', 'Decision'),
    todo: t('history.notesKind.todo', 'To do'),
    risk: t('history.notesKind.risk', 'Risk'),
  };
  const topics = state?.topics ?? [];
  const last = topics[topics.length - 1];
  const openTopic = running && last && last.points.length < LIVE_FULL ? last : null;

  return (
    <aside className="live-notes" aria-label={t('liveNotes.title', 'Live notes')}>
      <div className="live-notes__head">{t('liveNotes.title', 'Live notes')}</div>
      {hint && <p className="live-notes__line" role="status">{t('liveNotes.hint', 'Live notes could not be updated. They will try again.')}</p>}
      {off && <p className="live-notes__line">{t('liveNotes.off', 'Live notes are off.')}</p>}
      {stopped && (
        <p className="live-notes__line" role="status">
          {stopped === 'no-balance'
            ? t('liveNotes.noBalance', 'Your balance ran out; live notes stopped.')
            : t('liveNotes.stoppedByService', 'Kizuna AI cannot write live notes right now; they stopped.')}
        </p>
      )}
      {state?.title && <h3 className="live-notes__title">{state.title}</h3>}
      {topics.length === 0 && running && <p className="live-notes__line">{t('liveNotes.waiting', 'Notes appear here as the conversation goes on.')}</p>}
      {topics.map((topic) => (
        <section className="live-notes__topic" key={topic.n}>
          <h4>{topic === openTopic ? t('liveNotes.openTopic', '{{title}} (now)', { title: topic.title }) : topic.title}</h4>
          <ul>
            {topic.points.map((p, i) => (
              <li key={i}>
                <span>{p.text}</span>
                {p.kinds.map((k) => <span key={k} className={`live-notes__kind live-notes__kind--${k}`}>{kindWord[k]}</span>)}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {/* What follows waits for History's answer: whether it kept the session, and whether full notes are written. */}
      {ended && recordId && history !== 'pending' && (
        <div className="live-notes__end">
          <p className="live-notes__line">
            {history === 'notKept'
              ? t('liveNotes.notInHistory', 'Live notes are not kept, and this session is not in History.')
              : history === 'unknown'
                ? t('liveNotes.notKeptOnly', 'Live notes are not kept.')
                : fullNotes
                  ? t('liveNotes.fullInHistory', 'The full notes will be in History.')
                  : t('liveNotes.notKept', 'Live notes are not kept. The session is in History.')}
          </p>
          {history === 'kept' && <button type="button" className="live-notes__button" onClick={() => onOpenHistory(recordId)}>{t('liveNotes.openHistory', 'Open History')}</button>}
        </div>
      )}
      {hosted && pricing && used.input + used.output > 0 && (
        <p className="live-notes__line live-notes__cost">{t('liveNotes.costSoFar', 'Live notes so far: about {{cost}}', { cost: usd(liveCostUsd(used, pricing)) })}</p>
      )}
      {hosted && balanceMicroUsd !== null && balanceMicroUsd < LOW_BALANCE_MICRO_USD && (
        <p className="live-notes__line" role="status">{t('liveNotes.lowBalance', 'Your balance is low: {{balance}} left.', { balance: usd(Math.max(0, balanceMicroUsd) / 1e6) })}</p>
      )}
    </aside>
  );
}

export default LiveNotesPanel;
