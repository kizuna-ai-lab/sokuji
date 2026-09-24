import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Play, User, Users } from 'lucide-react';
import type { LegName, SegmentId } from '../../lib/conversation/types';
import type { DisplayItem, NoticeEntry } from '../../lib/view/filter';
import { noticeText } from '../../lib/view/noticeText';
import '../MainPanel/MainPanel.scss';
import '../MainPanel/ConversationRow.scss';
import '../../styles/karaoke.scss';

export interface ConversationListProps {
  items: readonly DisplayItem[];
  /** Characters spoken so far, per segment (karaoke). */
  lit: ReadonlyMap<SegmentId, number>;
  /** The segment a replay is playing, if any. */
  replaying: SegmentId | null;
  /** Legs whose translation rows carry a replay slot. */
  replayLegs: ReadonlySet<LegName>;
  /** The segment kept pcm to replay. */
  canReplay(segmentId: SegmentId): boolean;
  onReplay(leg: LegName, segmentId: SegmentId): void;
  compact: boolean;
  /** In px: the display's `--conversation-font-size`. */
  fontSize: number;
  /** Shown when there is nothing to draw. */
  empty: ReactNode;
}

type RowItem = Extract<DisplayItem, { kind: 'row' }>;

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ConversationList({ items, lit, replaying, replayLegs, canReplay, onReplay, compact, fontSize, empty }: ConversationListProps) {
  const display = useRef<HTMLDivElement>(null);
  // Follow the newest line, as today's panel does; layout has run by the time this fires.
  useLayoutEffect(() => {
    const el = display.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div className="conversation-display" ref={display} style={{ '--conversation-font-size': `${fontSize}px` } as CSSProperties}>
      {items.length === 0 ? (
        <div className="empty-state">{empty}</div>
      ) : (
        <div className="conversation-list">
          {items.map((item) =>
            item.kind === 'notice' ? (
              <NoticeBubble key={item.notice.id} notice={item.notice} />
            ) : (
              <RowBubble
                key={item.row.key}
                item={item}
                upTo={lit.get(item.row.segmentId)}
                replaying={replaying}
                replaySlot={!compact && item.row.side === 'translation' && item.endsSegment && replayLegs.has(item.leg)}
                canReplay={canReplay}
                onReplay={onReplay}
                compact={compact}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

interface RowBubbleProps {
  item: RowItem;
  /** Characters [0, upTo) of the row's segment are spoken; undefined when karaoke is not on it. */
  upTo: number | undefined;
  replaying: SegmentId | null;
  replaySlot: boolean;
  canReplay(segmentId: SegmentId): boolean;
  onReplay(leg: LegName, segmentId: SegmentId): void;
  compact: boolean;
}

function RowBubble({ item, upTo, replaying, replaySlot, canReplay, onReplay, compact }: RowBubbleProps) {
  const { t } = useTranslation();
  const { row, leg, languages } = item;
  const isTranslation = row.side === 'translation';
  // A detected language wins; otherwise the leg's pair, frozen at start (spec: "The language pair belongs to the leg").
  const lang = row.language || (isTranslation ? languages.target : languages.source);
  const scopeName = t(
    leg === 'speaker' ? 'mainPanel.displayMode.speaker' : 'mainPanel.displayMode.participant',
    leg === 'speaker' ? 'Me' : 'Other',
  );
  // Rows tile the segment's text untrimmed; a bubble shows it trimmed, and karaoke counts from the trimmed start.
  const text = row.text.trim();
  const lead = row.text.length - row.text.trimStart().length;
  const played = upTo === undefined ? 0 : Math.min(text.length, Math.max(0, upTo - row.start - lead));
  const segmentId = row.segmentId;
  const enabled = canReplay(segmentId);

  return (
    <div className={`conversation-row source-${leg} ${item.header ? 'with-header' : 'grouped'} ${compact ? 'compact' : 'expanded'}`}>
      {!compact && item.header && (
        <div className="row-header">
          <div className={`row-avatar avatar-${leg}`}>
            {leg === 'speaker' ? <User size={12} /> : <Users size={12} />}
          </div>
          <div className="row-name">
            <span className="row-name-text">{scopeName}</span>
            <span className="row-time">{formatTime(item.t)}</span>
          </div>
        </div>
      )}
      <div className={`row-body ${upTo !== undefined ? 'playing' : ''}`}>
        {compact && item.header && (
          <span className={`row-role-dot source-${leg}`} role="img" aria-label={scopeName} />
        )}
        {!compact && (
          <span className={`lang-badge ${isTranslation ? 'tr' : 'src'} source-${leg}`}>{lang.toUpperCase()}</span>
        )}
        <span className={`row-text ${isTranslation ? 'tr' : 'src'}`}>
          {played <= 0 ? (
            <span>{text}</span>
          ) : played >= text.length ? (
            <span className="karaoke-played">{text}</span>
          ) : (
            <>
              <span className="karaoke-played">{text.slice(0, played)}</span>
              <span>{text.slice(played)}</span>
            </>
          )}
        </span>
        {replaySlot && (
          // The slot's presence depends on the session-wide setting only, never on
          // whether this segment kept pcm, so no row reflows when its audio lands
          // (today's `ConversationRow` rule). One replay plays at a time.
          <button
            type="button"
            className={`row-play-btn ${replaying === segmentId ? 'playing' : ''}`}
            onClick={enabled ? () => onReplay(leg, segmentId) : undefined}
            disabled={!enabled || (replaying !== null && replaying !== segmentId)}
            aria-label={t('mainPanel.playItemAudio', "Play this item's audio")}
            title={t('mainPanel.playItemAudio', "Play this item's audio")}
          >
            <Play size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

function NoticeBubble({ notice }: { notice: NoticeEntry }) {
  const { t } = useTranslation();
  const warning = notice.severity === 'warning';
  return (
    <div className={`message-bubble error${warning ? ' warning' : ''}`}>
      <div className="message-header">
        <AlertCircle size={12} />
        {warning ? t('mainPanel.warning', 'Warning') : t('mainPanel.error', 'Error')}
      </div>
      <div className="message-content error-content">{noticeText(t, notice)}</div>
    </div>
  );
}
