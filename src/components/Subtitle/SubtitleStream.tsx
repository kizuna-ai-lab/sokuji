import React, { useEffect, useRef, useMemo } from 'react';
import ConversationRow from '../MainPanel/ConversationRow';
import { shouldShowItem } from '../MainPanel/conversationFilter';
import type { DisplayMode } from '../../stores/subtitleStore';
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

// Cap how much text any one compact band concatenates. The band only
// shows the tail anyway (overflow clipped to bottom), so processing the
// full conversation history on every streaming update wastes CPU as
// the session grows. ~2000 chars is well past what any visible band
// could display at typical font sizes; older content drops cleanly.
const BUCKET_MAX_CHARS = 2000;

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
 *   line concatenates the most recent visible items of its category up to
 *   BUCKET_MAX_CHARS. Empty lines are dropped. All visible lines share
 *   the available height equally; when a line is longer than its band the
 *   band clips to the bottom so the newest text stays pinned.
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
    const bucketLen: Record<string, number> = {
      'speaker-source': 0,
      'speaker-translation': 0,
      'participant-source': 0,
      'participant-translation': 0,
    };

    // Walk items newest-first, prepending each item's text to its bucket
    // until that bucket reaches BUCKET_MAX_CHARS. Older items beyond the
    // cap are dropped — the band only shows the tail anyway. shouldShowItem
    // lets error/system rows pass; route them to the translation bucket of
    // whichever side produced them so they remain visible.
    for (let i = filtered.length - 1; i >= 0; i--) {
      const item = filtered[i];
      const text = itemText(item).trim();
      if (!text) continue;
      const side: LineSource = item.source === 'participant' ? 'participant' : 'speaker';
      let kind: LineKind;
      if (item.role === 'user') kind = 'source';
      else if (item.role === 'assistant') kind = 'translation';
      else if (item.type === 'error' || item.role === 'system') kind = 'translation';
      else continue;
      const key = `${side}-${kind}`;
      if (bucketLen[key] >= BUCKET_MAX_CHARS) continue;
      buckets[key].unshift(text);
      bucketLen[key] += text.length + 1; // +1 for the joining space
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

  // Stick to bottom only in expanded mode, where ConversationRow rows pile
  // up in a scrollable column and need to follow the latest content. In
  // compact mode each band is a fixed flex slot with internal overflow:
  // hidden, so the parent never scrolls and scrollIntoView is a no-op
  // (and `behavior: 'smooth'` would just add jitter during streaming).
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (compact) return;
    if (endRef.current && typeof endRef.current.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, [compact, filtered.length]);

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
