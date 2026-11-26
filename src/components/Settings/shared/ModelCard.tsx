// src/components/Settings/shared/ModelCard.tsx
//
// One model as a card: its name and size, its languages, Recommended and In use, and its one action — Download and
// Import side by side, the progress with Cancel, Downloaded with Delete, or the error with Retry. Out of the old
// in-panel library; Models and storage draws its session models with it (owner, 2026-11-17: B-20).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Trash2, X, AlertCircle, CheckCircle, AlertTriangle, Zap, Star, FolderInput } from 'lucide-react';
import { getModelSizeMb, type ModelManifestEntry, type ModelStatus } from '../../../lib/local-inference/modelManifest';
import { formatBytes } from '../../../lib/local-inference/formatBytes';
import { LanguageTags } from '../sections/LanguageTags';
import './ModelCard.scss';

const MB = 1_048_576;

export function ModelCard({
  entry,
  status,
  download,
  errorMessage,
  isSessionActive,
  isSelected,
  isCompatible,
  isAutoSelected,
  compatibilityHint,
  deviceFeatures,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
  onImport,
  canDownload = true,
  children,
}: {
  entry: ModelManifestEntry | null; // null = "None" card
  status: ModelStatus;
  download?: { downloadedBytes: number; totalBytes: number; currentFile: string; percent: number; isImport?: boolean };
  errorMessage?: string;
  isSessionActive: boolean;
  isSelected: boolean;
  isCompatible: boolean;
  isAutoSelected?: boolean;
  compatibilityHint?: string;
  deviceFeatures?: string[];
  onSelect?: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onImport?: () => void;
  /** False where this computer cannot run the model: no Download, Import or Retry (Models and storage, B-20). */
  canDownload?: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const isNone = entry === null;
  const isCloud = entry !== null && entry.isCloudModel === true;
  const disabled = isSessionActive;

  const classNames = [
    'model-card',
    `model-card--${status}`,
    isSelected && 'model-card--selected',
    !isCompatible && !isNone && 'model-card--incompatible',
    disabled && 'model-card--disabled',
    isNone && 'model-card--none',
  ].filter(Boolean).join(' ');

  const handleClick = () => {
    if (disabled || !onSelect) return;
    if (!isCompatible && !isNone) return;
    // Cloud models are always selectable; others need to be downloaded
    if (!isNone && !isCloud && status !== 'downloaded') return;
    onSelect();
  };

  if (isNone) {
    return (
      <div className={classNames} onClick={handleClick}>
        <div className="model-card__top-row">
          <div className="model-card__content">
            <div className="model-card__info">
              <div className="model-card__header">
                <span className="model-card__name">{t('settings.ttsNone', 'None (text only)')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={classNames} data-testid={`model-card-${entry.id}`} onClick={handleClick}>
      <div className="model-card__top-row">
        <div className="model-card__content">
          <div className="model-card__info">
            <div className="model-card__header">
              <span className="model-card__name">{entry.name}</span>
              {!isCloud && <span className="model-card__size">{formatBytes(getModelSizeMb(entry, deviceFeatures) * MB)}</span>}
            </div>
            <div className="model-card__meta">
              <div className="model-card__languages">
                <LanguageTags languages={entry.languages} />
              </div>
              {entry.recommended && (
                <span className="model-card__recommended-badge">
                  <Star size={10} />
                  {t('models.recommended', 'Recommended')}
                </span>
              )}
              {isAutoSelected && (
                <span className="model-card__auto-badge">
                  <Zap size={10} />
                  {t('models.autoSelected', 'Auto-selected')}
                </span>
              )}
              {compatibilityHint && (
                <span className="model-card__compatibility-warning">
                  <AlertTriangle size={11} />
                  {compatibilityHint}
                </span>
              )}
            </div>
          </div>

          <div className="model-card__actions">
            {isCloud && (
              <div className="model-card__downloaded">
                <span className={`model-card__status-label${isSelected ? ' model-card__status-label--active' : ''}`}>
                  <span className="model-card__status-icon"><CheckCircle size={14} /></span>
                  <span>{isSelected ? t('models.active', 'Active') : t('models.online', 'Online')}</span>
                </span>
              </div>
            )}

            {!isCloud && status === 'not_downloaded' && canDownload && (
              <>
                <button
                  className="model-card__btn model-card__btn--download"
                  onClick={(e) => { e.stopPropagation(); onDownload(); }}
                  disabled={isSessionActive}
                  title={t('models.download', 'Download')}
                  aria-label={`${t('models.download', 'Download')}: ${entry.name}`}
                >
                  <Download size={14} />
                  <span>{t('models.download', 'Download')}</span>
                </button>
                {onImport && (
                  <button
                    className="model-card__btn model-card__btn--import"
                    onClick={(e) => { e.stopPropagation(); onImport(); }}
                    disabled={isSessionActive}
                    title={t('models.importTitle', 'Import model')}
                    aria-label={`${t('models.import', 'Import')}: ${entry.name}`}
                  >
                    <FolderInput size={14} />
                    <span>{t('models.import', 'Import')}</span>
                  </button>
                )}
              </>
            )}

            {!isCloud && status === 'downloading' && download && (
              <div className="model-card__progress">
                <div className="model-card__progress-bar">
                  <div
                    className="model-card__progress-fill"
                    style={{ width: `${download.percent}%` }}
                  />
                </div>
                <div className="model-card__progress-info">
                  <span className="model-card__progress-percent">{download.percent}%</span>
                  {/* Imports write straight to IndexedDB and can't be cancelled. */}
                  {!download.isImport && (
                    <button
                      className="model-card__btn model-card__btn--cancel"
                      onClick={(e) => { e.stopPropagation(); onCancel(); }}
                      title={t('models.cancel', 'Cancel')}
                      aria-label={`${t('models.cancel', 'Cancel')}: ${entry.name}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {!isCloud && status === 'downloaded' && (
              <div className="model-card__downloaded">
                <span className={`model-card__status-label${isSelected ? ' model-card__status-label--active' : ''}`}>
                  <span className="model-card__status-icon"><CheckCircle size={14} /></span>
                  <span>{isSelected ? t('models.active', 'Active') : t('models.downloaded', 'Downloaded')}</span>
                </span>
                <button
                  className="model-card__btn model-card__btn--delete"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  disabled={isSessionActive}
                  title={t('models.delete', 'Delete')}
                  aria-label={`${t('models.delete', 'Delete')}: ${entry.name}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}

            {!isCloud && status === 'error' && (
              <div className="model-card__error">
                {canDownload && (
                <button
                  className="model-card__btn model-card__btn--download"
                  onClick={(e) => { e.stopPropagation(); onDownload(); }}
                  disabled={isSessionActive}
                  title={t('models.retry', 'Retry')}
                  aria-label={`${t('models.retry', 'Retry')}: ${entry.name}`}
                >
                  <Download size={14} />
                </button>
                )}
                {onImport && canDownload && (
                  <button
                    className="model-card__btn model-card__btn--import"
                    onClick={(e) => { e.stopPropagation(); onImport(); }}
                    disabled={isSessionActive}
                    title={t('models.importTitle', 'Import model')}
                    aria-label={`${t('models.import', 'Import')}: ${entry.name}`}
                  >
                    <FolderInput size={14} />
                    <span>{t('models.import', 'Import')}</span>
                  </button>
                )}
                <button
                  className="model-card__btn model-card__btn--delete"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  disabled={isSessionActive}
                  title={t('models.deletePartial', 'Delete partial files')}
                  aria-label={`${t('models.deletePartial', 'Delete partial files')}: ${entry.name}`}
                >
                  <Trash2 size={12} />
                </button>
                <span className="model-card__status-icon"><AlertCircle size={14} /></span>
                <span title={errorMessage}>{t('models.error', 'Error')}</span>
                {errorMessage && (
                  <div className="model-card__error-message">{errorMessage}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {isSelected && children && (
        // stopPropagation so interacting with the body (e.g. the voice picker's
        // dropdown/buttons) does not bubble to the card root's onClick and re-select.
        <div className="model-card__body" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}
