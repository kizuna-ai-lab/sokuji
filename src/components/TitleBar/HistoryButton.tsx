// The title bar's way into History: the desktop only, where sessions are kept.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import { isElectron } from '../../utils/environment';
import { useHistoryOpen, useSetHistoryOpen } from '../../stores/layoutStore';

const HistoryButton: React.FC = () => {
  const { t } = useTranslation();
  const open = useHistoryOpen();
  const setOpen = useSetHistoryOpen();
  if (!isElectron()) return null;
  const label = t('history.title', 'History');
  return (
    <button
      type="button"
      className={`title-bar__action ${open ? 'is-active' : ''}`}
      onClick={() => setOpen(!open)}
      title={label}
      aria-label={label}
    >
      <History size={14} />
      <span className="title-bar__action-label">{label}</span>
    </button>
  );
};

export default HistoryButton;
