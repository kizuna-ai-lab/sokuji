/**
 * Low-variance presentational primitives shared by the two model-management
 * sections (LOCAL_INFERENCE's ModelManagementSection + LOCAL_NATIVE's
 * NativeModelManagementSection). These carry none of the providers' divergent
 * domain concepts (manifest shape, store, status enum, cloud/variant/None/AST) —
 * only the shared chrome. The card bodies stay provider-specific by design.
 *
 * Reuses the existing model-group__* / model-subgroup__* / model-management__*
 * classes (global via ModelManagementSection.scss) and i18n keys.
 */
import './ModelManagementControls.scss';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, HardDrive, Trash2 } from 'lucide-react';

// ─── ModelGroup (collapsible per-stage group) ────────────────────────────────

export const ModelGroup: React.FC<{
  id?: string;
  title: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  /** Header-less, always-expanded variant for the Library push view, where
   *  the surface's own page title already names the stage. */
  bare?: boolean;
  /** Rendered at the top of the list (e.g. native's per-stage device
   *  control) so it survives the header's removal in bare mode. */
  aboveList?: React.ReactNode;
  children: React.ReactNode;
}> = ({ id, title, subtitle, defaultExpanded = true, bare = false, aboveList, children }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const list = (
    <div className="model-group__list">
      {aboveList}
      {children}
    </div>
  );
  if (bare) {
    return (
      <div id={id ? `${id}-section` : undefined} className="model-group">
        {list}
      </div>
    );
  }
  return (
    <div id={id ? `${id}-section` : undefined} className="model-group">
      <div className="model-group__header" onClick={() => setExpanded(!expanded)}>
        <span className="model-group__chevron">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <h3 className="model-group__title">{title}</h3>
        {subtitle && <span className="model-group__subtitle">{subtitle}</span>}
      </div>
      {expanded && list}
    </div>
  );
};

// ─── Recommended / Others split ──────────────────────────────────────────────

/**
 * The list of cards, the recommended ones first, with no sub-heading over either part: each recommended card carries
 * its own badge, and a heading of the same word over it said it twice (owner, 2026-11-27). Rendered through the
 * caller's `renderItem`, so the card type stays provider-specific.
 */
export function RecommendedOthers<T>({
  items,
  isRecommended,
  renderItem,
}: {
  items: T[];
  isRecommended: (item: T) => boolean;
  renderItem: (item: T) => React.ReactNode;
}): React.ReactElement {
  return <>{[...items.filter(isRecommended), ...items.filter((i) => !isRecommended(i))].map(renderItem)}</>;
}

// ─── Storage footer (used + clear-all confirm) ───────────────────────────────

/**
 * "Storage: N MB used" + a Clear all button with an inline Yes/No confirm.
 * Owns its confirm state; the caller supplies the number, whether anything is
 * deletable, and the clear handler (IndexedDB wipe vs sidecar deletes).
 */
export const ModelStorageFooter: React.FC<{
  usedMb: number;
  hasModels: boolean;
  onClearAll: () => void | Promise<void>;
  disabled: boolean;
}> = ({ usedMb, hasModels, onClearAll, disabled }) => {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="model-management__storage">
      <HardDrive size={14} />
      <span>{t('models.storageUsed', 'Storage: {{size}} MB used', { size: usedMb })}</span>
      {hasModels && (
        confirm ? (
          <div className="model-management__clear-confirm">
            <span className="model-management__clear-confirm-text">
              {t('models.confirmClearAll', 'Delete all models?')}
            </span>
            <button
              className="model-management__clear-btn model-management__clear-btn--yes"
              onClick={async () => { setConfirm(false); await onClearAll(); }}
              disabled={disabled}
            >
              {t('models.confirmYes', 'Yes')}
            </button>
            <button
              className="model-management__clear-btn model-management__clear-btn--no"
              onClick={() => setConfirm(false)}
            >
              {t('models.confirmNo', 'No')}
            </button>
          </div>
        ) : (
          <button
            className="model-management__clear-all"
            onClick={() => setConfirm(true)}
            disabled={disabled}
            title={t('models.clearAll', 'Clear all models')}
          >
            <Trash2 size={12} />
            {t('models.clearAll', 'Clear all')}
          </button>
        )
      )}
    </div>
  );
};
