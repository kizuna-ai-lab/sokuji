// src/components/Subtitle/SubtitleBar.tsx
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AArrowDown, AArrowUp, ChevronsDownUp, ChevronsUpDown,
  Pin, Lock, X, Settings, Trash2, Maximize, Minimize,
  Play, Square, Loader,
} from 'lucide-react';
import {
  useFloating, useClick, useDismiss, useRole, useInteractions, offset, flip, shift, size,
  autoUpdate, FloatingPortal,
} from '@floating-ui/react';
import ToolbarTooltip from '../Tooltip/ToolbarTooltip';
import DisplayModeButton from '../MainPanel/DisplayModeButton';
import ExportButton from '../MainPanel/ExportButton';
import {
  useExitSubtitleMode,
  useSubtitleFullscreen,
  useSetSubtitleFullscreen,
} from '../../stores/settingsStore';
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
import DisplaySettingsPopover from '../Display/DisplaySettingsPopover';
import type { SubtitleSurfaceKind } from './SubtitleApp';
import { useOverlayDragResize } from './useOverlayDragResize';
import { ChildWindowPopover, useChildPopoverToggle } from './ChildWindowPopover';
import './SubtitleBar.scss';

interface Props {
  sessionElapsedMs: number;
  sourceLanguageCode: string;
  targetLanguageCode: string;
  onClearConversation: () => void;
  speakerActive: boolean;
  participantActive: boolean;
  exportProps: React.ComponentProps<typeof ExportButton>;
  surface?: SubtitleSurfaceKind;
  /**
   * Session start/stop, Electron surface only. Absent on the extension
   * overlay, where the side panel owns session control.
   */
  sessionControl?: {
    isSessionActive: boolean;
    isInitializing: boolean;
    canStart: boolean;
    onStart: () => void;
    onStop: () => void;
  };
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
  speakerActive,
  participantActive,
  exportProps,
  surface = 'electron',
  sessionControl,
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
  const fullscreen = useSubtitleFullscreen();
  const setFullscreen = useSetSubtitleFullscreen();
  // Single source for both title + aria-label so they can't drift apart.
  const fullscreenLabel = fullscreen
    ? t('subtitle.bar.exitFullscreen', 'Exit fullscreen')
    : t('subtitle.bar.fullscreen', 'Fullscreen');
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

  // Electron: the settings popover lives in its own frameless transparent
  // child window — the 200px bar window cannot contain it, and resizing the
  // bar window for it flashes at the compositor level. The extension overlay
  // has no OS window to open (it's an iframe) and keeps the in-window
  // floating popover below.
  const childWindowHost = surface === 'electron';
  const settingsChild = useChildPopoverToggle();
  const settingsBtnRef = useRef<HTMLButtonElement>(null);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: popoverOpen,
    onOpenChange: setPopoverOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 8 }),
      // The overlay iframe can be shorter than the popover; clamp so it
      // scrolls internally instead of being cut off at the iframe edge.
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(0, availableHeight)}px`,
          });
        },
      }),
    ],
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  // useRole wires aria-haspopup / aria-expanded / aria-controls on the
  // trigger button and role="dialog" / aria-modal on the floating wrapper.
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  return (
    <div
      className={`subtitle-bar ${subtitle.positionLocked ? 'locked' : ''} ${surface === 'electron' ? 'surface-electron' : 'surface-overlay'}`}
      role="toolbar"
      {...dragHandleProps}
    >
      <div className="subtitle-bar__left">
        {surface === 'electron' && sessionControl && (
          <ToolbarTooltip
            label={sessionControl.isSessionActive
              ? t('subtitle.bar.stop', 'Stop session')
              : t('subtitle.bar.start', 'Start session')}
          >
            <button
              type="button"
              className={`subtitle-bar__session ${sessionControl.isSessionActive ? 'is-stop' : 'is-start'}`}
              onClick={sessionControl.isSessionActive ? sessionControl.onStop : sessionControl.onStart}
              // Stop must always be clickable during a session — written so that
              // invariant is structural (guarded by !isSessionActive) rather than
              // an accident of isInitializing/canStart never both being true
              // while a session is active.
              disabled={
                !sessionControl.isSessionActive &&
                (sessionControl.isInitializing || !sessionControl.canStart)
              }
              aria-label={sessionControl.isSessionActive
                ? t('subtitle.bar.stop', 'Stop session')
                : t('subtitle.bar.start', 'Start session')}
            >
              {/* 14px matches every other icon in this bar. */}
              {sessionControl.isInitializing
                ? <Loader size={14} className="spinning" />
                : sessionControl.isSessionActive
                  ? <Square size={14} />
                  : <Play size={14} />}
            </button>
          </ToolbarTooltip>
        )}
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
        {speakerActive && (
          <DisplayModeButton scope="speaker" value={speakerMode} onChange={setSpeakerMode} />
        )}
        {participantActive && (
          <DisplayModeButton scope="participant" value={participantMode} onChange={setParticipantMode} />
        )}
        <ToolbarTooltip label={t('subtitle.bar.fontDecrease', 'Decrease font size')}>
          <button
            type="button"
            className="subtitle-bar__btn"
            onClick={() => setFontSize(subtitle.fontSize - 2)}
            disabled={subtitle.fontSize <= FONT_SIZE_MIN}
            aria-label={t('subtitle.bar.fontDecrease', 'Decrease font size')}
          >
            <AArrowDown size={14} />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label={t('subtitle.bar.fontIncrease', 'Increase font size')}>
          <button
            type="button"
            className="subtitle-bar__btn"
            onClick={() => setFontSize(subtitle.fontSize + 2)}
            disabled={subtitle.fontSize >= FONT_SIZE_MAX}
            aria-label={t('subtitle.bar.fontIncrease', 'Increase font size')}
          >
            <AArrowUp size={14} />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label={subtitle.compactMode ? t('subtitle.bar.expand', 'Expanded view') : t('subtitle.bar.compact', 'Compact view')}>
          <button
            type="button"
            className="subtitle-bar__btn"
            onClick={() => setCompactMode(!subtitle.compactMode)}
            aria-label={subtitle.compactMode ? t('subtitle.bar.expand', 'Expanded view') : t('subtitle.bar.compact', 'Compact view')}
          >
            {subtitle.compactMode ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
          </button>
        </ToolbarTooltip>
        {/* In the extension overlay the wire is capped to the recent tail
            (MAX_FORWARDED_ITEMS), so an export here would silently omit older
            messages. The side panel holds the full conversation and is the
            export source of truth — only offer export on the Electron surface,
            where the overlay shares the full session store. */}
        {surface === 'electron' && <ExportButton {...exportProps} popoverHost="child-window" />}
        <ToolbarTooltip label={t('subtitle.bar.clear', 'Clear conversation')}>
          <button
            type="button"
            className="subtitle-bar__btn"
            onClick={onClearConversation}
            aria-label={t('subtitle.bar.clear', 'Clear conversation')}
          >
            <Trash2 size={14} />
          </button>
        </ToolbarTooltip>

        <span className="subtitle-bar__divider" />

        {childWindowHost ? (
          <ToolbarTooltip label={t('subtitle.bar.settings', 'Subtitle settings')}>
            <button
              type="button"
              className={`subtitle-bar__btn ${settingsChild.open ? 'active' : ''}`}
              ref={settingsBtnRef}
              onClick={settingsChild.toggle}
              aria-haspopup="dialog"
              aria-expanded={settingsChild.open}
              aria-label={t('subtitle.bar.settings', 'Subtitle settings')}
            >
              <Settings size={14} />
            </button>
          </ToolbarTooltip>
        ) : (
          <ToolbarTooltip label={t('subtitle.bar.settings', 'Subtitle settings')}>
            <button
              type="button"
              className="subtitle-bar__btn"
              ref={refs.setReference}
              {...getReferenceProps()}
              aria-label={t('subtitle.bar.settings', 'Subtitle settings')}
            >
              <Settings size={14} />
            </button>
          </ToolbarTooltip>
        )}
        {surface === 'electron' && (
          <ToolbarTooltip label={fullscreenLabel}>
            <button
              type="button"
              className={`subtitle-bar__btn ${fullscreen ? 'active' : ''}`}
              onClick={() => void setFullscreen(!fullscreen)}
              aria-label={fullscreenLabel}
            >
              {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
            </button>
          </ToolbarTooltip>
        )}
        {surface === 'electron' && (
          <ToolbarTooltip label={t('subtitle.bar.alwaysOnTop', 'Always on top')}>
            <button
              type="button"
              className={`subtitle-bar__btn ${subtitle.alwaysOnTop ? 'active' : ''}`}
              onClick={toggleAlwaysOnTop}
              aria-label={t('subtitle.bar.alwaysOnTop', 'Always on top')}
            >
              <Pin size={14} />
            </button>
          </ToolbarTooltip>
        )}
        <ToolbarTooltip label={t('subtitle.bar.lock', 'Lock position and size')}>
          <button
            type="button"
            className={`subtitle-bar__btn ${subtitle.positionLocked ? 'active' : ''}`}
            onClick={togglePositionLocked}
            aria-label={t('subtitle.bar.lock', 'Lock position and size')}
          >
            <Lock size={14} />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip label={t('subtitle.bar.exit', 'Exit subtitle mode')}>
          <button
            type="button"
            className="subtitle-bar__btn"
            onClick={requestExit}
            aria-label={t('subtitle.bar.exit', 'Exit subtitle mode')}
          >
            <X size={14} />
          </button>
        </ToolbarTooltip>
      </div>

      {childWindowHost ? (
        <ChildWindowPopover
          open={settingsChild.open}
          onClose={settingsChild.onClose}
          anchorEl={settingsBtnRef.current}
          width={320}
          height={400}
        >
          {/* The floating branch gets role="dialog" + a name from useRole;
              the child-window host has to supply the same semantics itself,
              matching the trigger's aria-haspopup="dialog". */}
          <div role="dialog" aria-label={t('subtitle.bar.settings', 'Subtitle settings')}>
            <DisplaySettingsPopover source="subtitle" />
          </div>
        </ChildWindowPopover>
      ) : (
        popoverOpen && (
          <FloatingPortal>
            <div
              ref={refs.setFloating}
              className="subtitle-bar__settings-popover"
              style={floatingStyles}
              aria-label={t('subtitle.bar.settings', 'Subtitle settings')}
              {...getFloatingProps()}
            >
              <DisplaySettingsPopover source="subtitle" />
            </div>
          </FloatingPortal>
        )
      )}
    </div>
  );
};

export default SubtitleBar;
