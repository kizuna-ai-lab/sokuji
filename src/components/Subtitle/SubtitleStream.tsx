import React, { useEffect, useRef, useMemo } from 'react';
import ConversationRow from '../MainPanel/ConversationRow';
import { shouldShowItem } from '../MainPanel/conversationFilter';
import type { DisplayMode } from '../../stores/settingsStore';
import './SubtitleStream.scss';

interface Props {
  items: any[];
  compact: boolean;
  fontSize: number;
  speakerMode: DisplayMode;
  participantMode: DisplayMode;
  sourceLanguage: string;
  targetLanguage: string;
  sourceTextColor?: string;
  translationTextColor?: string;
}

function itemText(item: any): string {
  return item?.formatted?.transcript || item?.formatted?.text || '';
}

type LineKind = 'source' | 'translation';
type LineSource = 'speaker' | 'participant';
interface SubtitleLine {
  id: string;
  kind: LineKind;
  source: LineSource;
  text: string;
}

/**
 * Subtitle stream has two display modes driven by `compact`:
 *
 * - compact (default) — renders up to four flowing lines: speaker source,
 *   speaker translation, participant source, participant translation. Each
 *   line concatenates every visible item of its category in chronological
 *   order. Empty lines (no items, or hidden by displayMode) are dropped.
 *   All visible lines share the available height equally; when a single
 *   line's text is longer than its band it clips to the bottom so the
 *   newest text stays visible without pushing other lines off-screen.
 *
 * - expanded — falls back to per-item ConversationRow with its full layout
 *   (avatar, role label, language badge), suitable for users who want to
 *   read the conversation as a log rather than a subtitle stream.
 */
const SubtitleStream: React.FC<Props> = ({
  items,
  compact,
  fontSize,
  speakerMode,
  participantMode,
  sourceLanguage,
  targetLanguage,
  sourceTextColor,
  translationTextColor,
}) => {
  const filtered = useMemo(
    () => items.filter((item) => shouldShowItem(item, speakerMode, participantMode)),
    [items, speakerMode, participantMode],
  );

  const lines = useMemo<SubtitleLine[]>(() => {
    const buckets: Record<string, string[]> = {
      'speaker-source': [],
      'speaker-translation': [],
      'participant-source': [],
      'participant-translation': [],
    };
    for (const item of filtered) {
      const text = itemText(item).trim();
      if (!text) continue;
      const source: LineSource = item.source === 'participant' ? 'participant' : 'speaker';
      const kind: LineKind | null =
        item.role === 'user' ? 'source' : item.role === 'assistant' ? 'translation' : null;
      if (!kind) continue;
      buckets[`${source}-${kind}`].push(text);
    }
    const order: Array<{ source: LineSource; kind: LineKind }> = [
      { source: 'speaker', kind: 'source' },
      { source: 'speaker', kind: 'translation' },
      { source: 'participant', kind: 'source' },
      { source: 'participant', kind: 'translation' },
    ];
    return order
      .map(({ source, kind }) => ({
        id: `${source}-${kind}`,
        source,
        kind,
        text: buckets[`${source}-${kind}`].join(' '),
      }))
      .filter((l) => l.text.length > 0);
  }, [filtered]);

  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (endRef.current && typeof endRef.current.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [compact, lines, filtered.length]);

  // Apply fontSize to both our flat-line styles and the CSS var that
  // ConversationRow reads in expanded mode.
  const style: React.CSSProperties & Record<string, string> = {
    fontSize: `${fontSize}px`,
    '--conversation-font-size': `${fontSize}px`,
  };
  if (sourceTextColor) style['--subtitle-source-color'] = sourceTextColor;
  if (translationTextColor) style['--subtitle-translation-color'] = translationTextColor;

  return (
    <div className={`subtitle-stream ${compact ? 'compact' : 'expanded'}`} style={style}>
      {compact
        ? lines.map((line) => (
            <div
              key={line.id}
              className={`subtitle-stream__line subtitle-stream__line--${line.kind} subtitle-stream__line--${line.source}`}
            >
              <p>{line.text}</p>
            </div>
          ))
        : filtered.map((item, i) => (
            <ConversationRow
              key={item.id}
              item={item}
              prevItem={filtered[i - 1] ?? null}
              compact={false}
              sourceLanguage={sourceLanguage}
              targetLanguage={targetLanguage}
              isPlaying={false}
              highlightedChars={0}
              canPlay={false}
            />
          ))}
      <div ref={endRef} />
    </div>
  );
};

export default SubtitleStream;
