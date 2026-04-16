import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import type { ConversationItem } from '../../services/interfaces/IClient';
import './ConversationRow.scss';

interface ConversationRowProps {
  item: ConversationItem & { source?: 'speaker' | 'participant' };
  prevItem?: (ConversationItem & { source?: 'speaker' | 'participant' }) | null;
  sourceLanguage: string;
  targetLanguage: string;
  isPlaying: boolean;
  highlightedChars: number;
  canPlay?: boolean;
  onPlay?: () => void;
  playDisabled?: boolean;
}

function languageForItem(
  source: 'speaker' | 'participant',
  role: 'user' | 'assistant' | 'system',
  sourceLanguage: string,
  targetLanguage: string,
): string {
  // speaker/user       -> sourceLanguage  (I speak my language)
  // speaker/assistant  -> targetLanguage  (translated for others)
  // participant/user   -> targetLanguage  (they speak the other language)
  // participant/assistant -> sourceLanguage (translated back to me)
  if (source === 'speaker') {
    return role === 'user' ? sourceLanguage : targetLanguage;
  }
  return role === 'user' ? targetLanguage : sourceLanguage;
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const ConversationRow: React.FC<ConversationRowProps> = ({
  item,
  prevItem,
  sourceLanguage,
  targetLanguage,
  isPlaying,
  highlightedChars,
  canPlay = false,
  onPlay,
  playDisabled = false,
}) => {
  const { t } = useTranslation();
  const source: 'speaker' | 'participant' = item.source ?? 'speaker';
  const role = item.role;
  const text = item.formatted?.transcript || item.formatted?.text || '';

  const showHeader = !prevItem || (prevItem.source ?? 'speaker') !== source;
  const isTranslation = role === 'assistant';
  const lang = useMemo(
    () => languageForItem(source, role, sourceLanguage, targetLanguage),
    [source, role, sourceLanguage, targetLanguage],
  );

  const scopeName = t(
    source === 'speaker' ? 'mainPanel.displayMode.speaker' : 'mainPanel.displayMode.participant',
    source === 'speaker' ? 'Me' : 'Them',
  );

  const renderText = () => {
    if (!isPlaying || highlightedChars <= 0 || highlightedChars >= text.length) {
      return <span>{text}</span>;
    }
    return (
      <>
        <span className="row-text-played">{text.slice(0, highlightedChars)}</span>
        <span>{text.slice(highlightedChars)}</span>
      </>
    );
  };

  return (
    <div className={`conversation-row source-${source} ${showHeader ? 'with-header' : 'grouped'}`}>
      {showHeader && (
        <div className="row-header">
          <div className={`row-avatar avatar-${source}`}>{scopeName.slice(0, 2)}</div>
          <div className="row-name">
            <span className="row-name-text">{scopeName}</span>
            <span className="row-time">{formatTime(item.createdAt)}</span>
          </div>
        </div>
      )}
      <div className={`row-body ${isPlaying ? 'playing' : ''}`}>
        <span className={`lang-badge ${isTranslation ? 'tr' : 'src'}`}>{lang.toUpperCase()}</span>
        <span className={`row-text ${isTranslation ? 'tr' : 'src'}`}>{renderText()}</span>
        {canPlay && onPlay && (
          <button
            type="button"
            className={`row-play-btn ${isPlaying ? 'playing' : ''}`}
            onClick={onPlay}
            disabled={playDisabled}
            aria-label={t('mainPanel.playItemAudio', 'Play this item\'s audio')}
            title={t('mainPanel.playItemAudio', 'Play this item\'s audio')}
          >
            <Play size={10} />
          </button>
        )}
      </div>
    </div>
  );
};

export default ConversationRow;
