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
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Star, HardDrive, Trash2 } from 'lucide-react';

// ─── ModelGroup (collapsible per-stage group) ────────────────────────────────

export const ModelGroup: React.FC<{
  id?: string;
  title: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}> = ({ id, title, subtitle, defaultExpanded = true, children }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div id={id ? `${id}-section` : undefined} className="model-group">
      <div className="model-group__header" onClick={() => setExpanded(!expanded)}>
        <span className="model-group__chevron">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <h3 className="model-group__title">{title}</h3>
        {subtitle && <span className="model-group__subtitle">{subtitle}</span>}
      </div>
      {expanded && <div className="model-group__list">{children}</div>}
    </div>
  );
};

// ─── Recommended / Others split ──────────────────────────────────────────────

/**
 * Split a list into Recommended / Others sub-groups, rendering each item via
 * the caller's `renderItem` (so the card type stays provider-specific). Falls
 * back to a flat list when nothing is recommended.
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
  const { t } = useTranslation();
  const recommended = items.filter(isRecommended);
  const others = items.filter((i) => !isRecommended(i));
  if (recommended.length === 0) return <>{items.map(renderItem)}</>;
  return (
    <>
      <div className="model-subgroup">
        <div className="model-subgroup__label">
          <Star size={11} />
          {t('models.recommendedGroup', 'Recommended')}
        </div>
        {recommended.map(renderItem)}
      </div>
      {others.length > 0 && (
        <div className="model-subgroup">
          <div className="model-subgroup__label">{t('models.othersGroup', 'Others')}</div>
          {others.map(renderItem)}
        </div>
      )}
    </>
  );
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
