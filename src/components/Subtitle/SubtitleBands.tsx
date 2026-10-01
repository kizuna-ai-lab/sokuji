import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { LegName, SegmentId } from '../../lib/conversation/types';
import type { Entry } from '../../lib/projection/types';
import { buildBands, type BandPiece } from '../../lib/subtitle/bands';
import { displayItems, type LegFilters } from '../../lib/view/filter';
import { noticeText } from '../../lib/view/noticeText';
import { ConversationList } from '../Conversation/ConversationList';
import './SubtitleStream.scss';
import '../../styles/karaoke.scss';

export interface SubtitleBodyProps {
  entries: readonly Entry[];
  /** Characters spoken so far, per segment. */
  lit: ReadonlyMap<SegmentId, number>;
  compact: boolean;
  fontSize: number;
  /** The subtitle's own display modes (independent of the panel's). */
  filters: LegFilters;
  sourceTextColor?: string;
  translationTextColor?: string;
  newItemHighlightEnabled: boolean;
}

const NO_REPLAY: ReadonlySet<LegName> = new Set();
const cannotReplay = () => false;
const noReplay = () => {};

/**
 * The subtitle's body: compact bands (four flowing lines) or, expanded, the
 * panel's own list with the subtitle's filters and no replay. The font size
 * and the two text colours are published under today's names for both
 * (`--subtitle-*` for the bands, `--conversation-*` for the list).
 */
export function SubtitleBody(props: SubtitleBodyProps) {
  const { entries, lit, compact, fontSize, filters, sourceTextColor, translationTextColor } = props;
  const style: CSSProperties & Record<string, string> = {
    fontSize: `${fontSize}px`,
    '--conversation-font-size': `${fontSize}px`,
  };
  if (sourceTextColor) {
    style['--subtitle-source-color'] = sourceTextColor;
    style['--conversation-source-color'] = sourceTextColor;
  }
  if (translationTextColor) {
    style['--subtitle-translation-color'] = translationTextColor;
    style['--conversation-translation-color'] = translationTextColor;
  }
  const items = useMemo(() => (compact ? [] : displayItems(entries, filters)), [compact, entries, filters]);
  return (
    <div className={`subtitle-stream ${compact ? 'compact' : 'expanded'}`} style={style}>
      {compact ? (
        <SubtitleBands entries={entries} lit={lit} filters={filters} newItemHighlightEnabled={props.newItemHighlightEnabled} />
      ) : (
        <ConversationList
          items={items}
          lit={lit}
          replaying={null}
          replayLegs={NO_REPLAY}
          canReplay={cannotReplay}
          onReplay={noReplay}
          compact={false}
          fontSize={fontSize}
          empty={null}
        />
      )}
    </div>
  );
}

function SubtitleBands({ entries, lit, filters, newItemHighlightEnabled }: Pick<SubtitleBodyProps, 'entries' | 'lit' | 'filters' | 'newItemHighlightEnabled'>) {
  const { t } = useTranslation();
  const bands = useMemo(() => buildBands(entries, filters, (notice) => noticeText(t, notice)), [entries, filters, t]);

  // A stretch is highlighted once, on the first draw after it arrives; what was
  // there at the first draw never is. Keyed by segment — rows re-cut, segments
  // do not — and segment ids carry the session, so the map never collides.
  const seen = useRef(new Map<string, 'existing' | 'new'>());
  const firstDraw = useRef(true);
  const stateOf = (id: string) => seen.current.get(id) ?? (firstDraw.current ? 'existing' : 'new');
  useLayoutEffect(() => {
    for (const band of bands) {
      for (const piece of band.pieces) {
        const id = piece.segmentId ?? piece.key;
        if (!seen.current.has(id)) seen.current.set(id, firstDraw.current ? 'existing' : 'new');
      }
    }
    firstDraw.current = false;
  });

  return (
    <>
      {bands.map((band) => (
        <div key={band.id} className={`subtitle-stream__line subtitle-stream__line--${band.side} subtitle-stream__line--${band.leg}`}>
          <p>
            {runsOf(band.pieces).map((run) => (
              <Run
                key={run.key}
                run={run}
                lit={lit}
                isNew={newItemHighlightEnabled && stateOf(run.key) === 'new'}
              />
            ))}
          </p>
        </div>
      ))}
    </>
  );
}

/** One segment's consecutive pieces (a notice is a run of its own). */
interface RunOf {
  /** The segment id, or the (single) piece's key for a notice. */
  key: string;
  segmentId?: SegmentId;
  before: string;
  pieces: BandPiece[];
}

/**
 * Groups a band's flat pieces into runs: consecutive pieces of one segment
 * join into a single run (so a re-cut segment draws one item, not one per
 * row); a notice, which carries no segment id, is always its own run.
 */
function runsOf(pieces: readonly BandPiece[]): RunOf[] {
  const runs: RunOf[] = [];
  for (const piece of pieces) {
    const last = runs[runs.length - 1];
    if (last && piece.segmentId !== undefined && last.segmentId === piece.segmentId) {
      last.pieces.push(piece);
    } else {
      runs.push({ key: piece.segmentId ?? piece.key, segmentId: piece.segmentId, before: piece.before, pieces: [piece] });
    }
  }
  return runs;
}

function Run({ run, lit, isNew }: { run: RunOf; lit: ReadonlyMap<SegmentId, number>; isNew: boolean }) {
  const className = isNew ? 'subtitle-stream__item subtitle-stream__item--new' : 'subtitle-stream__item';
  const upTo = run.segmentId === undefined ? undefined : lit.get(run.segmentId);
  return (
    <span className={className} data-segment={run.segmentId}>
      {run.before}
      {run.pieces.map((piece) => <Stretch key={piece.key} piece={piece} upTo={upTo} />)}
    </span>
  );
}

function Stretch({ piece, upTo }: { piece: BandPiece; upTo: number | undefined }) {
  const played = upTo === undefined || piece.start === undefined ? 0 : Math.min(piece.text.length, Math.max(0, upTo - piece.start));
  if (played <= 0) return <span>{piece.text}</span>;
  if (played >= piece.text.length) return <span className="karaoke-played">{piece.text}</span>;
  return (
    <>
      <span className="karaoke-played">{piece.text.slice(0, played)}</span>
      <span>{piece.text.slice(played)}</span>
    </>
  );
}
