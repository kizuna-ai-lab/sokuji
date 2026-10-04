// src/viewer/CaptionList.tsx
import React, { useLayoutEffect, useRef } from 'react';
import type { ResetReason, ViewerEntry, ViewerRow } from '../lib/share/types';
import { formatLocalTime } from '../utils/conversationExport';
import type { Layout } from './layout';
import { atLiveEdge } from './layout';
import type { T } from './strings';
import { piecesOf, sidesFor, type Choice, type Piece } from './text';

interface CaptionListProps {
  t: T;
  entries: readonly ViewerEntry[];
  choice: Choice;
  completeOnly: boolean;
  layout: Layout;
  /** Both sides have spoken: lines carry their side's stripe, and a tag where the side changes. */
  twoLegs: boolean;
  notice: ResetReason | null;
  emptyText: string;
  following: boolean;
  onFollowingChange(following: boolean): void;
}

const NOTICE_KEYS: Record<ResetReason, string> = { clear: 'viewer.notice.cleared', restart: 'viewer.notice.restarted' };

const Pieces: React.FC<{ pieces: Piece[] }> = ({ pieces }) => (
  <>
    {pieces.map((p, i) => (
      <React.Fragment key={i}>
        {p.space ? ' ' : ''}
        <span className={p.final ? undefined : 'viewer-partial'}>{p.text}</span>
      </React.Fragment>
    ))}
  </>
);

interface RowProps {
  entry: ViewerEntry; code: string; both: boolean; completeOnly: boolean; desktop: boolean;
  /** The side's name on the first line of a turn; null elsewhere. */
  side: string | null;
}

/**
 * One line. Memoized on primitives and the entry object, which the model keeps
 * for every entry an update did not touch: upserts arrive many times a second
 * and a long talk holds ~1,500 entries, so only the changed line re-renders.
 */
const CaptionRow = React.memo(function CaptionRow({ entry, code, both, completeOnly, desktop, side }: RowProps) {
  const { primary, secondary } = sidesFor(entry, code);
  const first = piecesOf(primary, completeOnly);
  const second = both ? piecesOf(secondary, completeOnly) : [];
  if (first.length === 0 && second.length === 0) return null;
  return (
    <article className={`viewer-entry viewer-entry--${entry.leg}`} data-id={entry.id}>
      {side && <span className="viewer-entry__side">{side}</span>}
      {desktop && <time className="viewer-entry__time">{formatLocalTime(entry.t).slice(0, 5)}</time>}
      {first.length > 0 && <p className="viewer-entry__primary"><Pieces pieces={first} /></p>}
      {second.length > 0 && <p className="viewer-entry__secondary"><Pieces pieces={second} /></p>}
    </article>
  );
});

/** Whether `piecesOf(rows, completeOnly)` has a piece: a shown row with text that is not blank. */
const shows = (rows: readonly ViewerRow[], completeOnly: boolean): boolean =>
  rows.some((row) => (!completeOnly || row.final) && row.text.trim() !== '');

const SIDE_KEYS: Record<ViewerEntry['leg'], string> = { speaker: 'viewer.legend.onSite', participant: 'viewer.legend.remote' };

const CaptionList: React.FC<CaptionListProps> = ({ t, entries, choice, completeOnly, layout, twoLegs, notice, emptyText, following, onFollowingChange }) => {
  const list = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [entries, following, choice, completeOnly]);

  const onScroll = () => {
    const el = list.current;
    if (el) onFollowingChange(atLiveEdge(el.scrollTop, el.clientHeight, el.scrollHeight));
  };

  // A turn starts where the side differs from the last line shown. Visibility
  // is read cheaply (no pieces), so unchanged lines still skip re-rendering.
  let lastLeg: ViewerEntry['leg'] | null = null;
  const rows = entries.map((entry) => {
    const { primary, secondary } = sidesFor(entry, choice.code);
    const visible = shows(primary, completeOnly) || (choice.both && shows(secondary, completeOnly));
    const turn = visible && entry.leg !== lastLeg;
    if (visible) lastLeg = entry.leg;
    return (
      <CaptionRow
        key={entry.id} entry={entry} code={choice.code} both={choice.both}
        completeOnly={completeOnly} desktop={layout === 'desktop'}
        side={twoLegs && turn ? t(SIDE_KEYS[entry.leg]) : null}
      />
    );
  });

  return (
    <div className="viewer-list-wrap">
      <div className="viewer-list" ref={list} onScroll={onScroll}>
        {notice && <p className="viewer-list__notice">{t(NOTICE_KEYS[notice])}</p>}
        {lastLeg === null && !notice && <p className="viewer-list__empty">{emptyText}</p>}
        {rows}
      </div>
      {!following && (
        <button type="button" className="viewer-jump" onClick={() => onFollowingChange(true)}>
          {`${t('viewer.backToLive')} ↓`}
        </button>
      )}
    </div>
  );
};

export default CaptionList;
