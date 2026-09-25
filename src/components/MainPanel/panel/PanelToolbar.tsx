import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AArrowDown, AArrowUp, ChevronsDownUp, ChevronsUpDown, Settings, Trash2 } from 'lucide-react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  size,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
  FloatingPortal,
} from '@floating-ui/react';
import DisplayModeButton from '../DisplayModeButton';
import { ExportMenuButton } from '../ExportButton';
import DisplaySettingsPopover from '../../Display/DisplaySettingsPopover';
import {
  useSpeakerDisplayMode,
  useParticipantDisplayMode,
  useSetSpeakerDisplayMode,
  useSetParticipantDisplayMode,
} from '../../../stores/settingsStore';
import {
  useConversationDisplayFontSize,
  useSetConversationDisplayFontSize,
  useConversationDisplayCompactMode,
  useSetConversationDisplayCompactMode,
  CONVERSATION_FONT_SIZE_MIN,
  CONVERSATION_FONT_SIZE_MAX,
} from '../../../stores/conversationDisplayStore';
import type { LegName } from '../../../lib/conversation/types';
import type { Exporter } from '../../../lib/export/exporter';

export interface PanelToolbarProps {
  /** The subtitle session's legs — intent and conversation already merged (Task 7). */
  legs: readonly LegName[];
  exporter: Exporter;
  hasConversation: boolean;
  onClear(): void;
}

/**
 * The conversation toolbar: display-mode buttons, font size, compact,
 * export and clear, plus the display-settings popover. Today's markup
 * (`MainPanel.tsx:4472-4583`) verbatim, with `legs` replacing the old
 * `effectiveMode || items.length > 0` condition (ruling 12) and the export
 * menu now over an `Exporter` instead of the raw item list.
 */
const PanelToolbar: React.FC<PanelToolbarProps> = ({ legs, exporter, hasConversation, onClear }) => {
  const { t } = useTranslation();

  const speakerDisplayMode = useSpeakerDisplayMode();
  const participantDisplayMode = useParticipantDisplayMode();
  const setSpeakerDisplayMode = useSetSpeakerDisplayMode();
  const setParticipantDisplayMode = useSetParticipantDisplayMode();

  const conversationFontSize = useConversationDisplayFontSize();
  const setConversationFontSize = useSetConversationDisplayFontSize();
  const conversationCompactMode = useConversationDisplayCompactMode();
  const setConversationCompactMode = useSetConversationDisplayCompactMode();

  // Display settings popover (conversation-toolbar ⚙)
  const [displayPopoverOpen, setDisplayPopoverOpen] = useState(false);
  const displayPopoverFloating = useFloating({
    open: displayPopoverOpen,
    onOpenChange: setDisplayPopoverOpen,
    placement: 'bottom-end',
    // Re-position and re-clamp while open — without this a window resize
    // leaves flip/shift/size results stale (same as ModeDevicePopover).
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip(),
      shift({ padding: 8 }),
      // Clamp to the viewport so a short window scrolls the popover instead
      // of cutting it off — same pattern as ModeDevicePopover.
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
  // useRole wires aria-haspopup / aria-expanded / aria-controls on the
  // trigger button and role="dialog" / aria-modal on the floating wrapper.
  const displayPopoverInteractions = useInteractions([
    useClick(displayPopoverFloating.context),
    useDismiss(displayPopoverFloating.context),
    useRole(displayPopoverFloating.context, { role: 'dialog' }),
  ]);

  return (
    <>
      <div className="conversation-toolbar">
        {/*
          Show each display-mode button when its channel is intent-active for
          the (current or locked) session, OR when items already exist for that
          channel — the items fallback keeps the buttons available after the
          session ends so users can still reconfigure display of historical
          conversation. Previously: speaker button always showed (wrong in
          participant-only mode) and participant button was late-binding on
          items (no preconfig before the first translation arrived).
        */}
        {legs.includes('speaker') && (
          <DisplayModeButton
            scope="speaker"
            value={speakerDisplayMode}
            onChange={setSpeakerDisplayMode}
          />
        )}
        {legs.includes('participant') && (
          <DisplayModeButton
            scope="participant"
            value={participantDisplayMode}
            onChange={setParticipantDisplayMode}
          />
        )}
        <button
          className="font-size-btn"
          onClick={() => setConversationFontSize(Math.max(CONVERSATION_FONT_SIZE_MIN, conversationFontSize - 2))}
          disabled={conversationFontSize <= CONVERSATION_FONT_SIZE_MIN}
          title={t('mainPanel.decreaseFontSize', 'Decrease font size')}
          aria-label={t('mainPanel.decreaseFontSize', 'Decrease font size')}
          type="button"
        >
          <AArrowDown size={14} />
        </button>
        <button
          className="font-size-btn"
          onClick={() => setConversationFontSize(Math.min(CONVERSATION_FONT_SIZE_MAX, conversationFontSize + 2))}
          disabled={conversationFontSize >= CONVERSATION_FONT_SIZE_MAX}
          title={t('mainPanel.increaseFontSize', 'Increase font size')}
          aria-label={t('mainPanel.increaseFontSize', 'Increase font size')}
          type="button"
        >
          <AArrowUp size={14} />
        </button>
        <button
          className="font-size-btn"
          onClick={() => setConversationCompactMode(!conversationCompactMode)}
          aria-pressed={conversationCompactMode}
          title={
            conversationCompactMode
              ? t('mainPanel.expandedView', 'Expanded view')
              : t('mainPanel.compactView', 'Compact view')
          }
          aria-label={
            conversationCompactMode
              ? t('mainPanel.expandedView', 'Expanded view')
              : t('mainPanel.compactView', 'Compact view')
          }
          type="button"
        >
          {conversationCompactMode ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
        </button>
        {/* Export */}
        {/* combinedItems, not filteredItems: the export menu holds its own
            scope, seeded from these two modes. Handing it a pre-filtered
            list would narrow the file with no way for the user to widen it
            back — and would drag the unrelated basic/advanced uiMode
            filter into the export as well. */}
        <ExportMenuButton
          exporter={exporter}
          speakerMode={speakerDisplayMode}
          participantMode={participantDisplayMode}
        />
        <button
          className="font-size-btn"
          ref={displayPopoverFloating.refs.setReference}
          {...displayPopoverInteractions.getReferenceProps()}
          title={t('mainPanel.displaySettings', 'Display settings')}
          aria-label={t('mainPanel.displaySettings', 'Display settings')}
          type="button"
        >
          <Settings size={14} />
        </button>
        <button
          className="clear-conversation-btn"
          onClick={onClear}
          disabled={!hasConversation}
          title={t('mainPanel.clearConversation', 'Clear conversation')}
          aria-label={t('mainPanel.clearConversation', 'Clear conversation')}
          type="button"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {displayPopoverOpen && (
        <FloatingPortal>
          <div
            ref={displayPopoverFloating.refs.setFloating}
            className="display-popover-floating"
            style={displayPopoverFloating.floatingStyles}
            aria-label={t('mainPanel.displaySettings', 'Display settings')}
            {...displayPopoverInteractions.getFloatingProps()}
          >
            <DisplaySettingsPopover source="conversation" />
          </div>
        </FloatingPortal>
      )}
    </>
  );
};

export default PanelToolbar;
