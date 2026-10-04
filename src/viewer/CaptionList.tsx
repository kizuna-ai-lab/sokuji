// src/viewer/CaptionList.tsx
import React, { useLayoutEffect, useRef } from 'react';
import type { ResetReason, ViewerEntry } from '../lib/share/types';
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

const CaptionList: React.FC<CaptionListProps> = ({ t, entries, choice, completeOnly, layout, notice, emptyText, following, onFollowingChange }) => {
  const list = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [entries, following, choice, completeOnly]);

  const onScroll = () => {
    const el = list.current;
    if (el) onFollowingChange(atLiveEdge(el.scrollTop, el.clientHeight, el.scrollHeight));
  };

  const rows = entries.flatMap((entry) => {
    const { primary, secondary } = sidesFor(entry, choice.code);
    const first = piecesOf(primary, completeOnly);
    const second = choice.both ? piecesOf(secondary, completeOnly) : [];
    if (first.length === 0 && second.length === 0) return [];
    return [(
      <article key={entry.id} className={`viewer-entry viewer-entry--${entry.leg}`}>
        {layout === 'desktop' && <time className="viewer-entry__time">{formatLocalTime(entry.t).slice(0, 5)}</time>}
        {first.length > 0 && <p className="viewer-entry__primary"><Pieces pieces={first} /></p>}
        {second.length > 0 && <p className="viewer-entry__secondary"><Pieces pieces={second} /></p>}
      </article>
    )];
  });

  return (
    <div className="viewer-list-wrap">
      <div className="viewer-list" ref={list} onScroll={onScroll}>
        {notice && <p className="viewer-list__notice">{t(NOTICE_KEYS[notice])}</p>}
        {rows.length === 0 && !notice && <p className="viewer-list__empty">{emptyText}</p>}
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
