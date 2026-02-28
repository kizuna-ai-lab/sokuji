import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Trash2, X, AlertCircle, CheckCircle, HardDrive, ChevronDown, ChevronRight, AlertTriangle, Zap } from 'lucide-react';
import {
  useModelStore,
  useModelStatuses,
  useModelDownloads,
  useDownloadErrors,
  useStorageUsedMb,
  useModelInitialized,
  useWebGPUAvailable,
} from '../../../stores/modelStore';
import {
  getManifestByType,
  getModelSizeMb,
  isTranslationModelCompatible,
  type ModelManifestEntry,
  type ModelStatus,
} from '../../../lib/local-inference/modelManifest';
import type { LocalInferenceSettings } from '../../../stores/settingsStore';
import './ModelManagementSection.scss';

// ─── Props ─────────────────────────────────────────────────────────────────

interface ModelManagementSectionProps {
  isSessionActive: boolean;
  localInferenceSettings: LocalInferenceSettings;
  onUpdateSettings: (updates: Partial<LocalInferenceSettings>) => void;
}

// ─── ModelCard ─────────────────────────────────────────────────────────────

function ModelCard({
  entry,
  status,
  download,
  errorMessage,
  isSessionActive,
  isSelected,
  isCompatible,
  isAutoSelected,
  showRadio,
  compatibilityHint,
  onSelect,
  onDownload,
  onCancel,
  onDelete,
}: {
  entry: ModelManifestEntry | null; // null = "None" card
  status: ModelStatus;
  download?: { downloadedBytes: number; totalBytes: number; currentFile: string; percent: number };
  errorMessage?: string;
  isSessionActive: boolean;
  isSelected: boolean;
  isCompatible: boolean;
  isAutoSelected?: boolean;
  showRadio: boolean;
  compatibilityHint?: string;
  onSelect?: () => void;
  onDownload: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const isNone = entry === null;
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
    // For incompatible models, don't allow selection
    if (!isCompatible && !isNone) return;
    // For non-downloaded models (except "None"), don't allow selection
    if (!isNone && status !== 'downloaded') return;
    onSelect();
  };

  if (isNone) {
    return (
      <div className={classNames} onClick={handleClick}>
        <div className="model-card__top-row">
          {showRadio && <div className="model-card__radio" />}
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
    <div className={classNames} onClick={handleClick}>
      <div className="model-card__top-row">
        {showRadio && <div className="model-card__radio" />}
        <div className="model-card__content">
          <div className="model-card__info">
            <div className="model-card__header">
              <span className="model-card__name">{entry.name}</span>
              <span className="model-card__size">{getModelSizeMb(entry)} MB</span>
            </div>
            <div className="model-card__meta">
              <div className="model-card__languages">
                {entry.languages.map(lang => (
                  <span key={lang} className="model-card__lang-tag">{lang}</span>
                ))}
              </div>
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
            {status === 'not_downloaded' && (
              <button
                className="model-card__btn model-card__btn--download"
                onClick={(e) => { e.stopPropagation(); onDownload(); }}
                disabled={isSessionActive}
                title={t('models.download', 'Download')}
              >
                <Download size={14} />
                <span>{t('models.download', 'Download')}</span>
              </button>
            )}

            {status === 'downloading' && download && (
              <div className="model-card__progress">
                <div className="model-card__progress-bar">
                  <div
                    className="model-card__progress-fill"
                    style={{ width: `${download.percent}%` }}
                  />
                </div>
                <div className="model-card__progress-info">
                  <span className="model-card__progress-percent">{download.percent}%</span>
                  <button
                    className="model-card__btn model-card__btn--cancel"
                    onClick={(e) => { e.stopPropagation(); onCancel(); }}
                    title={t('models.cancel', 'Cancel')}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}

            {status === 'downloaded' && (
              <div className="model-card__downloaded">
                <span className="model-card__status-icon"><CheckCircle size={14} /></span>
                <span>{t('models.downloaded', 'Downloaded')}</span>
                <button
                  className="model-card__btn model-card__btn--delete"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  disabled={isSessionActive}
                  title={t('models.delete', 'Delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}

            {status === 'error' && (
              <div className="model-card__error">
                <span className="model-card__status-icon"><AlertCircle size={14} /></span>
                <span title={errorMessage}>{t('models.error', 'Error')}</span>
                <button
                  className="model-card__btn model-card__btn--download"
                  onClick={(e) => { e.stopPropagation(); onDownload(); }}
                  disabled={isSessionActive}
                  title={t('models.retry', 'Retry')}
                >
                  <Download size={14} />
                </button>
                {errorMessage && (
                  <div className="model-card__error-message">{errorMessage}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ModelGroup ────────────────────────────────────────────────────────────

function ModelGroup({
  title,
  subtitle,
  defaultExpanded = true,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="model-group">
      <div className="model-group__header" onClick={() => setExpanded(!expanded)}>
        <span className="model-group__chevron">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <h3 className="model-group__title">{title}</h3>
        {subtitle && <span className="model-group__subtitle">{subtitle}</span>}
      </div>
      {expanded && (
        <div className="model-group__list">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Sort helper ───────────────────────────────────────────────────────────

function sortModels(
  models: ModelManifestEntry[],
  statuses: Record<string, ModelStatus>,
  isCompatible: (entry: ModelManifestEntry) => boolean,
): ModelManifestEntry[] {
  return [...models].sort((a, b) => {
    const aCompat = isCompatible(a) ? 0 : 1;
    const bCompat = isCompatible(b) ? 0 : 1;
    if (aCompat !== bCompat) return aCompat - bCompat;

    const aDown = statuses[a.id] === 'downloaded' ? 0 : 1;
    const bDown = statuses[b.id] === 'downloaded' ? 0 : 1;
    return aDown - bDown;
  });
}

// ─── Main Component ────────────────────────────────────────────────────────

export function ModelManagementSection({
  isSessionActive,
  localInferenceSettings,
  onUpdateSettings,
}: ModelManagementSectionProps) {
  const { t } = useTranslation();
  const statuses = useModelStatuses();
  const downloads = useModelDownloads();
  const downloadErrors = useDownloadErrors();
  const storageUsedMb = useStorageUsedMb();
  const initialized = useModelInitialized();
  const webgpuAvailable = useWebGPUAvailable();
  const { initialize, downloadModel, cancelDownload, deleteModel } = useModelStore();

  const [showAllTranslation, setShowAllTranslation] = useState(false);
  const [showAllAsr, setShowAllAsr] = useState(false);
  const [showAllTts, setShowAllTts] = useState(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

  const { sourceLanguage, targetLanguage, asrModel, ttsModel, translationModel } = localInferenceSettings;

  // Auto-select models: fix incompatible or missing selections after language change / model download
  useEffect(() => {
    if (!initialized) return;
    const updates: Partial<LocalInferenceSettings> = {};

    // ASR: must support sourceLanguage and be downloaded (includes streaming models)
    const allAsrModels = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];
    const currentAsr = asrModel ? allAsrModels.find(m => m.id === asrModel) : null;
    const asrOk = currentAsr && currentAsr.languages.includes(sourceLanguage) && statuses[asrModel] === 'downloaded';
    if (!asrOk) {
      const match = allAsrModels.find(m =>
        m.languages.includes(sourceLanguage) && statuses[m.id] === 'downloaded'
      );
      const newId = match?.id || '';
      if (newId !== asrModel) updates.asrModel = newId;
    }

    // Translation: must be compatible with source→target pair, downloaded, and device-ready
    const currentTrans = translationModel ? getManifestByType('translation').find(m => m.id === translationModel) : null;
    const transOk = currentTrans
      && isTranslationModelCompatible(currentTrans, sourceLanguage, targetLanguage)
      && statuses[translationModel] === 'downloaded'
      && !(currentTrans.requiredDevice === 'webgpu' && !webgpuAvailable);
    if (!transOk) {
      const match = getManifestByType('translation').find(m =>
        isTranslationModelCompatible(m, sourceLanguage, targetLanguage)
        && statuses[m.id] === 'downloaded'
        && !(m.requiredDevice === 'webgpu' && !webgpuAvailable)
      );
      const newId = match?.id || '';
      if (newId !== translationModel) updates.translationModel = newId;
    }

    // TTS: must support targetLanguage and be downloaded
    const currentTts = ttsModel ? getManifestByType('tts').find(m => m.id === ttsModel) : null;
    const ttsOk = currentTts && currentTts.languages.includes(targetLanguage) && statuses[ttsModel] === 'downloaded';
    if (!ttsOk) {
      const match = getManifestByType('tts').find(m =>
        m.languages.includes(targetLanguage) && statuses[m.id] === 'downloaded'
      );
      const newId = match?.id || '';
      if (newId !== ttsModel) updates.ttsModel = newId;
    }

    if (Object.keys(updates).length > 0) {
      onUpdateSettings(updates);
    }
  }, [initialized, statuses, sourceLanguage, targetLanguage, asrModel, translationModel, ttsModel, webgpuAvailable, onUpdateSettings]);

  // ── Memoized model lists ──────────────────────────────────────────────

  const asrModels = useMemo(() => {
    const all = [...getManifestByType('asr'), ...getManifestByType('asr-stream')];
    return sortModels(all, statuses, (m) => m.languages.includes(sourceLanguage));
  }, [statuses, sourceLanguage]);

  const translationModels = useMemo(() => {
    const all = getManifestByType('translation');
    return sortModels(all, statuses, (m) =>
      isTranslationModelCompatible(m, sourceLanguage, targetLanguage)
      && !(m.requiredDevice === 'webgpu' && !webgpuAvailable)
    );
  }, [statuses, sourceLanguage, targetLanguage, webgpuAvailable]);

  const compatibleTranslationModels = useMemo(
    () => translationModels.filter(m =>
      isTranslationModelCompatible(m, sourceLanguage, targetLanguage)
      && !(m.requiredDevice === 'webgpu' && !webgpuAvailable)
    ),
    [translationModels, sourceLanguage, targetLanguage, webgpuAvailable],
  );

  const incompatibleTranslationModels = useMemo(
    () => translationModels.filter(m =>
      !isTranslationModelCompatible(m, sourceLanguage, targetLanguage)
      || (m.requiredDevice === 'webgpu' && !webgpuAvailable)
    ),
    [translationModels, sourceLanguage, targetLanguage, webgpuAvailable],
  );

  const ttsModels = useMemo(() => {
    const all = getManifestByType('tts');
    return sortModels(all, statuses, (m) => m.languages.includes(targetLanguage));
  }, [statuses, targetLanguage]);

  const compatibleAsrModels = useMemo(
    () => asrModels.filter(m => m.languages.includes(sourceLanguage)),
    [asrModels, sourceLanguage],
  );
  const incompatibleAsrModels = useMemo(
    () => asrModels.filter(m => !m.languages.includes(sourceLanguage)),
    [asrModels, sourceLanguage],
  );

  const compatibleTtsModels = useMemo(
    () => ttsModels.filter(m => m.languages.includes(targetLanguage)),
    [ttsModels, targetLanguage],
  );
  const incompatibleTtsModels = useMemo(
    () => ttsModels.filter(m => !m.languages.includes(targetLanguage)),
    [ttsModels, targetLanguage],
  );

  if (!initialized) return null;

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleDownload = async (modelId: string) => {
    try {
      await downloadModel(modelId);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error(`Failed to download model ${modelId}:`, err);
      }
    }
  };

  // ── ASR Section ───────────────────────────────────────────────────────

  const renderAsrGroup = () => {
    return (
      <ModelGroup title={t('models.asrModels', 'ASR (Speech Recognition)')}>
        {compatibleAsrModels.length > 0 ? (
          compatibleAsrModels.map(entry => (
            <ModelCard
              key={entry.id}
              entry={entry}
              status={statuses[entry.id] || 'not_downloaded'}
              download={downloads[entry.id]}
              errorMessage={downloadErrors[entry.id]}
              isSessionActive={isSessionActive}
              isSelected={asrModel === entry.id}
              isCompatible={true}
              showRadio={true}
              onSelect={() => onUpdateSettings({ asrModel: entry.id })}
              onDownload={() => handleDownload(entry.id)}
              onCancel={() => cancelDownload(entry.id)}
              onDelete={() => deleteModel(entry.id)}
            />
          ))
        ) : (
          <div className="model-card__no-model-warning">
            <AlertTriangle size={14} />
            {t('settings.noAsrModel', 'No ASR model for {{language}}', { language: sourceLanguage })}
          </div>
        )}

        {incompatibleAsrModels.length > 0 && (
          <>
            <button
              className="model-group__show-all"
              onClick={() => setShowAllAsr(!showAllAsr)}
            >
              {showAllAsr ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showAllAsr
                ? t('models.hideOther', 'Hide other models')
                : t('models.showAllAsr', 'Show all ASR models ({{count}})', {
                    count: incompatibleAsrModels.length,
                  })
              }
            </button>
            {showAllAsr && incompatibleAsrModels.map(entry => (
              <ModelCard
                key={entry.id}
                entry={entry}
                status={statuses[entry.id] || 'not_downloaded'}
                download={downloads[entry.id]}
                isSessionActive={isSessionActive}
                isSelected={asrModel === entry.id}
                isCompatible={false}
                showRadio={true}
                compatibilityHint={t('settings.langMismatch', 'language mismatch')}
                onSelect={() => onUpdateSettings({ asrModel: entry.id })}
                onDownload={() => handleDownload(entry.id)}
                onCancel={() => cancelDownload(entry.id)}
                onDelete={() => deleteModel(entry.id)}
              />
            ))}
          </>
        )}
      </ModelGroup>
    );
  };

  // ── Translation Section ───────────────────────────────────────────────

  const renderTranslationGroup = () => {
    return (
      <ModelGroup title={t('models.translationModels', 'Translation')}>
        {compatibleTranslationModels.length > 0 ? (
          compatibleTranslationModels.map(entry => (
            <ModelCard
              key={entry.id}
              entry={entry}
              status={statuses[entry.id] || 'not_downloaded'}
              download={downloads[entry.id]}
              errorMessage={downloadErrors[entry.id]}
              isSessionActive={isSessionActive}
              isSelected={translationModel === entry.id}
              isCompatible={true}
              showRadio={true}
              onSelect={() => onUpdateSettings({ translationModel: entry.id })}
              onDownload={() => handleDownload(entry.id)}
              onCancel={() => cancelDownload(entry.id)}
              onDelete={() => deleteModel(entry.id)}
            />
          ))
        ) : (
          <div className="model-card__no-model-warning">
            <AlertTriangle size={14} />
            {t('settings.noTranslationModel', 'No translation model for {{source}} \u2192 {{target}}', {
              source: sourceLanguage,
              target: targetLanguage,
            })}
          </div>
        )}

        {incompatibleTranslationModels.length > 0 && (
          <>
            <button
              className="model-group__show-all"
              onClick={() => setShowAllTranslation(!showAllTranslation)}
            >
              {showAllTranslation ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showAllTranslation
                ? t('models.hideOther', 'Hide other models')
                : t('models.showAll', 'Show all translation models ({{count}})', {
                    count: incompatibleTranslationModels.length,
                  })
              }
            </button>
            {showAllTranslation && incompatibleTranslationModels.map(entry => (
              <ModelCard
                key={entry.id}
                entry={entry}
                status={statuses[entry.id] || 'not_downloaded'}
                download={downloads[entry.id]}
                isSessionActive={isSessionActive}
                isSelected={translationModel === entry.id}
                isCompatible={false}
                showRadio={true}
                compatibilityHint={
                  entry.requiredDevice === 'webgpu' && !webgpuAvailable
                    ? t('settings.webgpuNotSupported', 'Not available in current environment')
                    : t('settings.langMismatch', 'language mismatch')
                }
                onSelect={() => onUpdateSettings({ translationModel: entry.id })}
                onDownload={() => handleDownload(entry.id)}
                onCancel={() => cancelDownload(entry.id)}
                onDelete={() => deleteModel(entry.id)}
              />
            ))}
          </>
        )}
      </ModelGroup>
    );
  };

  // ── TTS Section ───────────────────────────────────────────────────────

  const renderTtsGroup = () => {
    return (
      <ModelGroup
        title={t('models.ttsModels', 'TTS (Text-to-Speech)')}
      >
        {compatibleTtsModels.length > 0 ? (
          compatibleTtsModels.map(entry => (
            <ModelCard
              key={entry.id}
              entry={entry}
              status={statuses[entry.id] || 'not_downloaded'}
              download={downloads[entry.id]}
              errorMessage={downloadErrors[entry.id]}
              isSessionActive={isSessionActive}
              isSelected={ttsModel === entry.id}
              isCompatible={true}
              showRadio={true}
              onSelect={() => onUpdateSettings({ ttsModel: entry.id })}
              onDownload={() => handleDownload(entry.id)}
              onCancel={() => cancelDownload(entry.id)}
              onDelete={() => deleteModel(entry.id)}
            />
          ))
        ) : (
          <div className="model-card__no-model-warning">
            <AlertTriangle size={14} />
            {t('settings.noTtsModel', 'No TTS model for {{language}}', { language: targetLanguage })}
          </div>
        )}

        {incompatibleTtsModels.length > 0 && (
          <>
            <button
              className="model-group__show-all"
              onClick={() => setShowAllTts(!showAllTts)}
            >
              {showAllTts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {showAllTts
                ? t('models.hideOther', 'Hide other models')
                : t('models.showAllTts', 'Show all TTS models ({{count}})', {
                    count: incompatibleTtsModels.length,
                  })
              }
            </button>
            {showAllTts && incompatibleTtsModels.map(entry => (
              <ModelCard
                key={entry.id}
                entry={entry}
                status={statuses[entry.id] || 'not_downloaded'}
                download={downloads[entry.id]}
                isSessionActive={isSessionActive}
                isSelected={ttsModel === entry.id}
                isCompatible={false}
                showRadio={true}
                compatibilityHint={t('settings.langMismatch', 'language mismatch')}
                onSelect={() => onUpdateSettings({ ttsModel: entry.id })}
                onDownload={() => handleDownload(entry.id)}
                onCancel={() => cancelDownload(entry.id)}
                onDelete={() => deleteModel(entry.id)}
              />
            ))}
          </>
        )}
      </ModelGroup>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="settings-section model-management-section">
      <h2>{t('models.management', 'Models')}</h2>

      {renderAsrGroup()}
      {renderTranslationGroup()}
      {renderTtsGroup()}

      <div className="model-management__storage">
        <HardDrive size={14} />
        <span>
          {t('models.storageUsed', 'Storage: {{size}} MB used', { size: storageUsedMb })}
        </span>
      </div>
    </div>
  );
}

export default ModelManagementSection;
