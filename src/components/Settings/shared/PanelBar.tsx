import React, { useEffect } from 'react';
import { PanelRightClose } from 'lucide-react';
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
  /** Collapse the panel. */
  onClose: () => void;
}

// A dialog inside the OTHER (hidden) panel must not block this panel's
// Escape: panels stay mounted inside <Activity> boundaries, which hide via
// inline display:none, so DOM presence no longer implies visibility.
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

const PanelBar: React.FC<PanelBarProps> = ({ tabs, activeTab, onTabChange, actions, onClose }) => {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Don't steal Escape from an open modal/dialog or floating popover.
      if (isVisibleDialogOpen()) return;
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const hasTabs = tabs && activeTab !== undefined && onTabChange;

  return (
    <div className={`panel-bar${hasTabs ? ' panel-bar--has-tabs' : ''}`}>
      {hasTabs ? (
        <TabBar tabs={tabs!} activeTab={activeTab!} onTabChange={onTabChange!} />
      ) : (
        <span className="panel-bar__spacer" />
      )}
      <div className="panel-bar__actions">
        {actions}
        <button
          type="button"
          className="panel-bar__close"
          onClick={onClose}
          title={t('common.collapsePanel', 'Close panel')}
          aria-label={t('common.collapsePanel', 'Close panel')}
        >
          <PanelRightClose size={16} />
        </button>
      </div>
    </div>
  );
};

export default PanelBar;
