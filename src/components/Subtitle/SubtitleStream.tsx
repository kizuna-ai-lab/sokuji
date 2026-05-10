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

/**
 * Subtitle stream has two display modes driven by `compact`:
 *
 * - compact (default for subtitle mode) — renders the conversation as two
 *   flowing lines: every visible role=user item concatenated into a single
 *   source-language paragraph, and every visible role=assistant item
 *   concatenated into a single translation paragraph. This is the classic
 *   floating-subtitle look.
 *
 * - expanded — falls back to per-item bubbles via ConversationRow with its
 *   full layout (avatar, role label, language badge), suitable for users
 *   who want to read the conversation as a log rather than a stream.
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

  const { sourceText, translationText } = useMemo(() => {
    const sourceParts: string[] = [];
    const translationParts: string[] = [];
    for (const item of filtered) {
      const text = itemText(item).trim();
      if (!text) continue;
      if (item.role === 'user') sourceParts.push(text);
      else if (item.role === 'assistant') translationParts.push(text);
    }
    return {
      sourceText: sourceParts.join(' '),
      translationText: translationParts.join(' '),
    };
  }, [filtered]);

  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (endRef.current && typeof endRef.current.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [compact, sourceText.length, translationText.length, filtered.length]);

  // Apply fontSize to both our flat-line styles and the CSS var that
  // ConversationRow reads in expanded mode.
  const style: React.CSSProperties & Record<string, string> = {
    fontSize: `${fontSize}px`,
    '--conversation-font-size': `${fontSize}px`,
  };
  if (sourceTextColor) style['--subtitle-source-color'] = sourceTextColor;
  if (translationTextColor) style['--subtitle-translation-color'] = translationTextColor;

  return (
    <div className="subtitle-stream" style={style}>
      {compact ? (
        <>
          {sourceText && (
            <p className="subtitle-stream__source">{sourceText}</p>
          )}
          {translationText && (
            <p className="subtitle-stream__translation">{translationText}</p>
          )}
        </>
      ) : (
        filtered.map((item, i) => (
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
        ))
      )}
      <div ref={endRef} />
    </div>
  );
};

export default SubtitleStream;
