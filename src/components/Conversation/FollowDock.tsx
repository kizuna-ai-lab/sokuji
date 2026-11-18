import { useTranslation } from 'react-i18next';
import { ArrowDown } from 'lucide-react';
import '../MainPanel/MainPanel.scss';

/**
 * The row below a scrolling list that follows its newest (useFollowLatest), shown while the reader has scrolled back:
 * a click brings them to the newest and follows again. The conversation's list and the live notes share it (owner,
 * 2026-11-19); its styles are `.follow-dock` (MainPanel.scss).
 */
export function FollowDock({ onClick }: { onClick(): void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="follow-dock" onClick={onClick}>
      <ArrowDown size={14} aria-hidden="true" />
      <span className="follow-dock__label">{t('mainPanel.backToLatest', 'Back to latest')}</span>
    </button>
  );
}
