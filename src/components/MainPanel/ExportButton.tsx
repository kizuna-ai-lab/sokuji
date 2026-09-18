import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ChevronDown, Copy, FileText, FileJson } from 'lucide-react';
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
  useListNavigation,
  useInteractions,
  FloatingFocusManager,
  FloatingPortal,
} from '@floating-ui/react';
import type { ConversationItem } from '../../services/interfaces/IClient';
import type { DisplayMode } from '../../stores/settingsStore';
import { shouldShowItem, modeToToggles, togglesToMode, type ScopeToggles } from './conversationFilter';
import {
  buildExportPayload,
  buildTxtExport,
  buildTxtI18n,
  copyToClipboard,
  downloadFile,
  exportFilename,
  formatAsJson,
  formatAsTxt,
  normalizeMessages,
  type ExportInput,
  type TxtI18n,
} from '../../utils/conversationExport';
import { useToast } from '../Toast';
import { ChildWindowPopover, useChildPopoverToggle } from '../Subtitle/ChildWindowPopover';
import { useAutoSaveOnStop, useSetAutoSaveOnStop } from '../../stores/settingsStore';
import { isElectron } from '../../utils/environment';
import './ExportButton.scss';

interface ExportButtonProps {
  /**
   * Already-merged-and-sorted items — the FULL list, unfiltered. Which of
   * them reach the file is decided here, by the scope checkboxes, so that a
   * caller cannot silently narrow an export by passing a shorter array.
   */
  combinedItems: Array<ConversationItem & {
    source?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
  }>;
  /** Speaker-side toolbar filter. Seeds the scope checkboxes; never written back. */
  speakerMode: DisplayMode;
  /** Participant-side toolbar filter. Seeds the scope checkboxes; never written back. */
  participantMode: DisplayMode;
  /** Current provider id from useProvider(). */
  provider: string;
  /** Snapshot of the current provider's settings (from getCurrentProviderSettings()). */
  currentProviderSettings: any;
  /** Local-inference settings sub-object (from useLocalInferenceSettings()), used only when provider === LOCAL_INFERENCE. */
  localInferenceSettings: any;
  /** Source language code from current provider settings. Used as a fallback when the conversation carries no per-item language snapshots (e.g. empty conversation). */
  sourceLanguage: string;
  /** Target language code from current provider settings. Used as a fallback when the conversation carries no per-item language snapshots (e.g. empty conversation). */
  targetLanguage: string;
  /**
   * Where the menu renders. 'floating' (default) is the in-window floating-ui
   * menu. 'child-window' hosts it in its own frameless OS window — for the
   * Electron subtitle bar, whose 200px window cannot contain the menu.
   */
  popoverHost?: 'floating' | 'child-window';
}

const ExportButton: React.FC<ExportButtonProps> = ({
  combinedItems,
  speakerMode,
  participantMode,
  provider,
  currentProviderSettings,
  localInferenceSettings,
  sourceLanguage,
  targetLanguage,
  popoverHost = 'floating',
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const childHosted = popoverHost === 'child-window';
  const childMenu = useChildPopoverToggle();
  const childBtnRef = React.useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = React.useRef<Array<HTMLElement | null>>([]);

  // The session-end auto-save lives here, next to the export it automates.
  const autoSaveOnStop = useAutoSaveOnStop();
  const setAutoSaveOnStop = useSetAutoSaveOnStop();
  const toggleAutoSave = () => { void setAutoSaveOnStop(!autoSaveOnStop); };

  // Roving tabindex: when the menu opens, make the first item tabbable so
  // keyboard focus (managed by FloatingFocusManager) lands on something.
  useEffect(() => {
    if (isOpen) {
      setActiveIndex(0);
    }
  }, [isOpen]);

  // What goes in the file. Seeded from the toolbar filter so the default is
  // "what you are looking at", but held here and never written back — the
  // toolbar is a viewing preference, not a second place export scope lives.
  const [speaker, setSpeaker] = useState<ScopeToggles>(() => modeToToggles(speakerMode));
  const [participant, setParticipant] = useState<ScopeToggles>(() => modeToToggles(participantMode));

  // Apply the scope with the same predicate the conversation view uses, so
  // "what the file contains" and "what the screen shows" can never drift
  // apart by having two filters to keep in step.
  const scopedItems = useMemo(
    () => combinedItems.filter(
      (item) => shouldShowItem(item, togglesToMode(speaker), togglesToMode(participant)),
    ),
    [combinedItems, speaker, participant]
  );

  // Normalize once per scope change; this is the export payload.
  const normalizedMessages = useMemo(
    () => normalizeMessages(scopedItems),
    [scopedItems]
  );

  // Two different questions. The button asks "is there a conversation at all",
  // so a filter that currently selects nothing cannot lock the user out of the
  // menu that would let them widen it. The actions ask "does the current scope
  // select anything".
  const hasContent = useMemo(() => normalizeMessages(combinedItems).length > 0, [combinedItems]);
  const scopeHasContent = normalizedMessages.length > 0;

  // Re-seed from the toolbar on every open, so "the default is what you are
  // looking at" keeps holding after the toolbar changes. Done on the opening
  // action rather than in an effect, so a toolbar change while the menu is
  // open cannot wipe an edit the user is in the middle of making.
  const seedScope = useCallback(() => {
    setSpeaker(modeToToggles(speakerMode));
    setParticipant(modeToToggles(participantMode));
  }, [speakerMode, participantMode]);

  const scopeTitle = t('mainPanel.export.scopeLabel', 'Include');
  const lines = useMemo(() => ([
    { key: 'src' as const, label: t('mainPanel.displayMode.source', 'Src') },
    { key: 'trans' as const, label: t('mainPanel.displayMode.translation', 'Trans') },
  ]), [t]);
  const scopeRows = useMemo(() => ([
    { key: 'speaker', label: t('mainPanel.displayMode.speaker', 'Me'), toggles: speaker, set: setSpeaker },
    { key: 'participant', label: t('mainPanel.displayMode.participant', 'Other'), toggles: participant, set: setParticipant },
  ]), [t, speaker, participant]);
  /** Checkboxes come first in the keyboard ring; the actions follow them. */
  const scopeRingSize = scopeRows.length * lines.length;

  /**
   * The scope checkboxes, shared by both menu hosts. `roving` wires them into
   * floating-ui's list navigation so arrow keys walk the checkboxes and the
   * actions as one ring; the child window uses native focus instead and passes
   * false.
   */
  const renderScope = (roving: boolean) => (
    <>
    <div className="export-scope" role="group" aria-label={scopeTitle}>
      <div className="export-scope-title">{scopeTitle}</div>
      {scopeRows.map((row, rowIdx) => (
        <div className="export-scope-row" key={row.key}>
          <span className="export-scope-row-label">{row.label}</span>
          {lines.map((line, lineIdx) => {
            const ringIndex = rowIdx * lines.length + lineIdx;
            const toggle = () => row.set((prev) => ({ ...prev, [line.key]: !prev[line.key] }));
            return (
              <button
                key={line.key}
                type="button"
                role="menuitemcheckbox"
                className="export-scope-box"
                aria-checked={row.toggles[line.key]}
                aria-label={t('mainPanel.export.scopeItemAria', '{{scope}} — {{line}}', {
                  scope: row.label,
                  line: line.label,
                })}
                {...(roving
                  ? {
                      ref: (node: HTMLButtonElement | null) => { listRef.current[ringIndex] = node; },
                      tabIndex: activeIndex === ringIndex ? 0 : -1,
                      ...getItemProps({ onClick: toggle }),
                    }
                  : { onClick: toggle })}
              >
                {line.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
    {hasContent && !scopeHasContent && (
      <div className="export-scope-empty">
        {t('mainPanel.export.scopeEmpty', 'Nothing selected')}
      </div>
    )}
    </>
  );

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: (next: boolean) => {
      if (next) seedScope();
      setIsOpen(next);
    },
    placement: 'bottom-end',
    middleware: [
      offset(4),
      flip(),
      shift({ padding: 8 }),
      // A short window scrolls the menu instead of cutting it off.
      size({
        padding: 8,
        apply({ availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            maxHeight: `${Math.max(0, availableHeight)}px`,
          });
        },
      }),
    ],
    whileElementsMounted: autoUpdate,
    strategy: 'fixed',
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    loop: true,
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([
    click, dismiss, role, listNav,
  ]);

  // Collect i18n strings once per render.
  const txtI18n: TxtI18n = useMemo(() => buildTxtI18n((key, def) => t(key, def)), [t]);

  // Close whichever host is active; each call no-ops for the inactive one.
  const closeMenu = useCallback(() => {
    setIsOpen(false);
    childMenu.onClose('action');
  }, [childMenu]);

  /** The export input for the current scope, computed at click time. */
  const exportInput = useCallback((): ExportInput => ({
    items: scopedItems,
    provider,
    providerSettings: currentProviderSettings,
    localInferenceSettings,
    fallbackLanguages: { sourceLanguage, targetLanguage },
    // Recorded so the file says whether it is the whole conversation. A full
    // scope is dropped inside buildSessionMetadata.
    scope: { speaker: togglesToMode(speaker), participant: togglesToMode(participant) },
  }), [scopedItems, provider, currentProviderSettings, localInferenceSettings, sourceLanguage, targetLanguage, speaker, participant]);

  const handleCopy = useCallback(async () => {
    closeMenu();
    const { messages, metadata } = buildExportPayload(exportInput());
    const text = formatAsTxt(messages, metadata, txtI18n, { includeHeader: false });
    const ok = await copyToClipboard(text);
    if (ok) {
      showToast(t('mainPanel.export.copySuccess', 'Conversation copied to clipboard'), { variant: 'success' });
    } else {
      showToast(t('mainPanel.export.copyFailed', 'Failed to copy. Check browser permissions.'), { variant: 'error', durationMs: 4000 });
    }
  }, [exportInput, showToast, t, txtI18n, closeMenu]);

  const handleDownloadTxt = useCallback(() => {
    closeMenu();
    const { content, filename } = buildTxtExport(exportInput(), txtI18n);
    downloadFile(content, filename, 'text/plain;charset=utf-8');
  }, [exportInput, txtI18n, closeMenu]);

  const handleDownloadJson = useCallback(() => {
    closeMenu();
    const { messages, metadata } = buildExportPayload(exportInput());
    downloadFile(formatAsJson(messages, metadata), exportFilename('json'), 'application/json');
  }, [exportInput, closeMenu]);

  const items = useMemo(() => ([
    { key: 'copy', label: t('mainPanel.export.copyToClipboard', 'Copy to clipboard'), Icon: Copy, onClick: handleCopy },
    { key: 'txt',  label: t('mainPanel.export.downloadTxt',     'Download as .txt'),    Icon: FileText, onClick: handleDownloadTxt },
    { key: 'json', label: t('mainPanel.export.downloadJson',    'Download as .json'),   Icon: FileJson, onClick: handleDownloadJson },
  ]), [t, handleCopy, handleDownloadTxt, handleDownloadJson]);

  const autoSaveLabel = t('mainPanel.export.autoSave.label', 'Auto-save when session ends');
  // A native title, like the toolbar buttons: the Tooltip component clones its
  // child and would fight the roving-tabindex ref, and the child-window host's
  // 240px OS window would clip a floating tooltip anyway.
  const autoSaveTooltip = isElectron()
    ? t('mainPanel.export.autoSave.tooltipDesktop', 'When a session ends, save the whole conversation — both sides, originals and translations — as a .txt file in your Downloads folder.')
    : t('mainPanel.export.autoSave.tooltipBrowser', 'When a session ends, download the whole conversation — both sides, originals and translations — as a .txt file. Closing the side panel during a session does not save it; stop the session first.');
  /** Last stop in the keyboard ring, after the three actions. */
  const autoSaveRingIndex = scopeRingSize + items.length;

  /** The persisted auto-save switch, shared by both menu hosts. */
  const renderAutoSave = (roving: boolean) => (
    <>
      <div className="export-menu-divider" role="separator" />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={autoSaveOnStop}
        className="export-menu-item export-auto-save"
        title={autoSaveTooltip}
        {...(roving
          ? {
              ref: (node: HTMLButtonElement | null) => { listRef.current[autoSaveRingIndex] = node; },
              tabIndex: activeIndex === autoSaveRingIndex ? 0 : -1,
              ...getItemProps({ onClick: toggleAutoSave }),
            }
          : { onClick: toggleAutoSave })}
      >
        <span className="export-auto-save__switch" aria-hidden="true" />
        <span>{autoSaveLabel}</span>
      </button>
    </>
  );

  if (childHosted) {
    return (
      <>
        <button
          ref={childBtnRef}
          className="export-btn"
          type="button"
          onClick={() => {
            if (!childMenu.open) seedScope();
            childMenu.toggle();
          }}
          title={t('mainPanel.toolbar.export', 'Export conversation')}
          aria-label={t('mainPanel.toolbar.export', 'Export conversation')}
          aria-haspopup="menu"
          aria-expanded={childMenu.open}
        >
          <Download size={14} />
          <ChevronDown size={12} className="export-btn-chevron" />
        </button>

        <ChildWindowPopover
          open={childMenu.open}
          onClose={childMenu.onClose}
          anchorEl={childBtnRef.current}
          width={240}
          height={182}
        >
          {/* Plain buttons: the child window's native focus handles keyboard
              use; floating-ui's roving tabindex belongs to the inline host. */}
          <div
            className="export-menu"
            role="menu"
            aria-label={t('mainPanel.toolbar.export', 'Export conversation')}
          >
            {renderScope(false)}
            {items.map((it) => {
              const { Icon } = it;
              return (
                <button
                  key={it.key}
                  role="menuitem"
                  type="button"
                  className="export-menu-item"
                  disabled={!scopeHasContent}
                  onClick={it.onClick}
                >
                  <Icon size={14} />
                  <span>{it.label}</span>
                </button>
              );
            })}
            {renderAutoSave(false)}
          </div>
        </ChildWindowPopover>
      </>
    );
  }

  return (
    <>
      <button
        ref={refs.setReference}
        className="export-btn"
        type="button"
        title={t('mainPanel.toolbar.export', 'Export conversation')}
        aria-label={t('mainPanel.toolbar.export', 'Export conversation')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        {...getReferenceProps()}
      >
        <Download size={14} />
        <ChevronDown size={12} className="export-btn-chevron" />
      </button>

      {isOpen && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              className="export-menu"
              style={{ ...floatingStyles, zIndex: 9999 }}
              {...getFloatingProps()}
            >
              {renderScope(true)}
              {items.map((it, idx) => {
                const { Icon } = it;
                return (
                  <button
                    key={it.key}
                    ref={(node) => { listRef.current[scopeRingSize + idx] = node; }}
                    role="menuitem"
                    type="button"
                    className="export-menu-item"
                    disabled={!scopeHasContent}
                    tabIndex={activeIndex === scopeRingSize + idx ? 0 : -1}
                    {...getItemProps({
                      onClick: it.onClick,
                    })}
                  >
                    <Icon size={14} />
                    <span>{it.label}</span>
                  </button>
                );
              })}
              {renderAutoSave(true)}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
};

export default ExportButton;
