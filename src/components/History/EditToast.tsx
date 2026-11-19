// src/components/History/EditToast.tsx
//
// What an edit of a finished record did, said above the player for 6 s, with Undo (owner, 2026-11-19; design draft P0
// §3.6). Ctrl/⌘+Z does the same from anywhere on the page but a field.
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import type { EditToast as Toast } from '../../lib/history/historyPageStore';
import { useHistoryPageContext } from './historyContext';

export function EditToast() {
  const { t } = useTranslation();
  const { store } = useHistoryPageContext();
  const toast = useStore(store, (s) => s.toast);
  const canUndo = useStore(store, (s) => s.canUndo);
  if (!toast) return null;
  const said = (x: Toast): string => {
    switch (x.kind) {
      case 'fixed':
        return x.words
          ? t('history.toast.fixedWords', 'Changed {{count}} places: {{from}} → {{to}}, added to the word list', { count: x.count, from: x.from, to: x.to })
          : t('history.toast.fixed', 'Changed {{count}} places: {{from}} → {{to}}', { count: x.count, from: x.from, to: x.to });
      case 'reverted':
        return x.kept > 0
          ? t('history.toast.revertedKept', 'Reverted {{count}} places: {{to}} → {{from}} ({{kept}} changed since, kept)', { count: x.count, from: x.from, to: x.to, kept: x.kept })
          : t('history.toast.reverted', 'Reverted {{count}} places: {{to}} → {{from}}', { count: x.count, from: x.from, to: x.to });
      case 'edited': return t('history.toast.edited', 'Sentence changed');
      case 'restored': return t('history.toast.restored', 'Original restored');
      case 'speaker': return t('history.toast.speaker', 'Speaker changed');
      default: return t('history.toast.undone', 'Undone');
    }
  };
  return (
    <div className="record-edit-toast" role="status" aria-label={t('history.toast.label', 'What changed')}>
      <span>{said(toast)}</span>
      {canUndo && (
        <button type="button" className="history-button" onClick={() => void store.getState().undo()}>{t('history.toast.undo', 'Undo')}</button>
      )}
    </div>
  );
}

export default EditToast;
