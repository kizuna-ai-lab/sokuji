// src/components/LiveNotes/LiveNotesPanel.tsx
//
// The live notes in the conversation's area (stage 4, desktop): the title, then the topics in the order they came, each
// with its points and what they are; the newest topic is the one being written. Between the conversation's toolbar and
// its footer (owner, 2026-11-18): beside the conversation on the right of a window at least 768 px wide, above it when
// narrower (MainPanel's styles), or alone in the area (livePanel.ts). Beside it, its width is dragged at the divider on
// its left and kept for the next session (owner, 2026-11-18; liveNotesWidth.ts); above it, its height at the divider under
// it (owner, 2026-11-19; liveNotesHeight.ts). Not shown in caption mode, nor when
// live notes are off and nothing was written. With live notes on it is there before a session too, saying where the
// notes will come. After Stop the notes stay until the next start or Clear, with the way to History, where the full
// notes are written. Live notes are never kept (ruling 16).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveNotesLayout, useLiveNotesPresent } from '../../lib/notes/live/livePanel';
import { useLiveNotes } from '../../lib/notes/live/liveStore';
import { LIVE_FULL } from '../../lib/notes/live/state';
import type { NoteKind } from '../../lib/notes/write';
import { useLineUpStore } from '../../stores/lineUpStore';
import { KIZUNA_NOTES, notesServiceOf } from '../../lib/notes/notesService';
import { liveCostUsd, LOW_BALANCE_MICRO_USD, usd, useNotesPricing } from '../../lib/notes/notesPricing';
import { isElectron } from '../../utils/environment';
import PanelResizer from '../MainLayout/PanelResizer';
import { useFollowLatest } from '../Conversation/useFollowLatest';
import { FollowDock } from '../Conversation/FollowDock';
import { LIVE_NOTES_MIN_PX, liveNotesWidthWithin, readLiveNotesWidth, writeLiveNotesWidth } from './liveNotesWidth';
import { LIVE_NOTES_MIN_HEIGHT_PX, liveNotesHeightWithin, readLiveNotesHeight, writeLiveNotesHeight } from './liveNotesHeight';
import { useNarrowWindow } from '../../lib/notes/live/useNarrowWindow';
import './LiveNotesPanel.scss';

export interface LiveNotesPanelProps {
  /** Opens History at the record the notes are of. */
  onOpenHistory(recordId: string): void;
}

/**
 * The notes' scrolling body. It follows the newest notes as the conversation's list follows its newest line
 * (useFollowLatest; owner, 2026-11-19): kept at the bottom as they come in, unless the reader has scrolled up to read
 * back, and again once they are back at the bottom or click the row that then shows below them ("Back to latest", as
 * under the conversation). Hidden and shown again, it is where the reader left it: at the
 * newest while following, else where they were reading. Drawn anew for each session (its record is the key), so a new
 * session's notes start following, at the top, however the last one was left. Drawn only while there is a panel, so
 * following holds the element it watches from the start.
 */
function LiveNotesBody({ shown, content, empty, children }: {
  shown: boolean;
  /** What changes as notes come in. */
  content: unknown;
  /** No notes yet (a new session): following starts again. */
  empty: boolean;
  children: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrolledTo = useRef(0);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    // Hidden, it keeps where the reader was: a scroll that lands then reads 0 from a box with no layout. Following, the
    // box coming back pins it to the newest again (useFollowLatest watches its size).
    if (!body || !shown) return undefined;
    body.scrollTop = scrolledTo.current;
    const onScroll = () => { scrolledTo.current = body.scrollTop; };
    body.addEventListener('scroll', onScroll);
    return () => body.removeEventListener('scroll', onScroll);
  }, [shown]);
  const { docked, resume } = useFollowLatest(bodyRef, content, empty);
  return (
    <>
      <div className="live-notes__body" ref={bodyRef}>{children}</div>
      {docked && <FollowDock onClick={resume} />}
    </>
  );
}

export function LiveNotesPanel({ onOpenHistory }: LiveNotesPanelProps) {
  const { t } = useTranslation();
  // Beside the conversation, alone in its area, or hidden for a while, from the switch in the conversation's toolbar
  // (livePanel.ts). Hidden, it is kept, so it comes back where the reader left it.
  const layout = useLiveNotesLayout((x) => x.layout);
  const shown = layout !== 'conversation';
  const alone = layout === 'notes';
  const present = useLiveNotesPresent();
  // The width the reader left it at (kept on this computer, and held here too, so one that could not be saved still
  // holds for this session); what a drag shows until it ends; and the conversation's row it shares, measured before it
  // paints. The width shown fits the row; the one kept stays as it was left, for a wider window later.
  const asideRef = useRef<HTMLElement>(null);
  const [kept, setKept] = useState(readLiveNotesWidth);
  const [preview, setPreview] = useState<number | null>(null);
  const [row, setRow] = useState(0);
  // Read when a drag ends: its handlers were made when it began, and the row may have changed since.
  const rowNow = useRef(0);
  // Above the conversation in a narrow window (owner, 2026-11-19): the height kept (null: never dragged, they take what
  // they need up to 40%), what a drag shows, the column they share and how tall they are now, as for the width.
  const narrow = useNarrowWindow();
  const [keptHeight, setKeptHeight] = useState(readLiveNotesHeight);
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const [column, setColumn] = useState(0);
  const columnNow = useRef(0);
  const [tall, setTall] = useState(0);
  useLayoutEffect(() => {
    const aside = asideRef.current;
    const el = aside?.parentElement;
    if (!aside || !el) return undefined;
    const measure = () => {
      rowNow.current = el.clientWidth;
      setRow(el.clientWidth);
      columnNow.current = el.clientHeight;
      setColumn(el.clientHeight);
      setTall(aside.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    watch.observe(aside);
    return () => watch.disconnect();
  }, [present]);
  // Hidden, alone, gone or turned the other way in the middle of a drag, the divider goes, and what it showed with it.
  useEffect(() => {
    if (!shown || alone || !present) { setPreview(null); setPreviewHeight(null); }
  }, [shown, alone, present]);
  useEffect(() => { setPreview(null); setPreviewHeight(null); }, [narrow]);
  const { recordId, state, hint, running, off, ended, history, fullNotes, stopped, used, balanceMicroUsd } = useLiveNotes();
  // With Kizuna AI the panel's foot says what this session's live notes have used, at the published rates.
  const hosted = useLineUpStore((s) => notesServiceOf(s.lineUp) === KIZUNA_NOTES);
  const pricing = useNotesPricing(hosted && isElectron());
  // Everything the body may add to, the cost line too (review, PR #787: Kizuna AI chosen or its rates loaded, it comes
  // in with nothing else changing): the newest stays in view as any of it comes in.
  const followed = useMemo(
    () => [state, hint, off, stopped, ended, history, fullNotes, used, balanceMicroUsd, hosted, pricing],
    [state, hint, off, stopped, ended, history, fullNotes, used, balanceMicroUsd, hosted, pricing],
  );
  if (!present) return null;
  const shownWidth = liveNotesWidthWithin(preview ?? kept, row);
  const sizedHeight = previewHeight ?? keptHeight;
  const shownHeight = narrow && sizedHeight !== null ? liveNotesHeightWithin(sizedHeight, column) : null;

  const kindWord: Record<NoteKind, string> = {
    decision: t('history.notesKind.decision', 'Decision'),
    todo: t('history.notesKind.todo', 'To do'),
    risk: t('history.notesKind.risk', 'Risk'),
  };
  const topics = state?.topics ?? [];
  const last = topics[topics.length - 1];
  const openTopic = running && last && last.points.length < LIVE_FULL ? last : null;

  return (
    <>
    {/* Hidden or alone, the notes have no divider: nothing is beside them. Above the conversation, it is under them. */}
    {shown && !alone && narrow && (
      <PanelResizer
        axis="y"
        side="left"
        width={shownHeight ?? tall}
        min={LIVE_NOTES_MIN_HEIGHT_PX}
        max={liveNotesHeightWithin(Number.POSITIVE_INFINITY, column)}
        label={t('liveNotes.resize', 'Resize live notes')}
        onResize={setPreviewHeight}
        onCancel={() => setPreviewHeight(null)}
        onCommit={(next, from) => {
          setPreviewHeight(null);
          const fitted = liveNotesHeightWithin(next, columnNow.current);
          // Only a change the way it was asked for is kept (review, PR #789), judged from the height the gesture began
          // at: a release where it began (a click, a drag back), or a key at the limit, changes nothing, so a height
          // never dragged stays unset and one kept from a taller window stays, for when there is room again, whatever
          // the window did meanwhile. From notes shorter than the least, a step taller gives them the least.
          const asked = Math.sign(next - from);
          if (asked === 0 || Math.sign(fitted - from) !== asked) return;
          setKeptHeight(fitted);
          writeLiveNotesHeight(fitted);
        }}
      />
    )}
    {shown && !alone && !narrow && (
      <PanelResizer
        width={shownWidth}
        min={LIVE_NOTES_MIN_PX}
        max={liveNotesWidthWithin(Number.POSITIVE_INFINITY, row)}
        label={t('liveNotes.resize', 'Resize live notes')}
        onResize={setPreview}
        onCancel={() => setPreview(null)}
        onCommit={(next) => {
          setPreview(null);
          const fitted = liveNotesWidthWithin(next, rowNow.current);
          // Ending where the kept width shows (a click, a key at the limit, a drag back to the start) changes nothing:
          // the width kept from a wider window stays, for when there is room again (review).
          if (fitted === liveNotesWidthWithin(kept, rowNow.current)) return;
          setKept(fitted);
          writeLiveNotesWidth(fitted);
        }}
      />
    )}
    <aside
      ref={asideRef}
      className={['live-notes', alone && 'live-notes--alone', shownHeight !== null && 'live-notes--sized'].filter(Boolean).join(' ')}
      id="live-notes-panel"
      aria-label={t('liveNotes.title', 'Live notes')}
      hidden={!shown}
      style={{ '--live-notes-width': `${shownWidth}px`, ...(shownHeight !== null && { '--live-notes-height': `${shownHeight}px` }) } as CSSProperties}
    >
      <div className="live-notes__head">{t('liveNotes.title', 'Live notes')}</div>
      {/* A new session's notes start at the top, following: the panel stays up between sessions while live notes are on. */}
      <LiveNotesBody key={recordId ?? ''} shown={shown} content={followed} empty={!state}>
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
        {/* Running, or before a session starts: where the notes will come. */}
        {topics.length === 0 && (running || !recordId) && <p className="live-notes__line">{t('liveNotes.waiting', 'Notes appear here as the conversation goes on.')}</p>}
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
      </LiveNotesBody>
    </aside>
    </>
  );
}

export default LiveNotesPanel;
