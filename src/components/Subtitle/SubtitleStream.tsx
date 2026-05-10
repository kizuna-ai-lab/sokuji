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

  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (endRef.current && typeof endRef.current.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [filtered.length]);

  const style: React.CSSProperties & Record<string, string> = {
    fontSize: `${fontSize}px`,
  };
  if (sourceTextColor) style['--subtitle-source-color'] = sourceTextColor;
  if (translationTextColor) style['--subtitle-translation-color'] = translationTextColor;

  return (
    <div className="subtitle-stream" style={style}>
      {filtered.map((item, i) => (
        <ConversationRow
          key={item.id}
          item={item}
          prevItem={filtered[i - 1] ?? null}
          compact={compact}
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
