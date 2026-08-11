import React, { useEffect } from 'react';
import { ArrowLeft, PanelRightClose } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import TabBar, { Tab } from './TabBar';
import './PanelBar.scss';

interface PanelBarProps {
  /** Tab strip. Omit for tab-less panels (e.g. Settings Quick mode). */
  tabs?: Tab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  /** Panel-specific controls, rendered in the right cluster left of close. */
  actions?: React.ReactNode;
  /** Collapse the panel / return to session. */
  onClose: () => void;
  /** `back` = return to session (Settings full-slot); `collapse` = close drawer. */
  closeMode?: 'collapse' | 'back';
}

const isVisibleDialogOpen = (): boolean => {
  for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
    let hidden = false;
    for (let node: HTMLElement | null = dialog; node; node = node.parentElement) {
      if (node.style.display === 'none') { hidden = true; break; }
    }
    if (!hidden) return true;
  }
  return false;
};

const PanelBar: React.FC<PanelBarProps> = ({
  tabs,
  activeTab,
  onTabChange,
  actions,
  onClose,
  closeMode = 'collapse',
}) => {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (isVisibleDialogOpen()) return;
      // Logs drawer sits above Settings; Settings must not also handle Escape.
      if (closeMode === 'back' && document.querySelector('.logs-drawer.is-open')) return;
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, closeMode]);

  const hasTabs = tabs && activeTab !== undefined && onTabChange;
  const closeTitle =
    closeMode === 'back'
      ? t('common.backToSession', 'Back to session')
      : t('common.collapsePanel', 'Close panel');

  const backButton = (
    <button
      type="button"
      className="panel-bar__back"
      onClick={onClose}
      title={closeTitle}
      aria-label={closeTitle}
    >
      <ArrowLeft size={16} strokeWidth={1.75} />
      <span>{t('common.back', 'Back')}</span>
    </button>
  );

  return (
    <div className={`panel-bar${hasTabs ? ' panel-bar--has-tabs' : ''}${closeMode === 'back' ? ' panel-bar--back' : ''}`}>
      {closeMode === 'back' && backButton}
      {hasTabs ? (
        <TabBar tabs={tabs!} activeTab={activeTab!} onTabChange={onTabChange!} />
      ) : (
        <div className="panel-bar__title-cluster">
          {closeMode === 'back' && (
            <span className="panel-bar__title">
              {t('settings.title', 'Settings')}
            </span>
          )}
          <span className="panel-bar__spacer" />
        </div>
      )}
      <div className="panel-bar__actions">
        {actions}
        {closeMode !== 'back' && (
          <button
            type="button"
            className="panel-bar__close"
            onClick={onClose}
            title={closeTitle}
            aria-label={closeTitle}
          >
            <PanelRightClose size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

export default PanelBar;
