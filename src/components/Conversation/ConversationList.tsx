import { memo, useCallback, useRef, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, Play, User, Users, VolumeX } from 'lucide-react';
import type { Ear } from '../../lib/audio/routes';
import type { LegName, SegmentId } from '../../lib/conversation/types';
import type { DisplayItem, NoticeEntry } from '../../lib/view/filter';
import { personShade } from '../../lib/view/people';
import { SystemRow, type NoticeAction } from './SystemRow';
import { useFollowLatest } from './useFollowLatest';
import '../MainPanel/MainPanel.scss';
import '../MainPanel/ConversationRow.scss';
import '../../styles/karaoke.scss';

export type { NoticeAction } from './SystemRow';

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
  /** Set while replay is gated session-wide (plan 1e-3b-1 ruling 15): every slot is disabled and shows this as its title. */
  replayBlocked?: string | null;
  /** Face-to-face (slice 3): the ear each leg's translation plays in. Absent or null: no ear tags. */
  ears?: Readonly<Record<LegName, Ear>> | null;
  /** The action a notice's bubble offers, if any (plan 1e-3b-1 ruling 13). */
  noticeAction?(notice: NoticeEntry): NoticeAction | null;
  compact: boolean;
  /** In px: the display's `--conversation-font-size`. */
  fontSize: number;
  /** Shown when there is nothing to draw. */
  empty: ReactNode;
}

type RowItem = Extract<DisplayItem, { kind: 'row' }>;

/**
 * A translation's ear, or 'muted' when it is not in its leg's target language: a code-switched line the
 * adapter skips. Exact app codes, as the adapter compares them (variants such as zh-Hans and zh-Hant are peers).
 * It states what the adapter will speak, not that audio played: a degraded TTS is not reflected.
 */
function earTagOf(item: RowItem, ears: Readonly<Record<LegName, Ear>>): Ear | 'muted' {
  const language = item.row.language || item.languages.target;
  return language === item.languages.target ? ears[item.leg] : 'muted';
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ConversationList({
  items, lit, replaying, replayLegs, canReplay, onReplay, replayBlocked, noticeAction, ears, compact, fontSize, empty,
}: ConversationListProps) {
  const display = useRef<HTMLDivElement>(null);
  // The newest line stays in view while the reader is at the bottom; reading back
  // stops that, and the row below the list brings them back.
  const { docked, resume } = useFollowLatest(display, items, items.length === 0);

  // One stable callback identity for RowBubble's memo, whatever identity `onReplay` holds this render.
  const onReplayRef = useRef(onReplay);
  onReplayRef.current = onReplay;
  const replay = useCallback((leg: LegName, segmentId: SegmentId) => onReplayRef.current(leg, segmentId), []);

  // A notice's action keeps its identity while `noticeAction` does (plan 1e-3b-1 ruling 14).
  const actions = useRef<{ from: ConversationListProps['noticeAction']; byId: Map<string, NoticeAction | null> }>({ from: undefined, byId: new Map() });
  if (actions.current.from !== noticeAction) actions.current = { from: noticeAction, byId: new Map() };
  const actionFor = (notice: NoticeEntry): NoticeAction | null => {
    const { byId } = actions.current;
    if (!byId.has(notice.id)) byId.set(notice.id, noticeAction?.(notice) ?? null);
    return byId.get(notice.id)!;
  };

  return (
    <>
      <div className="conversation-display" ref={display} style={{ '--conversation-font-size': `${fontSize}px` } as CSSProperties}>
        {items.length === 0 ? (
          <div className="empty-state">{empty}</div>
        ) : (
          <div className="conversation-list">
            {items.map((item) => {
              if (item.kind === 'notice') {
                return <SystemRow key={item.notice.id} notice={item.notice} action={actionFor(item.notice)} />;
              }
              const ear = ears && !compact && item.row.side === 'translation' && item.endsSegment
                ? earTagOf(item, ears)
                : null;
              // The slot is decided here, session-wide, so a row without one never
              // re-renders for a replay-state change (plan 1e-3b-1 ruling 14). A
              // translation face-to-face does not play has no audio, so no slot either.
              const slot = !compact && item.row.side === 'translation' && item.endsSegment && replayLegs.has(item.leg) && ear !== 'muted';
              const id = item.row.segmentId;
              return (
                <RowBubble
                  key={item.row.key}
                  item={item}
                  upTo={lit.get(id)}
                  replaySlot={slot}
                  canReplay={slot && canReplay(id)}
                  replayingThis={slot && replaying === id}
                  replayingOther={slot && replaying !== null && replaying !== id}
                  blocked={slot ? replayBlocked ?? null : null}
                  onReplay={replay}
                  ear={ear}
                  compact={compact}
                />
              );
            })}
          </div>
        )}
      </div>
      {/* Docked below the list, not floating over it (spec 2026-10-05 goal 4): it takes its
          own height from the bottom, so the line being read does not move. */}
      {docked && <FollowDock onClick={resume} />}
    </>
  );
}

function FollowDock({ onClick }: { onClick(): void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="follow-dock" onClick={onClick}>
      <ArrowDown size={14} aria-hidden="true" />
      <span className="follow-dock__label">{t('mainPanel.backToLatest', 'Back to latest')}</span>
    </button>
  );
}

interface RowBubbleProps {
  item: RowItem;
  /** Characters [0, upTo) of the row's segment are spoken; undefined when karaoke is not on it. */
  upTo: number | undefined;
  replaySlot: boolean;
  canReplay: boolean;
  replayingThis: boolean;
  replayingOther: boolean;
  blocked: string | null;
  onReplay(leg: LegName, segmentId: SegmentId): void;
  ear: Ear | 'muted' | null;
  compact: boolean;
}

const RowBubble = memo(function RowBubble({ item, upTo, replaySlot, canReplay, replayingThis, replayingOther, blocked, onReplay, ear, compact }: RowBubbleProps) {
  const { t } = useTranslation();
  const { row, leg, languages } = item;
  const isTranslation = row.side === 'translation';
  // A detected language wins; otherwise the leg's pair, frozen at start (spec: "The language pair belongs to the leg").
  const lang = row.language || (isTranslation ? languages.target : languages.source);
  const scopeName = item.person !== undefined
    ? t('mainPanel.displayMode.person', { defaultValue: 'Speaker {{n}}', n: item.person })
    : t(
      leg === 'speaker' ? 'mainPanel.displayMode.speaker' : 'mainPanel.displayMode.participant',
      leg === 'speaker' ? 'Me' : 'Other',
    );
  // Rows tile the segment's text untrimmed; a bubble shows it trimmed, and karaoke counts from the trimmed start.
  const text = row.text.trim();
  const lead = row.text.length - row.text.trimStart().length;
  const played = upTo === undefined ? 0 : Math.min(text.length, Math.max(0, upTo - row.start - lead));
  const segmentId = row.segmentId;
  // The tint marks only the row that holds the karaoke boundary — not every
  // row of a segment lit is on, or a row karaoke has already passed.
  const isPlayingRow = upTo !== undefined && ((upTo >= row.start && upTo < row.end) || (item.endsSegment && upTo >= row.end));

  const notPlayed = t(
    'faceToFace.notPlayed',
    'Not played: this translation is in {{language}}, not {{target}}, so it is read to no one.',
    { language: lang.toUpperCase(), target: languages.target.toUpperCase() },
  );

  return (
    <div className={`conversation-row source-${leg} ${item.header ? 'with-header' : 'grouped'} ${compact ? 'compact' : 'expanded'}`}>
      {!compact && item.header && (
        <div className="row-header">
          <div className={`row-avatar avatar-${leg}${item.person !== undefined ? ` person-shade-${personShade(item.person)}` : ''}`}>
            {/* The digit repeats the name beside it ("Speaker 2"): read once, there. */}
            {item.person !== undefined
              ? <span className="row-avatar__number" aria-hidden="true">{item.person}</span>
              : leg === 'speaker' ? <User size={12} /> : <Users size={12} />}
          </div>
          <div className="row-name">
            <span className="row-name-text">{scopeName}</span>
            <span className="row-time">{formatTime(item.t)}</span>
          </div>
        </div>
      )}
      <div className={`row-body ${isPlayingRow ? 'playing' : ''}`}>
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
        {ear === 'muted' && (
          <span
            className="ear-tag ear-tag--muted"
            role="img"
            aria-label={notPlayed}
            title={notPlayed}
          >
            <VolumeX size={10} aria-hidden="true" />
          </span>
        )}
        {(ear === 'left' || ear === 'right') && (
          // Coloured by the listener: a speaker-leg translation is heard by the other person.
          <span
            className={`ear-tag ear-tag--${ear} listener-${leg === 'speaker' ? 'participant' : 'speaker'}`}
            title={ear === 'left' ? t('faceToFace.playedLeft', 'Played in the left ear') : t('faceToFace.playedRight', 'Played in the right ear')}
          >
            {ear === 'left' ? t('faceToFace.earLeft', 'L') : t('faceToFace.earRight', 'R')}
          </span>
        )}
        {replaySlot && (
          // The slot's presence depends on the session-wide setting only, never on
          // whether this segment kept pcm, so no row reflows when its audio lands
          // (RowBubble's own rule). One replay plays at a time.
          <button
            type="button"
            className={`row-play-btn ${replayingThis ? 'playing' : ''}`}
            onClick={canReplay && blocked === null ? () => onReplay(leg, segmentId) : undefined}
            disabled={!canReplay || replayingOther || blocked !== null}
            aria-label={blocked ?? t('mainPanel.playItemAudio', "Play this item's audio")}
            title={blocked ?? t('mainPanel.playItemAudio', "Play this item's audio")}
          >
            <Play size={10} />
          </button>
        )}
      </div>
    </div>
  );
});
