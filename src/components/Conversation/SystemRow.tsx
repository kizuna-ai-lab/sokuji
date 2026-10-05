import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import type { NoticeEntry } from '../../lib/view/filter';
import { noticeText } from '../../lib/view/noticeText';

/** What a system row offers below its words (spec 2026-10-05 §2: rarely). */
export interface NoticeAction {
  label: string;
  run(): void;
}

const ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;

/**
 * An event in the conversation, drawn as a chat system row (spec 2026-10-05
 * §2, R2): centred, 12px, no background and no header word. The severity is
 * the icon's colour and the text's brightness, nothing else; an action is an
 * inline link after the words.
 */
export const SystemRow = memo(function SystemRow({ notice, action }: { notice: NoticeEntry; action: NoticeAction | null }) {
  const { t } = useTranslation();
  // A code-less notice with an empty message has no words at all: the same
  // "Unknown error" the bubble fell back to, rather than an empty row.
  const words = noticeText(t, notice) || t('mainPanel.unknownError', 'Unknown error');
  const Icon = ICON[notice.severity];
  return (
    <div className={`sys-row sys-row--${notice.severity}`}>
      <Icon size={13} aria-hidden="true" />
      <span className="sys-row__text">
        {words}
        {action && (
          <button type="button" className="sys-row__action" onClick={action.run}>
            {action.label}
          </button>
        )}
      </span>
    </div>
  );
});
