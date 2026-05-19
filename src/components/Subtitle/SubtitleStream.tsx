import React, { useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import ConversationRow from '../MainPanel/ConversationRow';
import { shouldShowItem } from '../MainPanel/conversationFilter';
import type { DisplayMode } from '../../stores/subtitleStore';
import { usePlaybackHighlight } from '../../stores/playbackStore';
import './SubtitleStream.scss';
import '../../styles/karaoke.scss';

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
  // When false, items that arrive after first mount are still tracked but
  // do not receive the `--new` modifier — the CSS highlight never fires.
  // Defaults to true; passed through from the persisted subtitle setting.
  newItemHighlightEnabled?: boolean;
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
interface SubtitleLineItem {
  id: string;
  text: string;
}
interface SubtitleLine {
  id: string;
  kind: LineKind;
  source: LineSource;
  items: SubtitleLineItem[];
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
  newItemHighlightEnabled = true,
}) => {
  const filtered = useMemo(
    () => items.filter((item) => shouldShowItem(item, speakerMode, participantMode)),
    [items, speakerMode, participantMode],
  );

  const lines = useMemo<SubtitleLine[]>(() => {
    const buckets: Record<string, SubtitleLineItem[]> = {
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
      buckets[key].unshift({ id: item.id, text });
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
        items: buckets[`${source}-${kind}`],
      }))
      .filter((l) => l.items.length > 0);
  }, [filtered]);

  const itemsById = useMemo(
    () => new Map<string, any>(items.map((it) => [it.id, it])),
    [items],
  );

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

  // Each item is classified once and locked: 'existing' = present at first
  // render of this component instance (never animates), 'new' = arrived later
  // (animates exactly once on first paint via CSS @keyframes). The map grows
  // monotonically — by design, no pruning — typical sessions hit hundreds
  // of entries, well below any memory concern. StrictMode's double-invocation
  // of effects is safe: the `has()` guard skips re-insertion on the second pass.
  const itemStatesRef = useRef<Map<string, 'existing' | 'new'>>(new Map());
  const isFirstRenderRef = useRef(true);

  const itemStateFor = (id: string): 'existing' | 'new' => {
    const known = itemStatesRef.current.get(id);
    if (known !== undefined) return known;
    return isFirstRenderRef.current ? 'existing' : 'new';
  };

  // No deps — runs after every render to lock in state for newly-visible
  // items. Adding a [lines] dep would also work in practice; the no-deps
  // form is chosen so future refactors of `lines` (e.g. additional memo
  // layers) can't accidentally skip a commit.
  useLayoutEffect(() => {
    for (const line of lines) {
      for (const it of line.items) {
        if (!itemStatesRef.current.has(it.id)) {
          itemStatesRef.current.set(
            it.id,
            isFirstRenderRef.current ? 'existing' : 'new',
          );
        }
      }
    }
    isFirstRenderRef.current = false;
  });

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
              <p>
                {line.items.map((it, idx) => (
                  <CompactSpan
                    key={it.id}
                    it={it}
                    item={itemsById.get(it.id)}
                    showNewHighlight={newItemHighlightEnabled && itemStateFor(it.id) === 'new'}
                    leadingSpace={idx > 0}
                  />
                ))}
              </p>
            </div>
          ))
        : filtered.map((item, i) => (
            <SubtitleConversationRow
              key={item.id}
              item={item}
              prevItem={filtered[i - 1] ?? null}
              sourceLanguage={sourceLanguage}
              targetLanguage={targetLanguage}
            />
          ))}
      <div ref={endRef} />
    </div>
  );
};

interface CompactSpanProps {
  it: SubtitleLineItem;
  item: any | undefined;
  showNewHighlight: boolean;
  leadingSpace: boolean;
}

const CompactSpan: React.FC<CompactSpanProps> = ({
  it,
  item,
  showNewHighlight,
  leadingSpace,
}) => {
  const { isPlaying, highlightedChars } = usePlaybackHighlight(item, it.text);
  const baseClass = showNewHighlight
    ? 'subtitle-stream__item subtitle-stream__item--new'
    : 'subtitle-stream__item';
  const prefix = leadingSpace ? ' ' : '';

  if (!isPlaying || highlightedChars <= 0) {
    return <span className={baseClass}>{prefix}{it.text}</span>;
  }
  if (highlightedChars >= it.text.length) {
    // Fully played — color the whole span (the previous behaviour stripped
    // the styling here, producing a brief "all uncolored" frame at completion).
    return (
      <span className={baseClass}>
        {prefix}
        <span className="karaoke-played">{it.text}</span>
      </span>
    );
  }
  return (
    <span className={baseClass}>
      {prefix}
      <span className="karaoke-played">{it.text.slice(0, highlightedChars)}</span>
      <span>{it.text.slice(highlightedChars)}</span>
    </span>
  );
};

const SubtitleConversationRow: React.FC<{
  item: any;
  prevItem: any;
  sourceLanguage: string;
  targetLanguage: string;
}> = ({ item, prevItem, sourceLanguage, targetLanguage }) => {
  const { isPlaying, highlightedChars } = usePlaybackHighlight(item);
  return (
    <ConversationRow
      item={item}
      prevItem={prevItem}
      compact={false}
      sourceLanguage={sourceLanguage}
      targetLanguage={targetLanguage}
      isPlaying={isPlaying}
      highlightedChars={highlightedChars}
      canPlay={false}
    />
  );
};

export default SubtitleStream;
