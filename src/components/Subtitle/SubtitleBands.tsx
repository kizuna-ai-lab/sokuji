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
            {band.pieces.map((piece) => (
              <Stretch
                key={piece.key}
                piece={piece}
                upTo={piece.segmentId === undefined ? undefined : lit.get(piece.segmentId)}
                isNew={newItemHighlightEnabled && stateOf(piece.segmentId ?? piece.key) === 'new'}
              />
            ))}
          </p>
        </div>
      ))}
    </>
  );
}

function Stretch({ piece, upTo, isNew }: { piece: BandPiece; upTo: number | undefined; isNew: boolean }) {
  const className = isNew ? 'subtitle-stream__item subtitle-stream__item--new' : 'subtitle-stream__item';
  const played = upTo === undefined || piece.start === undefined ? 0 : Math.min(piece.text.length, Math.max(0, upTo - piece.start));
  if (played <= 0) return <span className={className}>{piece.before}{piece.text}</span>;
  if (played >= piece.text.length) {
    return (
      <span className={className}>
        {piece.before}
        <span className="karaoke-played">{piece.text}</span>
      </span>
    );
  }
  return (
    <span className={className}>
      {piece.before}
      <span className="karaoke-played">{piece.text.slice(0, played)}</span>
      <span>{piece.text.slice(played)}</span>
    </span>
  );
}
