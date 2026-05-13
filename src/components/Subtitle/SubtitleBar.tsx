// src/components/Subtitle/SubtitleBar.tsx
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AArrowDown, AArrowUp, ChevronsDownUp, ChevronsUpDown,
  Pin, Lock, X, Settings, Trash2,
} from 'lucide-react';
import {
  useFloating, useClick, useDismiss, useInteractions, offset, flip, FloatingPortal,
} from '@floating-ui/react';
import DisplayModeButton from '../MainPanel/DisplayModeButton';
import ExportButton from '../MainPanel/ExportButton';
import { useExitSubtitleMode } from '../../stores/settingsStore';
import {
  useSubtitleSettings,
  useSetSubtitleFontSize,
  useSetSubtitleCompactMode,
  useToggleSubtitleAlwaysOnTop,
  useToggleSubtitlePositionLocked,
  useSubtitleSpeakerDisplayMode as useSpeakerDisplayMode,
  useSubtitleParticipantDisplayMode as useParticipantDisplayMode,
  useSetSubtitleSpeakerDisplayMode as useSetSpeakerDisplayMode,
  useSetSubtitleParticipantDisplayMode as useSetParticipantDisplayMode,
  FONT_SIZE_MIN,
  FONT_SIZE_MAX,
} from '../../stores/subtitleStore';
import SubtitleSettingsPopover from './SubtitleSettingsPopover';
import type { SubtitleSurfaceKind } from './SubtitleApp';
import { useOverlayDragResize } from './useOverlayDragResize';
import './SubtitleBar.scss';

interface Props {
  sessionElapsedMs: number;
  sourceLanguageCode: string;
  targetLanguageCode: string;
  onClearConversation: () => void;
  participantHasAudio: boolean;
  exportProps: React.ComponentProps<typeof ExportButton>;
  surface?: SubtitleSurfaceKind;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const SubtitleBar: React.FC<Props> = ({
  sessionElapsedMs,
  sourceLanguageCode,
  targetLanguageCode,
  onClearConversation,
  participantHasAudio,
  exportProps,
  surface = 'electron',
}) => {
  const { t } = useTranslation();
  const subtitle = useSubtitleSettings();
  const setFontSize = useSetSubtitleFontSize();
  const setCompactMode = useSetSubtitleCompactMode();
  const toggleAlwaysOnTop = useToggleSubtitleAlwaysOnTop();
  const togglePositionLocked = useToggleSubtitlePositionLocked();
  const speakerMode = useSpeakerDisplayMode();
  const participantMode = useParticipantDisplayMode();
  const setSpeakerMode = useSetSpeakerDisplayMode();
  const setParticipantMode = useSetParticipantDisplayMode();
  const exitSubtitleMode = useExitSubtitleMode();
  // See SubtitleApp.requestExit — in the extension-overlay surface we forward
  // the exit intent to the side panel via a window event instead of calling
  // the local (no-op) settings store action.
  const requestExit = useCallback(() => {
    if (surface === 'extension-overlay') {
      window.dispatchEvent(new Event('sokuji:user-exit'));
    } else {
      void exitSubtitleMode();
    }
  }, [surface, exitSubtitleMode]);
  // SubtitleBar only needs the drag (move) handle — the 8 resize handles
  // live on SubtitleApp's iframe-filling root so they sit at the iframe
  // edges, not the bar's 36px footprint.
  const { dragHandleProps } = useOverlayDragResize({ surface });

  const [popoverOpen, setPopoverOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: popoverOpen,
    onOpenChange: setPopoverOpen,
    placement: 'bottom-end',
    middleware: [offset(8), flip()],
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  return (
    <div
      className={`subtitle-bar ${subtitle.positionLocked ? 'locked' : ''} ${surface === 'electron' ? 'surface-electron' : 'surface-overlay'}`}
      role="toolbar"
      {...dragHandleProps}
    >
      <div className="subtitle-bar__left">
        <span className="subtitle-bar__logo">Sokuji</span>
        <span className="subtitle-bar__quota" />
      </div>

      <div className="subtitle-bar__center">
        <span className="subtitle-bar__timer">{formatElapsed(sessionElapsedMs)}</span>
        <span className="subtitle-bar__lang">
          {sourceLanguageCode} → {targetLanguageCode}
        </span>
      </div>

      <div className="subtitle-bar__right">
        <DisplayModeButton scope="speaker" value={speakerMode} onChange={setSpeakerMode} />
        {participantHasAudio && (
          <DisplayModeButton scope="participant" value={participantMode} onChange={setParticipantMode} />
        )}
        <button
          type="button"
          className="subtitle-bar__btn"
          onClick={() => setFontSize(subtitle.fontSize - 2)}
          disabled={subtitle.fontSize <= FONT_SIZE_MIN}
          title={t('subtitle.bar.fontDecrease', 'Decrease font size')}
          aria-label={t('subtitle.bar.fontDecrease', 'Decrease font size')}
        >
          <AArrowDown size={14} />
        </button>
        <button
          type="button"
          className="subtitle-bar__btn"
          onClick={() => setFontSize(subtitle.fontSize + 2)}
          disabled={subtitle.fontSize >= FONT_SIZE_MAX}
          title={t('subtitle.bar.fontIncrease', 'Increase font size')}
          aria-label={t('subtitle.bar.fontIncrease', 'Increase font size')}
        >
          <AArrowUp size={14} />
        </button>
        <button
          type="button"
          className="subtitle-bar__btn"
          onClick={() => setCompactMode(!subtitle.compactMode)}
          title={subtitle.compactMode ? t('subtitle.bar.expand', 'Expanded view') : t('subtitle.bar.compact', 'Compact view')}
          aria-label={subtitle.compactMode ? t('subtitle.bar.expand', 'Expanded view') : t('subtitle.bar.compact', 'Compact view')}
        >
          {subtitle.compactMode ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
        </button>
        <ExportButton {...exportProps} />
        <button
          type="button"
          className="subtitle-bar__btn"
          onClick={onClearConversation}
          title={t('subtitle.bar.clear', 'Clear conversation')}
          aria-label={t('subtitle.bar.clear', 'Clear conversation')}
        >
          <Trash2 size={14} />
        </button>

        <span className="subtitle-bar__divider" />

        <button
          type="button"
          className="subtitle-bar__btn"
          ref={refs.setReference}
          {...getReferenceProps()}
          title={t('subtitle.bar.settings', 'Subtitle settings')}
          aria-label={t('subtitle.bar.settings', 'Subtitle settings')}
        >
          <Settings size={14} />
        </button>
        {surface === 'electron' && (
          <button
            type="button"
            className={`subtitle-bar__btn ${subtitle.alwaysOnTop ? 'active' : ''}`}
            onClick={toggleAlwaysOnTop}
            title={t('subtitle.bar.alwaysOnTop', 'Always on top')}
            aria-label={t('subtitle.bar.alwaysOnTop', 'Always on top')}
          >
            <Pin size={14} />
          </button>
        )}
        <button
          type="button"
          className={`subtitle-bar__btn ${subtitle.positionLocked ? 'active' : ''}`}
          onClick={togglePositionLocked}
          title={t('subtitle.bar.lock', 'Lock position and size')}
          aria-label={t('subtitle.bar.lock', 'Lock position and size')}
        >
          <Lock size={14} />
        </button>
        <button
          type="button"
          className="subtitle-bar__btn"
          onClick={requestExit}
          title={t('subtitle.bar.exit', 'Exit subtitle mode')}
          aria-label={t('subtitle.bar.exit', 'Exit subtitle mode')}
        >
          <X size={14} />
        </button>
      </div>

      {popoverOpen && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()}>
            <SubtitleSettingsPopover />
          </div>
        </FloatingPortal>
      )}
    </div>
  );
};

export default SubtitleBar;
