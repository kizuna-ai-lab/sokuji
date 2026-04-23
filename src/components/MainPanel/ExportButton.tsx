import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, ChevronDown, Copy, FileText, FileJson } from 'lucide-react';
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useClick,
  useDismiss,
  useRole,
  useListNavigation,
  useInteractions,
  FloatingFocusManager,
  FloatingPortal,
} from '@floating-ui/react';
import type { ConversationItem } from '../../services/interfaces/IClient';
import {
  buildSessionMetadata,
  copyToClipboard,
  downloadFile,
  formatAsJson,
  formatAsTxt,
  formatTimestampForFilename,
  getActiveModelInfo,
  normalizeMessages,
  type TxtI18n,
} from '../../utils/conversationExport';
import { useToast } from '../Toast';
import './ExportButton.scss';

interface ExportButtonProps {
  /** Already-merged-and-sorted items from MainPanel's combinedItems memo. */
  combinedItems: Array<ConversationItem & { source?: string }>;
  /** Current provider id from useProvider(). */
  provider: string;
  /** Snapshot of the current provider's settings (from getCurrentProviderSettings()). */
  currentProviderSettings: any;
  /** Local-inference settings sub-object (from useLocalInferenceSettings()), used only when provider === LOCAL_INFERENCE. */
  localInferenceSettings: any;
  /** Source language code (read from current provider settings). */
  sourceLanguage: string;
  /** Target language code (read from current provider settings). */
  targetLanguage: string;
}

const ExportButton: React.FC<ExportButtonProps> = ({
  combinedItems,
  provider,
  currentProviderSettings,
  localInferenceSettings,
  sourceLanguage,
  targetLanguage,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = React.useRef<Array<HTMLElement | null>>([]);

  // Snapshot: how many completed messages we have right now. If zero, disable.
  const hasContent = useMemo(
    () => normalizeMessages(combinedItems).length > 0,
    [combinedItems]
  );

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: 'bottom-end',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
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
  const txtI18n: TxtI18n = useMemo(() => ({
    speakerYou: t('mainPanel.export.speakerYou', 'You'),
    speakerOther: t('mainPanel.export.speakerOther', 'Other'),
    headerTitle: t('mainPanel.export.headerTitle', 'Sokuji conversation export'),
    headerGenerated: t('mainPanel.export.headerGenerated', 'Generated'),
    headerProvider: t('mainPanel.export.headerProvider', 'Provider'),
    headerModels: t('mainPanel.export.headerModels', 'Models'),
    headerSource: t('mainPanel.export.headerSource', 'Source'),
    headerTarget: t('mainPanel.export.headerTarget', 'Target'),
    headerNote: t('mainPanel.export.headerNote', 'settings reflect current state at export, not mid-session changes'),
    noTranscript: t('mainPanel.export.noTranscript', '(no transcript)'),
    noTranslation: t('mainPanel.export.noTranslation', '(no translation)'),
  }), [t]);

  /** Compute a fresh export payload at click time. */
  const buildPayload = useCallback(() => {
    const messages = normalizeMessages(combinedItems);
    const models = getActiveModelInfo(provider, currentProviderSettings, localInferenceSettings);
    const metadata = buildSessionMetadata({
      provider,
      models,
      sourceLanguage,
      targetLanguage,
    });
    return { messages, metadata };
  }, [combinedItems, provider, currentProviderSettings, localInferenceSettings, sourceLanguage, targetLanguage]);

  const handleCopy = useCallback(async () => {
    setIsOpen(false);
    const { messages, metadata } = buildPayload();
    const text = formatAsTxt(messages, metadata, txtI18n, { includeHeader: false });
    const ok = await copyToClipboard(text);
    if (ok) {
      showToast(t('mainPanel.export.copySuccess', 'Conversation copied to clipboard'), { variant: 'success' });
    } else {
      showToast(t('mainPanel.export.copyFailed', 'Failed to copy. Check browser permissions.'), { variant: 'error', durationMs: 4000 });
    }
  }, [buildPayload, showToast, t, txtI18n]);

  const handleDownloadTxt = useCallback(() => {
    setIsOpen(false);
    const { messages, metadata } = buildPayload();
    const content = formatAsTxt(messages, metadata, txtI18n, { includeHeader: true });
    const filename = `sokuji-conversation-${formatTimestampForFilename(Date.now())}.txt`;
    downloadFile(content, filename, 'text/plain;charset=utf-8');
  }, [buildPayload, txtI18n]);

  const handleDownloadJson = useCallback(() => {
    setIsOpen(false);
    const { messages, metadata } = buildPayload();
    const content = formatAsJson(messages, metadata);
    const filename = `sokuji-conversation-${formatTimestampForFilename(Date.now())}.json`;
    downloadFile(content, filename, 'application/json');
  }, [buildPayload]);

  const items = useMemo(() => ([
    { key: 'copy', label: t('mainPanel.export.copyToClipboard', 'Copy to clipboard'), Icon: Copy, onClick: handleCopy },
    { key: 'txt',  label: t('mainPanel.export.downloadTxt',     'Download as .txt'),    Icon: FileText, onClick: handleDownloadTxt },
    { key: 'json', label: t('mainPanel.export.downloadJson',    'Download as .json'),   Icon: FileJson, onClick: handleDownloadJson },
  ]), [t, handleCopy, handleDownloadTxt, handleDownloadJson]);

  return (
    <>
      <button
        ref={refs.setReference}
        className="export-btn"
        type="button"
        disabled={!hasContent}
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
              {items.map((it, idx) => {
                const { Icon } = it;
                return (
                  <button
                    key={it.key}
                    ref={(node) => { listRef.current[idx] = node; }}
                    role="menuitem"
                    type="button"
                    className="export-menu-item"
                    tabIndex={activeIndex === idx ? 0 : -1}
                    {...getItemProps({
                      onClick: it.onClick,
                    })}
                  >
                    <Icon size={14} />
                    <span>{it.label}</span>
                  </button>
                );
              })}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
};

export default ExportButton;
